#!/usr/bin/env node

import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const COLORS = {
  ink: "#1F2937",
  muted: "#6B7280",
  header: "#4338A8",
  headerSoft: "#EEEAFE",
  line: "#DDD9EA",
  green: "#DCFCE7",
  amber: "#FEF3C7",
  red: "#FEE2E2",
  white: "#FFFFFF",
};

function parseArgs(argv) {
  const args = { input: "", output: "", previewDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--input") args.input = argv[++index] || "";
    else if (item === "--output") args.output = argv[++index] || "";
    else if (item === "--preview-dir") args.previewDir = argv[++index] || "";
  }
  if (!args.input || !args.output) {
    throw new Error(
      "Usage: build_application_ready_excel.mjs --input records.json --output result.xlsx [--preview-dir previews]",
    );
  }
  return args;
}

function safeRows(input) {
  return Array.isArray(input) ? input : [];
}

function multiline(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value === null || value === undefined) return "";
  return String(value);
}

function styleHeader(range) {
  range.format = {
    fill: COLORS.header,
    font: { bold: true, color: COLORS.white },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: COLORS.header },
  };
}

function styleBody(range) {
  range.format = {
    font: { color: COLORS.ink },
    verticalAlignment: "top",
    wrapText: true,
    borders: {
      insideHorizontal: { style: "thin", color: COLORS.line },
      bottom: { style: "thin", color: COLORS.line },
    },
  };
}

function addTableSheet(workbook, name, headers, rows, widths) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  styleHeader(sheet.getRangeByIndexes(0, 0, 1, headers.length));
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format.rowHeight = 34;
  if (rows.length) {
    sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
    styleBody(sheet.getRangeByIndexes(1, 0, rows.length, headers.length));
  }
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(Math.min(2, headers.length));
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, Math.max(rows.length + 1, 1), 1).format.columnWidth =
      width;
  });
  if (rows.length) {
    sheet.tables.add(
      sheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length),
      true,
      `T${name.replace(/[^A-Za-z0-9]/g, "") || "Data"}Table`,
    );
  }
  return sheet;
}

