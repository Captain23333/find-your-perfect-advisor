import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  isSafeAdvisorProgramId,
  isUsableApplicantName,
} from "./project-contract.mjs";

export const LITERATURE_CATEGORIES = ["advisor_work", "field_work"];
export const LITERATURE_ACCESS_BASES = [
  "publisher_open_access",
  "institutional_repository",
  "disciplinary_repository",
  "author_public_copy",
];
export const ADVISOR_RELATIONSHIP_TYPES = ["advisor_author", "team_author"];

function personKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function publicHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

export function literatureRelationshipErrors(source, targetAdvisorName) {
  const id = String(source?.literatureId || "未命名来源").trim();
  const errors = [];
  const targetKey = personKey(targetAdvisorName);
  const authorKeys = (Array.isArray(source?.authors) ? source.authors : []).map(personKey);
  if (!targetKey) return [`${id} 缺少目标导师姓名，无法核验文献归属`];

  if (source?.category === "advisor_work") {
    const relationship = source?.advisorRelationship;
    if (!relationship || !ADVISOR_RELATIONSHIP_TYPES.includes(relationship.type)) {
      errors.push(`${id} 缺少有效的导师/团队关系类型`);
      return errors;
    }
    if (personKey(relationship.advisorName) !== targetKey) {
      errors.push(`${id} 的关系记录未绑定当前目标导师`);
    }
    if (!publicHttpUrl(relationship.evidenceUrl)) {
      errors.push(`${id} 缺少导师/团队关系证据 URL`);
    }
    if (!String(relationship.note || "").trim()) {
      errors.push(`${id} 缺少导师/团队关系说明`);
    }
    if (relationship.type === "advisor_author") {
      if (!authorKeys.includes(targetKey)) {
        errors.push(`${id} 标为导师本人作者，但作者列表中找不到目标导师`);
      }
    } else {
      const matchedAuthors = Array.isArray(relationship.matchedAuthors)
        ? relationship.matchedAuthors.map(String).filter(Boolean)
        : [];
      if (!matchedAuthors.length) {
        errors.push(`${id} 标为团队作者，但没有列出匹配的团队作者`);
      } else if (matchedAuthors.some((author) => !authorKeys.includes(personKey(author)))) {
        errors.push(`${id} 的团队作者匹配记录与论文作者列表不一致`);
      }
    }
  } else if (source?.category === "field_work") {
    if (authorKeys.includes(targetKey)) {
      errors.push(`${id} 含目标导师署名，不能标为独立领域文献`);
    }
    if (!String(source?.independenceNote || "").trim()) {
      errors.push(`${id} 缺少独立领域文献的分类说明`);
    }
  }
  return errors;
}

function inside(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(root, path);
  return (
    absolutePath.startsWith(`${absoluteRoot}${sep}`) &&
    absolutePath !== absoluteRoot
  );
}

async function readJson(path) {
  try {
    const raw = await readFile(path, "utf8");
    return { exists: true, value: JSON.parse(raw), raw };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: null, raw: "" };
    return { exists: true, value: null, raw: "", error };
  }
}

async function readText(path) {
  try {
    return { exists: true, value: await readFile(path, "utf8") };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: "" };
    return { exists: true, value: "", error };
  }
}

