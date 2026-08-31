import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyApplicationMaterialArtifacts } from "../../skills/advisor-pipeline/scripts/application-materials-artifacts.mjs";

export const RUN_MODES = [
  "finder",
  "detective",
  "ranking",
  "research_proposal",
  "outreach_email",
];

// A run is only `completed` when the phase's real artifact is on disk. Every
// other outcome has to say what is missing instead of claiming success.
export const RUN_STATUSES = [
  "completed",
  "partial",
  "needs_input",
  "failed",
  "cancelled",
  "interrupted",
];

export const RUN_MODE_LABELS = {
  finder: "Phase 1 候选导师",
  detective: "Phase 2 背调结果",
  ranking: "Phase 3 综合排名",
  research_proposal: "Research Proposal",
  outreach_email: "陶瓷信",
};

async function readJsonFile(projectPath, ...segments) {
  const filePath = resolve(projectPath, ...segments);
  try {
    const raw = await readFile(filePath, "utf8");
    try {
      return { exists: true, value: JSON.parse(raw), filePath };
    } catch {
      return { exists: true, value: null, invalid: true, filePath };
    }
  } catch {
    return { exists: false, value: null, filePath };
  }
}

async function verifyWorkbook(projectPath, prefix, startedAt = null) {
  const outputDirectory = resolve(projectPath, "outputs");
  let names = [];
  try {
    names = await readdir(outputDirectory);
  } catch {
    return { missing: [`outputs/${prefix}_YYYYMMDD.xlsx 尚未生成`] };
  }
  const candidates = [];
  for (const name of names) {
    if (!name.startsWith(`${prefix}_`) || !name.toLowerCase().endsWith(".xlsx")) continue;
    const filePath = resolve(outputDirectory, name);
    try {
      const details = await stat(filePath);
      if (details.isFile()) candidates.push({ name, filePath, details });
    } catch {
      // A concurrently replaced file is simply not a valid completion artifact yet.
    }
  }
  candidates.sort((left, right) => right.details.mtimeMs - left.details.mtimeMs);
  const workbook = candidates[0];
  if (!workbook) return { missing: [`outputs/${prefix}_YYYYMMDD.xlsx 尚未生成`] };
  if (startedAt) {
    const startedAtMs = Date.parse(startedAt);
    if (Number.isFinite(startedAtMs) && workbook.details.mtimeMs + 2_000 < startedAtMs) {
      return { missing: [`${workbook.name} 是本次运行之前的旧工作簿`] };
    }
  }
  const bytes = await readFile(workbook.filePath);
  const startsWithZip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  const endSearchStart = Math.max(0, bytes.length - 65_557);
  const hasZipEnd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= endSearchStart;
  const packageText = bytes.toString("latin1");
  const hasWorkbookParts =
    packageText.includes("[Content_Types].xml") &&
    packageText.includes("xl/workbook.xml") &&
    packageText.includes("xl/worksheets/sheet1.xml");
  if (bytes.length < 512 || !startsWithZip || !hasZipEnd || !hasWorkbookParts) {
    return { missing: [`${workbook.name} 不是完整可打开的 XLSX 文件`] };
  }
  return { missing: [], workbookPath: workbook.filePath };
}

function combineArtifactChecks(primary, workbook) {
  return {
    missing: [...primary.missing, ...workbook.missing],
    counts: {
      ...primary.counts,
      workbookCount: workbook.missing.length ? 0 : 1,
    },
    ...(workbook.workbookPath ? { workbookPath: workbook.workbookPath } : {}),
  };
}

function verifyFinder(file) {
  const missing = [];
  if (!file.exists) {
    missing.push("outputs/candidates.json 尚未生成");
    return { missing, counts: {} };
  }
  if (file.invalid || !Array.isArray(file.value)) {
    missing.push("outputs/candidates.json 不是合法的候选数组");
    return { missing, counts: {} };
  }
  if (!file.value.length) {
    missing.push("outputs/candidates.json 中没有任何候选导师");
    return { missing, counts: { candidateCount: 0 } };
  }
  const ids = file.value.map((candidate) =>
    String(candidate?.advisorProgramId || "").trim(),
  );
  if (ids.some((id) => !id)) {
    missing.push("部分候选缺少稳定的 advisorProgramId");
  }
  if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) {
    missing.push("candidates.json 中的 advisorProgramId 有重复");
  }
  return { missing, counts: { candidateCount: file.value.length } };
}

