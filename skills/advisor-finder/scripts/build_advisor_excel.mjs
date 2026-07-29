#!/usr/bin/env node

import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") parsed.input = argv[++index];
    else if (argv[index] === "--output") parsed.output = argv[++index];
  }
  if (!parsed.input || !parsed.output) {
    throw new Error("Usage: build_advisor_excel.mjs --input records.json --output shortlist.xlsx");
  }
  return parsed;
}

function lines(value) {
  return Array.isArray(value) ? value.filter(Boolean).join("\n") : String(value ?? "");
}

function addSheet(workbook, name, headers, rows, widths) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: "#4338A8",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  if (rows.length) {
    sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
    sheet.getRangeByIndexes(1, 0, rows.length, headers.length).format = {
      verticalAlignment: "top",
      wrapText: true,
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

const args = parseArgs(process.argv.slice(2));
const input = JSON.parse(await fs.readFile(args.input, "utf8"));
const rows = Array.isArray(input.candidates) ? input.candidates : [];
const interests = Array.isArray(input.interests) ? input.interests : [];
const workbook = Workbook.create();

const headers = [
  "排名",
  "advisorProgramId",
  "导师",
  "学校",
  "项目",
  ...interests.map((item) => `${item.name} (${item.weight}%)`),
  "研究匹配分",
  "招生状态",
  "客观申请可行性",
  "可行性理由",
  "研究方向与近期论文",
  "导师招生与联系要求",
  "主页",
  "邮箱",
  "待补信息",
];
const data = rows.map((row, index) => [
  row.rank || index + 1,
  row.advisorProgramId || "",
  row.name || "",
  row.school || "",
  row.program || "",
  ...interests.map((interest) => Number(row.fitScores?.[interest.name] ?? 0)),
  Number.isFinite(Number(row.fit)) ? Number(row.fit) : null,
  row.status || "待核实",
  row.feasibility || "needs_confirmation",
  lines(row.feasibilityReasons),
  lines(row.researchAndPapers || row.directions),
  lines(row.advisorContactRequirements),
  row.homepage || "",
  row.email || "",
  lines(row.missingFields),
]);
const shortlist = addSheet(
  workbook,
  "1_候选与客观筛选",
  headers,
  data,
  [8, 30, 18, 20, 24, ...interests.map(() => 12), 12, 15, 18, 38, 48, 42, 34, 25, 34],
);
if (data.length) {
  const fitColumn = 6 + interests.length;
  shortlist
    .getRangeByIndexes(1, fitColumn, data.length, 1)
    .format.numberFormat = "0.0";
}

addSheet(
  workbook,
  "2_官方申请条件",
  [
    "programId",
    "学校",
    "QS 排名与版本",
    "项目中英文名称",
    "学位与申请季",
    "截止日期",
    "学费",
    "奖学金",
    "申请要求及材料",
    "RP 要求",
    "最后核实日期",
    "官方来源",
  ],
  (input.programs || []).map((row) => [
    row.programId || "",
    row.schoolName || "",
    lines([row.qsRank, row.qsEdition].filter(Boolean)),
    lines([row.programNameZh, row.programNameEn].filter(Boolean)),
    lines([row.degree, row.intake].filter(Boolean)),
    row.deadline || "",
    row.tuition || "",
    lines(row.scholarships),
    lines(row.applicationMaterials),
    lines(row.rpRequirement),
    row.lastVerifiedAt || "",
    lines(row.officialSources),
  ]),
  [30, 20, 18, 28, 18, 18, 18, 34, 46, 24, 20, 48],
);

addSheet(
  workbook,
  "3_来源与缺口",
  ["实体", "字段", "状态", "来源 URL", "查询日期", "短证据/缺口"],
  (input.sources || []).map((row) => [
    row.entity || "",
    row.field || "",
    row.status || "",
    row.url || "",
    row.accessedAt || "",
    lines(row.note || row.excerpt),
  ]),
  [28, 20, 16, 48, 20, 48],
);

await fs.mkdir(dirname(resolve(args.output)), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(resolve(args.output));
console.log(JSON.stringify({ output: resolve(args.output), candidates: rows.length }));