function requiredTextFiles(mode) {
  return mode === "research_proposal"
    ? [
        "research-proposal.tex",
        "references.bib",
        "proposal-evidence.md",
        "proposal-review.md",
      ]
    : ["outreach-email.txt", "outreach-audit.md"];
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const INTERNAL_DELIVERY_MARKERS = [
  "test fixture",
  "test draft",
  "do not submit",
  "do not send",
  "cannot be submitted",
  "not submission-ready",
];

function containsInternalDeliveryMarker(value) {
  const lower = String(value || "").toLowerCase();
  return INTERNAL_DELIVERY_MARKERS.find((marker) => lower.includes(marker)) || null;
}

export async function verifyApplicationMaterialArtifacts({
  projectPath,
  mode,
  advisorProgramId,
  confirmedRevision = null,
  confirmedFingerprint = null,
  expectedAdvisorName = "",
  applicantName = "",
  cvValid = false,
  startedAt = null,
}) {
  const missing = [];
  if (!advisorProgramId) {
    return {
      complete: false,
      missing: ["申请材料确认快照缺少 advisorProgramId"],
      counts: {},
      literature: [],
    };
  }
  if (!isSafeAdvisorProgramId(advisorProgramId)) {
    return {
      complete: false,
      missing: ["申请材料确认快照中的 advisorProgramId 含不安全的路径字符"],
      counts: {},
      literature: [],
    };
  }
  const targetRoot = resolve(
    projectPath,
    "outputs",
    "application-materials",
    advisorProgramId,
  );
  const confirmedApplicantName = String(applicantName || "").trim();
  if (!cvValid) missing.push("申请材料缺少可读取的真实 CV");
  if (!isUsableApplicantName(confirmedApplicantName)) {
    missing.push("申请材料缺少已确认的申请者真实姓名");
  }
  const manifestPath = resolve(targetRoot, "literature", "manifest.json");
  const manifestFile = await readJson(manifestPath);
  if (!manifestFile.exists) {
    missing.push(
      `outputs/application-materials/${advisorProgramId}/literature/manifest.json 尚未生成`,
    );
  } else if (manifestFile.error || !manifestFile.value || typeof manifestFile.value !== "object") {
    missing.push("literature/manifest.json 不是合法 JSON 对象");
  }

  const manifest = manifestFile.value || {};
  if (manifest.advisorProgramId !== advisorProgramId) {
    missing.push("文献清单的 advisorProgramId 与本次确认目标不一致");
  }
  const targetAdvisorName = String(manifest.targetAdvisorName || "").trim();
  if (!targetAdvisorName) {
    missing.push("文献清单缺少目标导师姓名，无法核验 advisor_work 归属");
  } else if (expectedAdvisorName && personKey(targetAdvisorName) !== personKey(expectedAdvisorName)) {
    missing.push("文献清单的目标导师姓名与当前排名目标不一致");
  }
  if (
    Number.isInteger(confirmedRevision) &&
    manifest.confirmedRevision !== confirmedRevision
  ) {
    missing.push("文献清单的确认版本与本次运行不一致");
  }
  if (
    confirmedFingerprint &&
    manifest.confirmedFingerprint !== confirmedFingerprint
  ) {
    missing.push("文献清单的配置指纹与本次运行不一致");
  }
  if (
    startedAt &&
    (!manifest.generatedAt || Date.parse(manifest.generatedAt) < Date.parse(startedAt))
  ) {
    missing.push("文献清单不是本次运行生成或更新的");
  }

  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  if (!sources.length) missing.push("文献清单中没有来源");
  const ids = sources.map((source) => String(source?.literatureId || "").trim());
  if (ids.some((id) => !id)) missing.push("文献清单中有来源缺少 literatureId");
  if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) {
    missing.push("文献清单中的 literatureId 有重复");
  }

  const used = sources.filter(
    (source) => Array.isArray(source?.usedIn) && source.usedIn.includes(mode),
  );
  for (const category of LITERATURE_CATEGORIES) {
    if (!used.some((source) => source?.category === category)) {
      missing.push(
        `${mode} 没有引用 ${category === "advisor_work" ? "导师本人/团队文献" : "领域文献"}`,
      );
    }
  }

  for (const source of used) {
    const id = String(source?.literatureId || "未命名来源").trim();
    if (!LITERATURE_CATEGORIES.includes(source?.category)) {
      missing.push(`${id} 的 category 无效`);
    }
    missing.push(...literatureRelationshipErrors(source, targetAdvisorName));
    if (!String(source?.title || "").trim()) missing.push(`${id} 缺少题名`);
    if (!Array.isArray(source?.authors) || !source.authors.length) {
      missing.push(`${id} 缺少作者列表`);
    }
    try {
      const canonical = new URL(source?.canonicalUrl);
      if (!/^https?:$/.test(canonical.protocol)) throw new Error();
    } catch {
      missing.push(`${id} 缺少合法 canonicalUrl`);
    }
    if (!LITERATURE_ACCESS_BASES.includes(source?.accessBasis)) {
      missing.push(`${id} 没有可核实的公开获取依据`);
    }
    if (source?.accessStatus !== "downloaded_open_access") {
      missing.push(`${id} 已被材料引用，但没有合法公开下载到本地`);
      continue;
    }
    const localPath = String(source?.localPath || "").trim();
    if (!localPath || !inside(targetRoot, localPath)) {
      missing.push(`${id} 的 localPath 不在当前材料目录内`);
      continue;
    }
    const absolute = resolve(targetRoot, localPath);
    try {
      const bytes = await readFile(absolute);
      const details = await stat(absolute);
      if (!details.isFile() || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        missing.push(`${id} 的本地文件不是有效 PDF`);
        continue;
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== source.sha256) missing.push(`${id} 的 SHA-256 与清单不一致`);
      if (Number(source.bytes) !== bytes.length) missing.push(`${id} 的文件大小与清单不一致`);
    } catch {
      missing.push(`${id} 的本地 PDF 不存在或不可读`);
    }
  }

  const texts = {};
  for (const file of requiredTextFiles(mode)) {
    const loaded = await readText(resolve(targetRoot, file));
    texts[file] = loaded.value;
    if (!loaded.exists) missing.push(`${file} 尚未生成`);
    else if (loaded.error || !loaded.value.trim()) missing.push(`${file} 为空或不可读`);
  }
  const publicDeliveryFile =
    mode === "research_proposal" ? "research-proposal.tex" : "outreach-email.txt";
  const leakedMarker = containsInternalDeliveryMarker(texts[publicDeliveryFile]);
  if (leakedMarker) {
    missing.push(`${publicDeliveryFile} 含内部 QA/禁用标记：${leakedMarker}`);
  }
  if (
    mode === "outreach_email" &&
    isUsableApplicantName(confirmedApplicantName) &&
    !String(texts[publicDeliveryFile] || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/g, "")
      .includes(
        confirmedApplicantName
          .normalize("NFKC")
          .toLocaleLowerCase()
          .replace(/\s+/g, ""),
      )
  ) {
    missing.push("outreach-email.txt 没有使用已确认的申请者真实姓名签名");
  }

  if (mode === "research_proposal") {
    const tex = texts["research-proposal.tex"] || "";
    const bib = texts["references.bib"] || "";
    if (!/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(tex)) {
      missing.push("research-proposal.tex 缺少合法 LaTeX documentclass");
    }
    if (!/\\(?:bibliography\{|addbibresource\{)/.test(tex)) {
      missing.push("research-proposal.tex 没有绑定 BibTeX/BibLaTeX 文献库");
    }
    for (const source of used) {
      const id = String(source?.literatureId || "").trim();
      if (id && !new RegExp(`@[A-Za-z]+\\s*\\{\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`, "i").test(bib)) {
        missing.push(`references.bib 没有文献条目 ${id}`);
      }
      if (id && !tex.includes(id)) {
        missing.push(`research-proposal.tex 没有引用 ${id}`);
      }
    }

    const pdfPath = resolve(targetRoot, "research-proposal.pdf");
    let pdfBytes = null;
    try {
      pdfBytes = await readFile(pdfPath);
      if (
        !pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
        !pdfBytes.subarray(Math.max(0, pdfBytes.length - 2048)).includes(Buffer.from("%%EOF"))
      ) {
        missing.push("research-proposal.pdf 不是完整的 PDF 文件");
      }
    } catch {
      missing.push("research-proposal.pdf 尚未生成或不可读");
    }

    const buildFile = await readJson(resolve(targetRoot, "proposal-build.json"));
    if (!buildFile.exists || buildFile.error || !buildFile.value) {
      missing.push("proposal-build.json 尚未生成或不是合法 JSON");
    } else {
      const build = buildFile.value;
      if (build.advisorProgramId !== advisorProgramId) {
        missing.push("proposal-build.json 的目标与当前确认不一致");
      }
      if (Number.isInteger(confirmedRevision) && build.confirmedRevision !== confirmedRevision) {
        missing.push("proposal-build.json 的确认版本与当前运行不一致");
      }
      if (confirmedFingerprint && build.confirmedFingerprint !== confirmedFingerprint) {
        missing.push("proposal-build.json 的配置指纹与当前运行不一致");
      }
      if (build.engine !== "latexmk-pdf-bibtex") {
        missing.push("proposal-build.json 没有记录受支持的 LaTeX/BibTeX 构建引擎");
      }
      if (sha256(Buffer.from(tex)) !== build.texSha256) {
        missing.push("research-proposal.tex 已在最后构建后发生变化");
      }
      if (sha256(Buffer.from(bib)) !== build.bibSha256) {
        missing.push("references.bib 已在最后构建后发生变化");
      }
      if (pdfBytes && sha256(pdfBytes) !== build.pdfSha256) {
        missing.push("research-proposal.pdf 与最后构建记录的哈希不一致");
      }
      if (pdfBytes && Number(build.pdfBytes) !== pdfBytes.length) {
        missing.push("research-proposal.pdf 与最后构建记录的文件大小不一致");
      }
      if (
        startedAt &&
        (!build.builtAt || Date.parse(build.builtAt) < Date.parse(startedAt))
      ) {
        missing.push("research-proposal.pdf 不是本次运行构建的");
      }
    }
  }
  const auditFile = mode === "research_proposal" ? "proposal-evidence.md" : "outreach-audit.md";
  for (const source of used) {
    const id = String(source?.literatureId || "").trim();
    if (id && !texts[auditFile]?.includes(id)) {
      missing.push(`${auditFile} 没有记录已引用来源 ${id}`);
    }
  }

  return {
    complete: missing.length === 0,
    missing,
    counts: {
      literatureCount: sources.length,
      usedLiteratureCount: used.length,
    },
    literature: used.map((source) => ({
      literatureId: String(source?.literatureId || "").trim(),
      category: source?.category,
      title: String(source?.title || "").trim(),
      authors: Array.isArray(source?.authors) ? source.authors.map(String) : [],
      year: Number(source?.year) || null,
      canonicalUrl: String(source?.canonicalUrl || "").trim(),
      localPath: String(source?.localPath || "").trim(),
      sha256: String(source?.sha256 || "").trim(),
      relationship:
        source?.category === "advisor_work"
          ? source?.advisorRelationship || null
          : { type: "independent_field", note: String(source?.independenceNote || "").trim() },
    })),
    targetRoot,
  };
}
