#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve, sep } from "node:path";
import {
  LITERATURE_ACCESS_BASES,
  LITERATURE_CATEGORIES,
  literatureRelationshipErrors,
} from "./application-materials-artifacts.mjs";
import { isSafeAdvisorProgramId } from "./project-contract.mjs";
import { isExecutedDirectly } from "./direct-execution.mjs";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function option(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function safeUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 不是合法 URL`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`${label} 只允许 HTTP(S)`);
  const hostname = parsed.hostname.toLowerCase();
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    isIP(host)
  ) {
    throw new Error(`${label} 不允许指向本机、私网或裸 IP`);
  }
  return parsed;
}

function cleanId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(id)) {
    throw new Error(`literatureId ${id || "(empty)"} 只能使用安全的字母数字标识`);
  }
  return id;
}

function inside(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  return absolutePath.startsWith(`${absoluteRoot}${sep}`);
}

async function readExistingManifest(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed?.sources) ? parsed.sources : [];
  } catch {
    return [];
  }
}

async function reusablePdf(existing, absolutePath, expected) {
  if (
    !existing ||
    existing.accessStatus !== "downloaded_open_access" ||
    existing.localPath !== expected.localPath ||
    existing.canonicalUrl !== expected.canonicalUrl ||
    existing.downloadUrl !== expected.downloadUrl ||
    existing.accessBasis !== expected.accessBasis ||
    !existing.sha256 ||
    !Number.isFinite(Number(existing.bytes))
  ) {
    return null;
  }
  try {
    const bytes = await readFile(absolutePath);
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return null;
    if (bytes.length !== Number(existing.bytes)) return null;
    if (createHash("sha256").update(bytes).digest("hex") !== existing.sha256) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function downloadPdf(url, fetchImpl = fetch) {
  let current = safeUrl(url, "downloadUrl");
  let response;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    response = await fetchImpl(current, {
      redirect: "manual",
      headers: { "user-agent": "AdvisorAtlas/1.0 literature verifier" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === MAX_REDIRECTS) throw new Error("PDF 重定向次数超过上限");
    const location = response.headers.get("location");
    if (!location) throw new Error("PDF 重定向缺少 Location");
    current = safeUrl(new URL(location, current).href, "redirectUrl");
  }
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_PDF_BYTES) throw new Error("PDF 超过 50 MB 上限");
  if (!response.body) throw new Error("PDF 下载响应没有正文");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error("PDF 超过 50 MB 上限");
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks, total);
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("下载结果不是 PDF；请改用合法的直接 PDF 链接");
  }
  return bytes;
}

export async function fetchOpenLiterature({
  root,
  advisorProgramId,
  sourceFile,
  confirmedRevision,
  confirmedFingerprint,
  now = new Date().toISOString(),
  refresh = false,
  fetchImpl = fetch,
}) {
  const projectRoot = resolve(root);
  const safeAdvisorId = String(advisorProgramId || "").trim();
  if (!isSafeAdvisorProgramId(safeAdvisorId)) {
    throw new Error("--advisor-id 不是安全的 advisorProgramId");
  }
  const inputPath = resolve(projectRoot, sourceFile);
  if (!inside(projectRoot, inputPath)) {
    throw new Error("--source-file 必须位于当前项目目录内");
  }
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  const rawSources = Array.isArray(payload) ? payload : payload?.sources;
  if (!Array.isArray(rawSources) || !rawSources.length) {
    throw new Error("source file 必须包含非空 sources 数组");
  }
  const targetAdvisorName = String(payload?.targetAdvisorName || "").trim();
  if (!targetAdvisorName) {
    throw new Error("source file 必须包含 targetAdvisorName，用于核验 advisor_work 归属");
  }
  const targetRoot = resolve(
    projectRoot,
    "outputs",
    "application-materials",
    safeAdvisorId,
  );
  const literatureRoot = resolve(targetRoot, "literature");
  const manifestPath = resolve(literatureRoot, "manifest.json");
  await mkdir(literatureRoot, { recursive: true });
  const existing = await readExistingManifest(manifestPath);
  const byId = new Map(existing.map((source) => [source.literatureId, source]));
  let downloadedCount = 0;
  let reusedCount = 0;

  for (const raw of rawSources) {
    const literatureId = cleanId(raw?.literatureId);
    if (!LITERATURE_CATEGORIES.includes(raw?.category)) {
      throw new Error(`${literatureId} 的 category 必须是 advisor_work 或 field_work`);
    }
    if (!LITERATURE_ACCESS_BASES.includes(raw?.accessBasis)) {
      throw new Error(`${literatureId} 缺少允许的公开获取依据`);
    }
    const canonicalUrl = safeUrl(raw?.canonicalUrl, `${literatureId}.canonicalUrl`);
    const downloadUrl = safeUrl(raw?.downloadUrl, `${literatureId}.downloadUrl`);
    const authors = Array.isArray(raw?.authors)
      ? raw.authors.map(String).map((item) => item.trim()).filter(Boolean)
      : [];
    if (!String(raw?.title || "").trim() || !authors.length) {
      throw new Error(`${literatureId} 必须包含 title 和 authors`);
    }
    const relationshipErrors = literatureRelationshipErrors(
      { ...raw, literatureId, authors },
      targetAdvisorName,
    );
    if (relationshipErrors.length) throw new Error(relationshipErrors.join("；"));
    const usedIn = [
      ...new Set(
        (Array.isArray(raw?.usedIn) ? raw.usedIn : [])
          .map(String)
          .filter((item) => ["research_proposal", "outreach_email"].includes(item)),
      ),
    ];
    if (!usedIn.length) throw new Error(`${literatureId} 必须声明 usedIn`);

    const categoryDirectory = raw.category === "advisor_work" ? "advisor-work" : "field-work";
    const relativePath = `literature/${categoryDirectory}/${literatureId}.pdf`;
    const absolutePath = resolve(targetRoot, relativePath);
    await mkdir(resolve(targetRoot, "literature", categoryDirectory), { recursive: true });
    const previous = byId.get(literatureId);
    const reusedBytes = refresh
      ? null
      : await reusablePdf(previous, absolutePath, {
          localPath: relativePath,
          canonicalUrl: canonicalUrl.href,
          downloadUrl: downloadUrl.href,
          accessBasis: raw.accessBasis,
        });
    const bytes = reusedBytes || (await downloadPdf(downloadUrl, fetchImpl));
    if (reusedBytes) {
      reusedCount += 1;
    } else {
      downloadedCount += 1;
      const temporary = `${absolutePath}.tmp-${process.pid}`;
      await writeFile(temporary, bytes);
      await rename(temporary, absolutePath);
    }
    byId.set(literatureId, {
      literatureId,
      category: raw.category,
      title: String(raw.title).trim(),
      authors,
      year: Number(raw.year) || null,
      doi: String(raw.doi || "").trim() || null,
      canonicalUrl: canonicalUrl.href,
      downloadUrl: downloadUrl.href,
      accessBasis: raw.accessBasis,
      accessNote: String(raw.accessNote || "").trim(),
      license: String(raw.license || "").trim() || "not_stated_at_source",
      accessStatus: "downloaded_open_access",
      mediaType: "application/pdf",
      localPath: relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      inspectionLevel: ["full_text", "abstract", "metadata"].includes(raw.inspectionLevel)
        ? raw.inspectionLevel
        : "metadata",
      relevance: String(raw.relevance || "").trim(),
      advisorRelationship:
        raw.category === "advisor_work"
          ? {
              type: raw.advisorRelationship.type,
              advisorName: String(raw.advisorRelationship.advisorName).trim(),
              matchedAuthors: Array.isArray(raw.advisorRelationship.matchedAuthors)
                ? raw.advisorRelationship.matchedAuthors.map(String).map((item) => item.trim()).filter(Boolean)
                : [],
              evidenceUrl: safeUrl(
                raw.advisorRelationship.evidenceUrl,
                `${literatureId}.advisorRelationship.evidenceUrl`,
              ).href,
              note: String(raw.advisorRelationship.note).trim(),
            }
          : undefined,
      independenceNote:
        raw.category === "field_work"
          ? String(raw.independenceNote || "").trim()
          : undefined,
      usedIn,
      verifiedAt: reusedBytes ? previous.verifiedAt || now : now,
      ...(reusedBytes ? { reusedAt: now } : {}),
    });
  }

  const manifest = {
    schemaVersion: 1,
    advisorProgramId: safeAdvisorId,
    targetAdvisorName,
    confirmedRevision,
    confirmedFingerprint,
    generatedAt: now,
    policy: {
      advisorWorks: true,
      fieldWorks: true,
      downloadOpenAccess: true,
      noPaywallBypass: true,
    },
    sources: [...byId.values()].sort((a, b) =>
      String(a.literatureId).localeCompare(String(b.literatureId)),
    ),
  };
  const temporaryManifest = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporaryManifest, manifestPath);
  return { manifestPath, manifest, downloadedCount, reusedCount };
}

async function main() {
  const args = process.argv.slice(2);
  const root = option(args, "--root") || process.cwd();
  const advisorProgramId = option(args, "--advisor-id");
  const sourceFile = option(args, "--source-file");
  const revision = Number(option(args, "--confirmed-revision"));
  const fingerprint = option(args, "--confirmed-fingerprint");
  const refresh = args.includes("--refresh");
  if (!advisorProgramId || !sourceFile || !Number.isInteger(revision) || !fingerprint) {
    throw new Error(
      "需要 --advisor-id、--source-file、--confirmed-revision 和 --confirmed-fingerprint",
    );
  }
  const result = await fetchOpenLiterature({
    root,
    advisorProgramId,
    sourceFile,
    confirmedRevision: revision,
    confirmedFingerprint: fingerprint,
    refresh,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