function verifyDetective(file, { confirmedRevision, confirmedFingerprint, selectedAdvisorProgramIds, selectedSections }) {
  const missing = [];
  if (!file.exists) {
    missing.push("outputs/detective-results.json 尚未生成");
    return { missing, counts: {} };
  }
  if (file.invalid || !file.value || typeof file.value !== "object") {
    missing.push("outputs/detective-results.json 不是合法的 JSON 对象");
    return { missing, counts: {} };
  }
  const results = Array.isArray(file.value.results) ? file.value.results : [];
  if (!results.length) {
    missing.push("outputs/detective-results.json 中没有任何背调结果");
    return { missing, counts: { resultCount: 0 } };
  }

  // The artifact must belong to *this* confirmation. An agent that leaves an
  // older file untouched must not be reported as having finished this round.
  const artifactRevision = Number.isInteger(file.value.confirmedRevision)
    ? file.value.confirmedRevision
    : null;
  const artifactFingerprint = String(file.value.confirmedFingerprint || "").trim();
  if (Number.isInteger(confirmedRevision)) {
    if (artifactRevision !== confirmedRevision) {
      missing.push(
        artifactRevision === null
          ? `背调结果没有记录本次确认版本 ${confirmedRevision}`
          : `背调结果属于确认版本 ${artifactRevision}，本次确认版本是 ${confirmedRevision}`,
      );
    }
  } else if (artifactRevision === null) {
    missing.push("背调结果没有记录确认版本");
  }
  if (confirmedFingerprint) {
    if (artifactFingerprint !== confirmedFingerprint) {
      missing.push("背调结果的配置指纹与本次确认不一致");
    }
  }

  const coveredIds = new Set(
    results
      .map((item) => String(item?.advisorProgramId || "").trim())
      .filter(Boolean),
  );
  const uncovered = (selectedAdvisorProgramIds || []).filter(
    (id) => !coveredIds.has(id),
  );
  if (uncovered.length) {
    missing.push(`以下导师—项目组合还没有结果：${uncovered.join("、")}`);
  }

  // Unfinished dimensions are allowed, but they have to say so explicitly.
  const unmarked = [];
  for (const result of results) {
    const sections = result?.sections && typeof result.sections === "object"
      ? result.sections
      : {};
    for (const section of selectedSections || []) {
      const value = sections[section];
      const filled =
        (typeof value === "string" && value.trim()) ||
        (value && typeof value === "object" && (value.status || value.summary));
      if (!filled) {
        unmarked.push(
          `${result?.advisorProgramId || result?.name || "未知对象"} 的 ${section}`,
        );
      }
    }
  }
  if (unmarked.length) {
    missing.push(
      `以下维度既没有结论也没有标记未完成：${unmarked.slice(0, 8).join("、")}${
        unmarked.length > 8 ? ` 等 ${unmarked.length} 项` : ""
      }`,
    );
  }

  return { missing, counts: { resultCount: results.length } };
}

function verifyRanking(file) {
  const missing = [];
  if (!file.exists) {
    missing.push("outputs/ranking.json 尚未生成");
    return { missing, counts: {} };
  }
  if (file.invalid) {
    missing.push("outputs/ranking.json 不是合法 JSON");
    return { missing, counts: {} };
  }
  const value = file.value;
  const rankings = Array.isArray(value)
    ? value
    : Array.isArray(value?.rankings)
      ? value.rankings
      : Array.isArray(value?.ranking)
        ? value.ranking
        : null;
  if (!rankings) {
    missing.push("outputs/ranking.json 里找不到排名数组");
    return { missing, counts: {} };
  }
  if (!rankings.length) {
    missing.push("outputs/ranking.json 中没有任何排名结果");
    return { missing, counts: { rankingCount: 0 } };
  }
  const sortable = rankings.filter(
    (item) =>
      Number.isFinite(Number(item?.rank)) ||
      Number.isFinite(Number(item?.totalScore ?? item?.score)),
  );
  if (!sortable.length) {
    missing.push("排名结果既没有 rank 也没有可比较的分数");
  }
  return { missing, counts: { rankingCount: rankings.length } };
}

