#!/usr/bin/env node

import fs from "node:fs/promises";
import { resolve } from "node:path";
import {
  dateCell,
  writeWorkbook,
} from "../../advisor-pipeline/scripts/workbook-runtime.mjs";

const COLORS = {
  green: "#DCFCE7",
  amber: "#FEF3C7",
  red: "#FEE2E2",
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

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applicationPriority(row) {
  if (
    row.hardConstraintStatus === "fail" ||
    row.feasibility === "ineligible" ||
    row.opportunityStatus === "verified_closed"
  ) return "排除";
  if (
    row.hardConstraintStatus !== "pass" ||
    row.feasibility !== "eligible" ||
    !row.applicationPathway ||
    row.applicationPathway === "unknown" ||
    (["supervisor_led", "advertised_position"].includes(row.applicationPathway) &&
      row.opportunityStatus === "unknown")
  ) return "待确认";
  if (row.competitiveness === "reach") return "冲刺";
  if (row.competitiveness === "match") return "主申";
  if (row.competitiveness === "safer") return "相对稳妥";
  return "待确认";
}

function tableSheet(name, headers, rows, widths, options = {}) {
  return {
    name,
    headers,
    rows,
    widths,
    freezeRows: 1,
    freezeColumns: Math.min(2, headers.length),
    ...options,
  };
}

async function build(input, outputPath, previewDir = "") {
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
    "履历匹配分",
    "综合匹配分",
    "申请定位",
    "硬条件状态",
    "硬条件依据",
    "申请路径",
    "机会状态",
    "建议下一步",
    "客观申请可行性",
    "背调结论",
    "风险与信息缺口",
    "最后核实日期",
    "关键官方来源",
  ];
  const primaryRows = applicationRows.map((row) => [
    applicationPriority(row),
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
    optionalNumber(row.researchFit),
    optionalNumber(row.profileMatch),
    optionalNumber(row.overallMatch),
    row.competitiveness || "unknown",
    row.hardConstraintStatus || "unknown",
    multiline(row.hardConstraintReasons),
    row.applicationPathway || "unknown",
    row.opportunityStatus || "unknown",
    row.recommendedAction || "verify_pathway",
    row.feasibility || "needs_confirmation",
    multiline(row.backcheckSummary),
    multiline(row.risksAndGaps),
    row.lastVerifiedAt || "",
    multiline(row.officialSources),
  ]);
  const sheets = [tableSheet(
    "1_申请就绪总表",
    primaryHeaders,
    primaryRows,
    [14, 20, 11, 12, 22, 24, 18, 34, 18, 18, 34, 44, 24, 18, 46, 25, 34, 44, 12, 12, 12, 14, 14, 42, 18, 16, 18, 16, 44, 40, 20, 44],
    {
      numberFormats: [
        { column: 2, format: "0" },
        { column: 18, format: "0.0" },
        { column: 19, format: "0.0" },
        { column: 20, format: "0.0" },
      ],
      conditionalFormats: primaryRows.length
        ? [
            { column: 27, formula: '"eligible"', fill: COLORS.green, dxfId: 0 },
            { column: 27, formula: '"needs_confirmation"', fill: COLORS.amber, dxfId: 1 },
            { column: 27, formula: '"ineligible"', fill: COLORS.red, dxfId: 2 },
          ]
        : [],
    },
  ),
  tableSheet(
    "2_研究匹配与选择",
    ["advisorProgramId", "导师", "学校", "项目", "研究匹配分", "履历匹配分", "综合匹配分", "申请定位", "硬条件", "申请路径", "机会状态", "下一步", "选择状态", "匹配证据"],
    safeRows(input.fitRows).map((row) => [
      row.advisorProgramId || "",
      row.advisorName || "",
      row.school || "",
      row.program || "",
      optionalNumber(row.researchFit),
      optionalNumber(row.profileMatch),
      optionalNumber(row.overallMatch),
      row.competitiveness || "unknown",
      row.hardConstraintStatus || "unknown",
      row.applicationPathway || "unknown",
      row.opportunityStatus || "unknown",
      row.recommendedAction || "verify_pathway",
      row.selected ? "已选择" : "未选择",
      multiline(row.fitEvidence),
    ]),
    [30, 18, 20, 24, 12, 12, 12, 14, 14, 18, 16, 18, 12, 48],
    { numberFormats: [4, 5, 6].map((column) => ({ column, format: "0.0" })) },
  ),
  tableSheet(
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
  ),
  tableSheet(
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
  )];

  const configurationRows = [
    ["生成日期", dateCell(input.generatedAt || new Date())],
    ["目标学位与申请季", multiline([input.config?.degree, input.config?.intake])],
    ["目标范围", input.config?.target || ""],
    ["必须满足的硬条件", input.config?.hardConstraints || ""],
    ["申请组合策略", input.config?.portfolioStrategy || "balanced"],
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
  sheets.push(tableSheet(
    "5_配置与说明",
    ["项目", "内容"],
    configurationRows,
    [24, 100],
    {
      numberFormats: [{ column: 1, startRow: 1, endRow: 1, format: "yyyy-mm-dd hh:mm" }],
      rowHeights: configurationRows.map((_, index) => ({ row: index + 1, height: 44 })),
    },
  ));

  return writeWorkbook(
    { sheets },
    resolve(outputPath),
    {
      previewDir: previewDir ? resolve(previewDir) : "",
      forcePortable: process.env.ADVISOR_ATLAS_FORCE_PORTABLE_XLSX === "1",
    },
  );
}

const args = parseArgs(process.argv.slice(2));
const input = JSON.parse(await fs.readFile(args.input, "utf8"));
const result = await build(input, resolve(args.output), args.previewDir ? resolve(args.previewDir) : "");
console.log(JSON.stringify({
  output: resolve(args.output),
  rows: safeRows(input.applicationRows).length,
  workbookEngine: result.engine,
  previewStatus: result.previewStatus || (result.previews?.length ? "created" : "not_requested"),
}));
