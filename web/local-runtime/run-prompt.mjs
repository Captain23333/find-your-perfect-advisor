import { resolve } from "node:path";

export const MODE_SKILLS = {
  finder: "advisor-finder",
  detective: "advisor-detective",
  ranking: "advisor-evaluator",
  research_proposal: "advisor-research-proposal",
  outreach_email: "advisor-outreach",
};

function installedSkillPath(projectPath, provider, mode) {
  const hostDirectory = provider === "claude" ? ".claude" : ".agents";
  return resolve(
    projectPath,
    hostDirectory,
    "skills",
    MODE_SKILLS[mode],
    "SKILL.md",
  );
}

function compact(value) {
  return JSON.stringify(value ?? null);
}

function commonPrompt({ userPrompt, projectPath, runDirectory, provider, mode }) {
  const outputPath = resolve(projectPath, "outputs");
  const skillPath = installedSkillPath(projectPath, provider, mode);
  return `${userPrompt}

本地控制台运行约束（仅含本阶段所需内容）：
- 当前唯一申请项目：${projectPath}
- 本阶段技能入口：${skillPath}。完整读取它，并只按其中与当前任务相关的引用路由；不要先加载其他阶段的 Skill。
- 共享 JSON 与最终产物写入 ${outputPath}；本次临时记录写入 ${runDirectory}。
- 复用项目中已有且仍有效的 CV、结构化记录和字段级证据。只查询缺失、过期或冲突字段；不得编造申请者、导师、项目、招生状态或来源。
- 保留 status.json 的 schemaVersion 2 和现有字段，只更新本阶段真实 phase、stage 与计数；尚未产生的结果保持 0。
- 不执行 git commit/push、发布、发送邮件或提交申请/RP。`;
}

function finderPrompt(project) {
  const shortlistTarget = Number(project.shortlistTarget) || 10;
  const portfolioStrategy = project.portfolioStrategy || "balanced";
  const hardConstraints = String(project.hardConstraints || "").trim() || "未提供";
  return `

Finder 专属约束：
- 启动条件是目标范围与可读取的真实 CV；研究兴趣仅为可选补充。学位和申请季可在发现后补齐，但客观申请筛选前必须具备。
- 用户明确硬条件：${hardConstraints}。硬条件先于任何分数；不满足就排除，官方证据不足就标 unknown，不得把未知当通过。
- 目标 shortlist 数量为 ${shortlistTarget}。单一学校/院系/研究所/实验室先覆盖完整合理官方名册，通常约 ${Math.min(60, shortlistTarget * 2)} 位相关候选；跨校或地区范围通常约 ${Math.min(60, shortlistTarget * 3)} 位，最多 60。不得凑数。
- 当前申请组合策略为 ${portfolioStrategy}。必须依据 CV 证据把候选标成 reach / match / safer / unknown；这是相对定位，不是录取概率或承诺。balanced 通常让 reach 不超过 shortlist 的约 30%，conservative 通常不超过约 20%，ambitious 可提高到约 50%；若目标范围内真实候选不足，可偏离比例但要说明。
- 先从目标项目官方规则识别 applicationPathway：supervisor_led / committee_led / advertised_position / structured_program / unknown；再核验 opportunityStatus：verified_open / signal_only / unknown / verified_closed。committee_led 不应因导师未回复而被判定无机会，advertised_position 必须优先关联具体岗位。
- 不得用学校名气、QS 排名、导师国籍、族裔、校友身份、职称或“年轻导师”本身代替机会证据。职称只能作为需要继续核验实验室阶段、经费和招生规则的线索。
- Finder 只做身份/现职、近期研究、代表作、初步匹配、官方招生信号和 shortlist 客观申请条件；不得提前运行社区风评、组内生态或全面社交调查。
- 写 outputs/advisor_records.json、program_records.json、evidence.json 和候选池 candidates.json。每行必须含真实稳定 advisorProgramId、name、school、program、fit（只表示研究匹配）、profileMatch、competitiveness、overallMatch、matchReasons、hardConstraintStatus/hardConstraintReasons、applicationPathway、opportunityStatus、status/statusTone、feasibility/feasibilityReasons、directions、evidence；overallMatch 会由确定性脚本重算为 60% 研究匹配 + 40% CV 履历匹配，硬条件、客观资格与机会证据保持独立，不得仅由学校名气或排名决定。不确定项明确标记 unknown/待核实。行动顺序必须是排除硬失败 → 核实未知路径 → 核实未知硬条件 → 核实未知申请资格 → 按路径申请或联系。
- 候选池写完后必须运行 node .agents/skills/advisor-finder/scripts/apply_matching_strategy.mjs --project-root ${project.path}（Claude 可用同项目中的等价 .claude 路径）。该脚本是 shortlist 与 reach 上限的唯一裁决器，会重写 candidates.json，并保存 candidates-excluded.json 和 matching-audit.json；不得手工覆盖脚本结果。
- 用 advisor-finder/scripts/build_advisor_excel.mjs 生成 outputs/advisor_shortlist_YYYYMMDD.xlsx。Builder 已内置无依赖 OOXML 后备；不得安装 Excel 包、创建或反复 patch runs/ 下的替代构建脚本。
- 若 CV 缺失、不可读取或内容明确不是真实申请者 CV，使用字段 cv；若缺少继续所需的 degree、season、target、interests 或 shortlistTarget，使用相应字段。单独输出一行 {"type":"input.requested","reason":"简短说明","fields":[{"id":"cv|degree|season|target|interests|shortlistTarget","label":"字段名","required":true}]} 后结束本轮。不要提问后空转或自行假设。`;
}