export async function verifyRunArtifacts({
  projectPath,
  mode,
  confirmedRevision = null,
  confirmedFingerprint = null,
  selectedAdvisorProgramIds = [],
  selectedSections = [],
  advisorProgramId = "",
  expectedAdvisorName = "",
  applicantName = "",
  cvValid = false,
  startedAt = null,
}) {
  if (mode === "research_proposal" || mode === "outreach_email") {
    return verifyApplicationMaterialArtifacts({
      projectPath,
      mode,
      advisorProgramId,
      confirmedRevision,
      confirmedFingerprint,
      expectedAdvisorName,
      applicantName,
      cvValid,
      startedAt,
    });
  }
  if (mode === "detective") {
    const file = await readJsonFile(projectPath, "outputs", "detective-results.json");
    const primary = verifyDetective(file, {
      confirmedRevision,
      confirmedFingerprint,
      selectedAdvisorProgramIds,
      selectedSections,
      startedAt,
    });
    const workbook = await verifyWorkbook(projectPath, "advisor_detective", startedAt);
    const outcome = combineArtifactChecks(primary, workbook);
    return { complete: outcome.missing.length === 0, ...outcome };
  }
  if (mode === "ranking") {
    const file = await readJsonFile(projectPath, "outputs", "ranking.json");
    const primary = verifyRanking(file);
    const workbook = await verifyWorkbook(projectPath, "advisor_application_ready", startedAt);
    const outcome = combineArtifactChecks(primary, workbook);
    return { complete: outcome.missing.length === 0, ...outcome };
  }
  const file = await readJsonFile(projectPath, "outputs", "candidates.json");
  const primary = verifyFinder(file);
  const workbook = await verifyWorkbook(projectPath, "advisor_shortlist", startedAt);
  const outcome = combineArtifactChecks(primary, workbook);
  return { complete: outcome.missing.length === 0, ...outcome };
}

// Structured request for information the agent cannot proceed without. The web
// runner has no free-text channel, so the agent emits this instead of asking a
// question the user can only answer after the round ends.
export function parseInputRequest(payload) {
  const source =
    payload && typeof payload === "object"
      ? payload.type === "input.requested"
        ? payload
        : payload.input_request || payload.inputRequest
      : null;
  if (!source || typeof source !== "object") return null;
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  const allowed = new Set([
    "cv",
    "degreeLevel",
    "degree",
    "season",
    "target",
    "interests",
    "shortlistTarget",
  ]);
  const fields = rawFields
    .map((field) => ({
      id: String(field?.id || "").trim(),
      label: String(field?.label || "").trim(),
      required: field?.required !== false,
      hint: String(field?.hint || "").trim() || null,
    }))
    .filter((field) => field.id && allowed.has(field.id));
  if (!fields.length) return null;
  return {
    reason: String(source.reason || source.message || "").trim() || null,
    fields,
    requestedAt: new Date().toISOString(),
  };
}

// Agents usually surface the request inside an assistant message rather than as
// a bare protocol line, so pull the first balanced JSON object that mentions it.
export function extractInputRequest(text) {
  const haystack = typeof text === "string" ? text : "";
  const marker = haystack.indexOf("input.requested");
  if (marker === -1) return null;
  let start = haystack.lastIndexOf("{", marker);
  while (start !== -1) {
    let depth = 0;
    for (let index = start; index < haystack.length; index += 1) {
      const character = haystack[index];
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = parseInputRequest(JSON.parse(haystack.slice(start, index + 1)));
            if (parsed) return parsed;
          } catch {
            // Not a complete JSON object; try an earlier opening brace.
          }
          break;
        }
      }
    }
    start = haystack.lastIndexOf("{", start - 1);
  }
  return null;
}
