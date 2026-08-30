#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeApplicationMaterials } from "./project-contract.mjs";
import { isExecutedDirectly } from "./direct-execution.mjs";

export async function buildApplicationMaterialsMenu(root) {
  const projectRoot = resolve(root);
  const [project, rankingFile] = await Promise.all([
    readFile(resolve(projectRoot, "project.json"), "utf8").then(JSON.parse),
    readFile(resolve(projectRoot, "outputs", "ranking.json"), "utf8").then(JSON.parse),
  ]);
  const rankings = Array.isArray(rankingFile)
    ? rankingFile
    : Array.isArray(rankingFile?.rankings)
      ? rankingFile.rankings
      : Array.isArray(rankingFile?.ranking)
        ? rankingFile.ranking
        : [];
  if (!rankings.length) throw new Error("请先完成 outputs/ranking.json");
  const applicationMaterials = normalizeApplicationMaterials(project.applicationMaterials);
  return {
    projectId: String(project.id || project.slug || ""),
    projectName: String(project.name || ""),
    rankings: rankings.map((item, index) => ({
      no: index + 1,
      advisorProgramId: String(item?.advisorProgramId || "").trim(),
      rank: Number(item?.rank || index + 1),
      name: String(item?.name || "").trim(),
      school: String(item?.school || "").trim(),
      program: String(item?.program || "").trim(),
      score: Number(item?.totalScore ?? item?.score ?? 0),
    })),
    draft: applicationMaterials.draft,
    confirmed: applicationMaterials.confirmed,
  };
}

export function renderApplicationMaterialsMenu(menu) {
  const lines = [
    `# 申请材料目标确认（项目：${menu.projectName || menu.projectId}）`,
    "",
    "## 1. 从最终排名选择一个精确导师—项目组合",
    "",
    "| No. | 排名 | advisorProgramId | 导师 | 院校 | 项目 | 总分 |",
    "| ---: | ---: | --- | --- | --- | --- | ---: |",
  ];
  for (const item of menu.rankings) {
    lines.push(
      `| ${item.no} | ${item.rank} | \`${item.advisorProgramId}\` | ${item.name || "待核实"} | ${item.school || "待核实"} | ${item.program || "待核实"} | ${item.score} |`,
    );
  }
  lines.push(
    "",
    "## 2. 选择材料与顺序",
    "",
    "- `research_proposal`：Research Proposal / concept note",
    "- `outreach_email`：陶瓷信 / follow-up / advertised-position reply",
    "- 选择两项时必须明确顺序；不会自动选择排名第一或批量群发。",
    "",
    "## 3. 固定文献核验条件",
    "",
    "每种材料都必须同时列出导师本人/团队文献与领域文献。导师文献要核验本人署名或公开团队关系；独立领域文献不得含目标导师署名。被引用文献只从合法公开页面下载，保存本地 PDF，并记录 canonical URL、获取依据、读取层级、SHA-256、文件大小和用途；不得绕过付费墙。",
    "",
    `当前草稿：advisorProgramId=${menu.draft.advisorProgramId || "未选"}；materials=${menu.draft.materials.join(",") || "未选"}；order=${menu.draft.order.join(" -> ") || "未定"}；revision=${menu.draft.revision}`,
    "",
    "确认前不启动搜索、下载、写作、发送邮件或提交 RP。",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  const menu = await buildApplicationMaterialsMenu(root);
  process.stdout.write(
    args.includes("--json")
      ? `${JSON.stringify(menu, null, 2)}\n`
      : renderApplicationMaterialsMenu(menu),
  );
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