async function build(input, outputPath, previewDir = "") {
  const workbook = Workbook.create();
  const applicationRows = safeRows(input.applicationRows);
  const primaryHeaders = [
    "申请优先级",
    "学校名称",
    "QS 综合排名",
    "QS 版本",
    "专业名称（中文）",
    "Program Name (English)",
    "学位与申请季",
    "专业链接",
    "申请截止日期",
    "学费",
    "奖学金项目",
    "申请要求及材料",
    "RP 字数要求",
    "导师姓名",
    "导师研究方向（论文）",
    "导师邮箱",
    "导师官网链接",
    "导师招生与联系要求",
    "研究匹配分",
    "客观申请可行性",
    "背调结论",
    "风险与信息缺口",
    "最后核实日期",
    "关键官方来源",
  ];
  const primaryRows = applicationRows.map((row) => [
    "",
    row.schoolName || "",
    Number.isFinite(Number(row.qsRank)) ? Number(row.qsRank) : null,
    row.qsEdition || "",
    row.programNameZh || "",
    row.programNameEn || "",
    multiline([row.degree, row.intake].filter(Boolean)),
    row.programUrl || "",
    row.deadline || "",
    row.tuition || "",
    multiline(row.scholarships),
    multiline(row.applicationMaterials),
    multiline(row.rpRequirement),
    row.advisorName || "",
    multiline(row.researchAndPapers),
    row.advisorEmail || "",
    row.advisorHomepage || "",
    multiline(row.advisorContactRequirements),
    Number.isFinite(Number(row.researchFit)) ? Number(row.researchFit) : null,
    row.feasibility || "needs_confirmation",
    multiline(row.backcheckSummary),
    multiline(row.risksAndGaps),
    row.lastVerifiedAt || "",
    multiline(row.officialSources),
  ]);
  const primary = addTableSheet(
    workbook,
    "1_申请就绪总表",
    primaryHeaders,
    primaryRows,
    [12, 20, 11, 12, 22, 24, 18, 34, 18, 18, 34, 44, 24, 18, 46, 25, 34, 44, 12, 16, 44, 40, 20, 44],
  );
  if (primaryRows.length) {
    primary.getRange("A2").formulas = [
      [
        '=IF(T2="ineligible","排除",IF(T2="needs_confirmation","待确认",IF(S2>=8.5,"A",IF(S2>=7,"B","C"))))',
      ],
    ];
    primary.getRange(`A2:A${primaryRows.length + 1}`).fillDown();
    primary.getRange(`C2:C${primaryRows.length + 1}`).format.numberFormat = "0";
    primary.getRange(`S2:S${primaryRows.length + 1}`).format.numberFormat = "0.0";
    primary.getRange(`T2:T${primaryRows.length + 1}`).conditionalFormats.add(
      "cellIs",
      { operator: "equal", formula: '"eligible"', format: { fill: COLORS.green } },
    );
    primary.getRange(`T2:T${primaryRows.length + 1}`).conditionalFormats.add(
      "cellIs",
      {
        operator: "equal",
        formula: '"needs_confirmation"',
        format: { fill: COLORS.amber },
      },
    );
    primary.getRange(`T2:T${primaryRows.length + 1}`).conditionalFormats.add(
      "cellIs",
      { operator: "equal", formula: '"ineligible"', format: { fill: COLORS.red } },
    );
  }

  addTableSheet(
    workbook,
    "2_研究匹配与选择",
    ["advisorProgramId", "导师", "学校", "项目", "研究匹配分", "选择状态", "匹配证据"],
    safeRows(input.fitRows).map((row) => [
      row.advisorProgramId || "",
      row.advisorName || "",
      row.school || "",
      row.program || "",
      Number.isFinite(Number(row.researchFit)) ? Number(row.researchFit) : null,
      row.selected ? "已选择" : "未选择",
      multiline(row.fitEvidence),
    ]),
    [30, 18, 20, 24, 12, 12, 48],
  );

  addTableSheet(
    workbook,
    "3_背调证据",
    ["导师", "调查维度", "结论/线索", "证据强度", "核验状态", "来源 URL", "查询日期"],
    safeRows(input.evidenceRows).map((row) => [
      row.advisorName || "",
      row.sectionLabel || row.sectionId || "",
      multiline(row.finding),
      row.evidenceStrength || "",
      row.status || "",
      row.url || "",
      row.accessedAt || "",
    ]),
    [18, 24, 52, 18, 18, 46, 20],
  );

  addTableSheet(
    workbook,
    "4_申请来源与时效",
    ["实体", "字段", "当前值", "字段状态", "官方来源 URL", "最后核实日期", "缺口/冲突"],
    safeRows(input.sourceRows).map((row) => [
      row.entity || "",
      row.field || "",
      multiline(row.value),
      row.status || "",
      row.url || "",
      row.accessedAt || "",
      multiline(row.gap),
    ]),
    [28, 20, 46, 16, 48, 20, 38],
  );

  const configurationRows = [
    ["生成日期", input.generatedAt || new Date().toISOString()],
    ["目标学位与申请季", multiline([input.config?.degree, input.config?.intake])],
    ["目标范围", input.config?.target || ""],
    ["研究兴趣与权重", multiline(input.config?.interests)],
    ["已选背调维度", multiline(input.config?.selectedSections)],
    ["社区资料授权", input.config?.communityConsented ? "已授权本地使用" : "未授权"],
    [
      "证据规则",
      "官方来源 > 身份可确认的一手经历 > 匿名线索；镜像与转载不算独立来源；匿名线索不直接改分。",
    ],
    [
      "免责声明",
      "截止日期、学费、招生状态和奖学金会变化；正式申请前须重新打开官方页面核实。本表不构成录取或导师行为保证。",
    ],
  ];
  const config = addTableSheet(
    workbook,
    "5_配置与说明",
    ["项目", "内容"],
    configurationRows,
    [24, 100],
  );
  config.getRange("B2").values = [[new Date(input.generatedAt || Date.now())]];
  config.getRange("B2").format.numberFormat = "yyyy-mm-dd hh:mm";
  config.getRange(`B2:B${configurationRows.length + 1}`).format.rowHeight = 44;

  await fs.mkdir(dirname(resolve(outputPath)), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);

  if (previewDir) {
    await fs.mkdir(previewDir, { recursive: true });
    for (const sheetName of [
      "1_申请就绪总表",
      "2_研究匹配与选择",
      "3_背调证据",
      "4_申请来源与时效",
      "5_配置与说明",
    ]) {
      const preview = await workbook.render({
        sheetName,
        autoCrop: "all",
        scale: 1,
        format: "png",
      });
      await fs.writeFile(
        resolve(previewDir, `${sheetName}.png`),
        new Uint8Array(await preview.arrayBuffer()),
      );
    }
  }
  return workbook;
}

const args = parseArgs(process.argv.slice(2));
const input = JSON.parse(await fs.readFile(args.input, "utf8"));
await build(input, resolve(args.output), args.previewDir ? resolve(args.previewDir) : "");
console.log(JSON.stringify({ output: resolve(args.output), rows: safeRows(input.applicationRows).length }));
