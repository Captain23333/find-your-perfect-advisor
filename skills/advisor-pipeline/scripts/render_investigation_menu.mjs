#!/usr/bin/env node
// Deterministic Detective selection menu.
//
// The menu used to be free-form model output, so a required column (the stable
// advisorProgramId) went missing on the first pass and only appeared in the
// second confirmation summary. This script owns the format instead: an agent
// may explain the menu, but must not reorder, rename, or drop fields.
//
// It reads *only* project.json, outputs/candidates.json and the built-in
// dimension catalog. No advisor records, no evidence bundles, no community
// cache, no network — those belong after the user confirms.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEFAULT_DETECTIVE_SECTIONS,
  DETECTIVE_SECTION_CATALOG,
  investigationCostLevel,
  normalizeInvestigation,
} from "./project-contract.mjs";
import { isExecutedDirectly } from "./direct-execution.mjs";

function candidateRow(candidate, index) {
  const optionalScore = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    no: index + 1,
    advisorProgramId: String(candidate?.advisorProgramId || "").trim(),
    name: String(candidate?.name || "").trim(),
    school: String(candidate?.school || "").trim(),
    program: String(candidate?.program || "").trim(),
    fit: optionalScore(candidate?.fit),
    profileMatch: optionalScore(candidate?.profileMatch),
    overallMatch: optionalScore(candidate?.overallMatch),
    competitiveness: String(candidate?.competitiveness || "unknown").trim(),
    hardConstraintStatus: String(candidate?.hardConstraintStatus || "unknown").trim(),
    applicationPathway: String(candidate?.applicationPathway || "unknown").trim(),
    recommendedAction: String(candidate?.recommendedAction || "verify_pathway").trim(),
    status: String(candidate?.status || "待核实").trim(),
    feasibility: String(candidate?.feasibility || "needs_confirmation").trim(),
  };
}

export async function buildInvestigationMenu(root) {
  const projectRoot = resolve(root);
  const [rawProject, rawCandidates] = await Promise.all([
    readFile(resolve(projectRoot, "project.json"), "utf8").then(JSON.parse),
    readFile(resolve(projectRoot, "outputs", "candidates.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  if (!Array.isArray(rawCandidates)) {
    throw new Error("outputs/candidates.json 顶层必须是数组");
  }
  const investigation = normalizeInvestigation(rawProject?.investigation);
  const draftIds = new Set(investigation.draft.selectedAdvisorProgramIds);
  const draftSections = new Set(
    investigation.draft.selectedSections.length
      ? investigation.draft.selectedSections
      : DEFAULT_DETECTIVE_SECTIONS,
  );

  const candidates = rawCandidates.map(candidateRow);
  const missingIds = candidates.filter((candidate) => !candidate.advisorProgramId);
  if (missingIds.length) {
    throw new Error(
      `以下候选缺少稳定的 advisorProgramId，无法进入选择阶段：第 ${missingIds
        .map((candidate) => candidate.no)
        .join("、")} 行`,
    );
  }

  const sections = DETECTIVE_SECTION_CATALOG.map((section, index) => ({
    no: index + 1,
    id: section.id,
    label: section.label,
    defaultSelected: section.defaultSelected,
    selected: draftSections.has(section.id),
  }));

  const selectedCount = candidates.filter((candidate) =>
    draftIds.has(candidate.advisorProgramId),
  ).length;
  const selectedSectionCount = sections.filter((section) => section.selected).length;
  const workUnits = selectedCount * selectedSectionCount;

  return {
    projectId: String(rawProject?.id || rawProject?.slug || ""),
    projectName: String(rawProject?.name || ""),
    candidates,
    sections,
    selection: {
      selectedAdvisorProgramIds: [...draftIds],
      selectedSections: sections
        .filter((section) => section.selected)
        .map((section) => section.id),
      communityRequested: investigation.draft.communitySources.requested,
      revision: investigation.draft.revision,
    },
    cost: { workUnits, level: investigationCostLevel(workUnits) },
    confirmed: investigation.confirmed,
  };
}

export function renderInvestigationMenu(menu) {
  const lines = [];
  lines.push(`# 背调对象与维度选择（项目：${menu.projectName || menu.projectId}）`);
  lines.push("");
  lines.push("## 1. 候选导师—项目组合");
  lines.push("");
  lines.push("| No. | advisorProgramId | 导师 | 院校 | 项目 | 研究匹配 | 履历匹配 | 综合匹配 | 申请定位 | 硬条件 | 申请路径 | 下一步 | 招生状态 | 客观可行性 | 当前选择 |");
  lines.push("| ---: | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |");
  const selectedIds = new Set(menu.selection.selectedAdvisorProgramIds);
  for (const candidate of menu.candidates) {
    lines.push(
      `| ${candidate.no} | \`${candidate.advisorProgramId}\` | ${
        candidate.name || "待核实"
      } | ${candidate.school || "待核实"} | ${candidate.program || "待核实"} | ${
        candidate.fit ?? "—"
      } | ${candidate.profileMatch ?? "—"} | ${candidate.overallMatch ?? "—"} | ${
        candidate.competitiveness
      } | ${candidate.hardConstraintStatus} | ${candidate.applicationPathway} | ${
        candidate.recommendedAction
      } | ${candidate.status} | ${candidate.feasibility} | ${
        selectedIds.has(candidate.advisorProgramId) ? "已选" : "未选"
      } |`,
    );
  }
  lines.push("");
  lines.push("## 2. 背调维度");
  lines.push("");
  lines.push("| No. | ID | 维度 | 默认 | 当前选择 |");
  lines.push("| ---: | --- | --- | --- | --- |");
  for (const section of menu.sections) {
    lines.push(
      `| ${section.no} | \`${section.id}\` | ${section.label} | ${
        section.defaultSelected ? "默认勾选" : "默认不选"
      } | ${section.selected ? "已选" : "未选"} |`,
    );
  }
  lines.push("");
  lines.push("## 3. 当前工作量");
  lines.push("");
  lines.push(
    `已选 ${menu.selection.selectedAdvisorProgramIds.length} 个导师—项目组合 × ${menu.selection.selectedSections.length} 个维度 = ${menu.cost.workUnits} 个工作单元（${menu.cost.level}）`,
  );
  lines.push(
    `社区资料本地下载：${menu.selection.communityRequested ? "已请求" : "未请求"}；草稿版本 revision=${menu.selection.revision}`,
  );
  lines.push("");
  lines.push(
    "此选择菜单只读取 project.json、candidates.json 和上面的维度目录，不读取 advisor records、evidence bundles、社区缓存或历史结果，也不发起任何网络请求。确认后才按已选对象与维度开始背调。",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  if (!root) throw new Error("--root 后必须提供项目目录");
  const menu = await buildInvestigationMenu(root);
  process.stdout.write(
    args.includes("--json")
      ? `${JSON.stringify(menu, null, 2)}\n`
      : renderInvestigationMenu(menu),
  );
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
