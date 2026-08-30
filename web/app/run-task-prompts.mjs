export const defaultTask = `从 Phase 1 开始导师匹配。

Phase 1 启动前只检查：
1. 已填写目标学校或目标范围
2. 已上传可读取的真实 CV

目标学位和申请季可以稍后补充，但进入客观申请条件筛选前必须齐全。
研究兴趣和权重是可选补充；没有权重时按等权处理。
严格保留每条关键结论的来源。`;

export function buildPhaseOneTaskPrompt({ project, filePath = "" }) {
  const interests = project?.interests?.length
    ? project.interests
        .map((interest) => `${interest.name} ${interest.weight}%`)
        .join("，")
    : "未提供；请以 CV 为主要匹配信号";

  return `${defaultTask}

当前已保存的 Phase 1 输入：
- CV：${project?.cv?.path || filePath || "未上传"}
- 申请目标：${project?.target || "未填写"}
- 目标学位与申请季：${project?.degree || "未填写"} · ${project?.season || "未填写"}
- 研究兴趣权重：${interests}
- shortlist：Top ${project?.shortlistTarget || 10}

仅调查目标范围内的导师。Phase 1 不检索社区风评或其他 Phase 2 信息；优先复用同一官方页面中的项目与申请条件，避免重复搜索。`;
}

export function buildInvestigationTaskPrompt() {
  return "开始 Phase 2：按当前项目已确认的精确导师—项目组合、调查维度与社区资料授权执行背调。";
}

export function buildRankingTaskPrompt() {
  return "使用当前项目已有的真实候选导师、客观条件与已确认背调证据生成最终排名。";
}

export function buildApplicationMaterialTaskPrompt(mode) {
  if (mode === "research_proposal") {
    return "为当前项目已确认的精确导师—项目目标生成 Research Proposal 与可核验文献包。";
  }
  if (mode === "outreach_email") {
    return "为当前项目已确认的精确导师—项目目标生成一封可复制的陶瓷信与引用审计。";
  }
  throw new Error(`未知申请材料模式：${mode}`);
}
