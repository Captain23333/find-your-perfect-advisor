# Application-ready workbook contract

Create one primary workbook named `advisor_application_ready_YYYYMMDD.xlsx`.

## Row grain

Each primary row represents one real:

`school × program × degree/intake × advisor`

Do not collapse multiple programs for one advisor into one ambiguous row.

## Sheet 1: 申请就绪总表

Use these columns:

1. 申请优先级
2. 学校名称
3. QS 综合排名
4. QS 版本
5. 专业名称（中文）
6. Program Name (English)
7. 学位与申请季
8. 专业链接
9. 申请截止日期
10. 学费
11. 奖学金项目
12. 申请要求及材料
13. RP 字数要求
14. 导师姓名
15. 导师研究方向（论文）
16. 导师邮箱
17. 导师官网链接
18. 导师招生与联系要求
19. 研究匹配分
20. 客观申请可行性
21. 背调结论
22. 风险与信息缺口
23. 最后核实日期
24. 关键官方来源

Use multiline cells for application materials, scholarships, advisor
requirements, research, backcheck findings, and gaps.

## Other sheets

- `2_研究匹配与选择`: research scores, fit evidence, and user selections.
- `3_背调证据`: selected section, finding, evidence strength, conflict state,
  URL, and access date.
- `4_申请来源与时效`: field-level official sources, dates, and stale/missing
  fields.
- `5_配置与说明`: user constraints, selected sections, scoring weights,
  evidence rules, and disclaimers.

## Scoring

- Keep research fit numeric and auditable.
- Keep objective feasibility categorical and show failure reasons.
- Score only Detective dimensions that the user selected consistently for the
  compared advisors.
- Do not treat `not_found` as zero.
- Do not normalize away a severe verified risk. Display it separately even
  when the total score is high.
- Anonymous leads cannot directly change a score without independent
  corroboration.

## Formatting

- Freeze the primary header and the first identifying columns.
- Enable filters.
- Use conditional formatting for feasibility and risk.
- Store dates, ranks, tuition numbers, and scores as typed values when known.
- Keep source URLs as plain text.
- Verify formula cells and scan for Excel errors before delivery.