function detectivePrompt(project) {
  const confirmed = project.investigation?.confirmed || null;
  return `

Detective 专属约束：
- 本次授权快照：${compact(confirmed)}
- 只调查快照中的精确 selectedAdvisorProgramIds × selectedSections；不得按人数、姓名或 Top N 推断。复用 Finder 证据，只补缺失、过期或冲突项。
- outputs/detective-results.json 必须绑定 confirmedRevision=${confirmed?.revision ?? "null"} 与 confirmedFingerprint=${compact(confirmed?.fingerprint || null)}，记录 generatedAt，并为每个已选导师和维度写真实结论或 {"status":"not_completed","summary":"原因"}。
- 用 advisor-detective/scripts/build_detective_excel.mjs 生成 outputs/advisor_detective_YYYYMMDD.xlsx；使用 Builder 自带后备，不得创建或 patch 临时构建脚本。
- 社区缓存位于 ${resolve(project.path, "community-cache")}。只有 consented=true 且选中相关维度时可读取；searchReady 不为 true 时写“未完成检索”。匿名材料只作 anonymous_lead，不得当作事实或直接改分。`;
}

function rankingPrompt() {
  return `

Evaluator 专属约束：
- 读取现有 advisor/program/evidence、candidates.json、matching-audit.json、当前确认的 Detective 结果与项目约束；按稳定 advisor_program_id 连接，不做新的全量检索。
- 分开呈现研究匹配、履历匹配、硬条件、申请路径、机会证据、客观可行性和导师适合度；不得把未选择、未检查、未找到、访问失败或冲突证据混为 0 分。
- hardConstraintStatus=fail、feasibility=ineligible 或 opportunityStatus=verified_closed 必须排除；unknown 必须保留为待确认。committee_led 项目不得仅因导师未回复而降为“无机会”。
- 写 outputs/ranking.json，并用 advisor-evaluator/scripts/build_application_ready_excel.mjs 生成 outputs/advisor_application_ready_YYYYMMDD.xlsx；Builder 已内置后备，不得创建或 patch 临时构建脚本。ranking 必须保留 profileMatch、overallMatch、competitiveness、hardConstraintStatus/reasons、applicationPathway、opportunityStatus、recommendedAction、严重已核实风险、来源、新鲜度和下一步核验动作。`;
}

function materialCommonPrompt(project, mode, confirmedMaterialRanking) {
  const confirmed = project.applicationMaterials?.confirmed || null;
  const targetName = confirmedMaterialRanking?.name || "";
  return `

申请材料共用约束：
- 本次授权快照：${compact(confirmed)}；排名中的目标导师：${compact(targetName)}。
- 只处理当前 mode 与精确 advisorProgramId，绑定当前 revision/fingerprint；不得改成 rank 1、同名导师的其他项目或批量生成。
- 复用已验证的项目 CV 与 applicantName。申请者经历只能来自 CV/用户事实；官方文档类型、格式、联系规则与项目要求优先。
- 按 application-materials-contract 使用 advisor_work 与独立 field_work 两类证据。实际引用必须有可合法公开下载并经哈希核验的本地 PDF；不得绕过付费墙，metadata-only 不能支撑实质性主张。
- 申请者可见文件不得出现 TEST、DRAFT、DO NOT SUBMIT/SEND 或内部 QA 提示；未决项放入审计文件和最终交付说明。`;
}

function proposalPrompt() {
  return `

Research Proposal 专属约束：
- 先核验目标项目实际要求的文档类型、模板、篇幅、匿名与引用格式；没有要求而用户仍需讨论稿时明确制作 concept note。
- 写 research-proposal.tex、references.bib、proposal-evidence.md、proposal-review.md；BibTeX key 与 literatureId 一致。运行共享 builder 生成 PDF 和 proposal-build.json，并逐页渲染、抽取文本核验。不得把假设写成结果。`;
}

function outreachPrompt() {
  return `

Outreach 专属约束：
- 核验该项目是否适合直接联系、官方联系规则与附件要求；用“导师事实—CV 证据—可辩护连接”形成一封针对性邮件。
- 写干净可复制的 outreach-email.txt 和 outreach-audit.md；正文必须用已确认 applicantName 签名。不要发送、排程或打开邮件客户端。`;
}

export function buildRunPrompt({
  userPrompt,
  project,
  runDirectory,
  provider,
  mode,
  confirmedMaterialRanking = null,
}) {
  if (!MODE_SKILLS[mode]) throw new Error(`未知运行阶段：${mode}`);
  const base = commonPrompt({
    userPrompt,
    projectPath: project.path,
    runDirectory,
    provider,
    mode,
  });
  if (mode === "finder") return `${base}${finderPrompt(project)}`;
  if (mode === "detective") return `${base}${detectivePrompt(project)}`;
  if (mode === "ranking") return `${base}${rankingPrompt()}`;
  const material = materialCommonPrompt(
    project,
    mode,
    confirmedMaterialRanking,
  );
  return mode === "research_proposal"
    ? `${base}${material}${proposalPrompt()}`
    : `${base}${material}${outreachPrompt()}`;
}
