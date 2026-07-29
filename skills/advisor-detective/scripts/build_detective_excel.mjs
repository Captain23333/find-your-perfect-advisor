#!/usr/bin/env node

import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

function args(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") parsed.input = argv[++index];
    else if (argv[index] === "--output") parsed.output = argv[++index];
  }
  if (!parsed.input || !parsed.output) {
    throw new Error("Usage: build_detective_excel.mjs --input records.json --output result.xlsx");
  }
  return parsed;
}

function text(value) {
  return Array.isArray(value) ? value.filter(Boolean).join("\n") : String(value ?? "");
}

function setupSheet(workbook, name, headers, rows, widths) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: "#4338A8",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  if (rows.length) {
    sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
    sheet.getRangeByIndexes(1, 0, rows.length, headers.length).format = {
      wrapText: true,
      verticalAlignment: "top",
      borders: {
        insideHorizontal: { style: "thin", color: "#DDD9EA" },
        bottom: { style: "thin", color: "#DDD9EA" },
      },
    };
    sheet.tables.add(
      sheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length),
      true,
      `T${name.replace(/[^A-Za-z0-9]/g, "") || "Rows"}Table`,
    );
  }
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(2);
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, rows.length + 1, 1).format.columnWidth = width;
  });
  return sheet;
}

const parsed = args(process.argv.slice(2));
const input = JSON.parse(await fs.readFile(parsed.input, "utf8"));
const sections = Array.isArray(input.sections) ? input.sections : [];
const advisors = Array.isArray(input.advisors) ? input.advisors : [];
const workbook = Workbook.create();

const headers = ["advisorProgramId", "导师", "学校与项目", ...sections.map((item) => item.label), "风险与冲突"];
const rows = advisors.map((advisor) => [
  advisor.advisorProgramId || "",
  advisor.name || "",
  text([advisor.school, advisor.program].filter(Boolean)),
  ...sections.map((section) =>
    text(
      advisor.sectionResults?.[section.id] ??
        (advisor.selectedSections?.includes(section.id)
          ? "检查后未找到可靠公开信息"
          : "用户未选择复核"),
    ),
  ),
  text(advisor.risksAndConflicts),
]);
setupSheet(
  workbook,
  "1_导师背调汇总",
  headers,
  rows,
  [30, 18, 28, ...sections.map(() => 38), 40],
);

setupSheet(
  workbook,
  "2_证据",
  ["导师", "调查维度", "结论/线索", "证据强度", "核验状态", "来源 URL", "查询日期"],
  (input.evidence || []).map((row) => [
    row.advisorName || "",
    row.sectionLabel || row.sectionId || "",
    text(row.finding),
    row.evidenceStrength || "",
    row.status || "",
    row.url || "",
    row.accessedAt || "",
  ]),
  [18, 24, 50, 18, 18, 48, 20],
);

setupSheet(
  workbook,
  "3_调查配置",
  ["项目", "内容"],
  [
    ["已选导师—项目", advisors.map((row) => row.advisorProgramId).join("\n")],
    ["已选调查维度", sections.map((row) => row.label).join("\n")],
    ["社区资料授权", input.communityConsented ? "已授权本地使用" : "未授权"],
    ["社区资料检索状态", input.communitySearchReady ? "已完成可搜索文本检索" : "未完成检索"],
    ["证据边界", "匿名资料仅作线索；镜像不算独立来源；保留反驳、更正与冲突。"],
  ],
  [24, 90],
);

await fs.mkdir(dirname(resolve(parsed.output)), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(resolve(parsed.output));
console.log(JSON.stringify({ output: resolve(parsed.output), advisors: advisors.length }));
