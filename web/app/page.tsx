"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Provider = "Claude Code" | "Codex" | "Custom API";
type View = "overview" | "candidates" | "evidence" | "ranking";
type RunnerMode = "finder" | "detective" | "ranking";
type RunState =
  | "idle"
  | "starting"
  | "running"
  | "waiting_permission"
  | "completed"
  | "failed"
  | "stopped";

type ProviderHealth = {
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  authDetail: string;
};

type RuntimeHealth = {
  runtime: {
    online: boolean;
    projectRoot: string;
    dataRoot: string;
  };
  providers: {
    codex: ProviderHealth;
    claude: ProviderHealth;
    custom: ProviderHealth;
  };
};

type ProjectStatus = {
  schemaVersion: number;
  phase: "intake" | "finder" | "detective" | "evaluator" | "completed";
  stage: string;
  candidateCount: number;
  shortlistCount: number;
  objectiveReadyCount: number;
  selectedCount: number;
  evidenceCount: number;
  evidenceCoverage: number;
  rankingCount: number;
  updatedAt: string | null;
};

type ProjectReadiness = {
  ready: boolean;
  phase1Ready: boolean;
  objectiveReady: boolean;
  completed: number;
  total: number;
  checks: Array<{ key: string; label: string; complete: boolean }>;
  missing: string[];
  objectiveChecks: Array<{ key: string; label: string; complete: boolean }>;
  objectiveMissing: string[];
  matchingSignal: "cv" | "interests" | "none";
  interestWeightTotal: number;
};

type AdvisorProject = {
  schemaVersion: number;
  id: string;
  slug: string;
  name: string;
  season: string;
  degree: string;
  target: string;
  shortlistTarget: number;
  interests: Array<{ name: string; weight: number }>;
  updatedAt: string;
  path: string;
  status: ProjectStatus;
  candidates: AdvisorCandidate[];
  detectiveResults: DetectiveResults | null;
  rankings: AdvisorRanking[];
  investigation: {
    draft: {
      selectedAdvisorProgramIds: string[];
      selectedSections: string[];
      communitySources: { requested: boolean };
      revision: number;
      updatedAt: string;
    };
    confirmed: {
      selectedAdvisorProgramIds: string[];
      selectedSections: string[];
      communitySources: { consented: boolean; consentedAt: string | null };
      revision: number;
      confirmedAt: string;
      fingerprint: string;
      source: "user_confirmed" | "legacy_artifact";
    } | null;
  };
  cv: {
    name: string;
    path: string;
    size: number;
    type: string;
    uploadedAt: string;
  } | null;
  readiness: ProjectReadiness;
};

type DetectiveSectionResult =
  | string
  | {
      status?: string;
      summary?: string;
      sourceIds?: string[];
    };

type DetectiveResults = {
  selectedSections: string[];
  results: Array<{
    advisorProgramId: string;
    name: string;
    sections: Record<string, DetectiveSectionResult>;
    evidenceCount: number;
  }>;
  evidenceCount: number;
  evidenceCoverage: number;
  generatedAt: string | null;
};

type AdvisorRanking = {
  advisorProgramId: string;
  rank: number;
  name: string;
  school?: string;
  program?: string;
  totalScore: number;
  rationale?: string;
  evidenceGaps: string[];
};

type AdvisorCandidate = {
  advisorProgramId: string;
  rank: number;
  initials: string;
  name: string;
  school: string;
  program: string;
  fit: number;
  status: string;
  statusTone: string;
  feasibility: "eligible" | "ineligible" | "needs_confirmation";
  feasibilityReasons: string[];
  directions: string[];
  evidence: number;
};

type RunEvent = {
  runId?: string;
  at?: string;
  type: string;
  source: string;
  message?: string;
  status?: string;
  outputDirectory?: string;
  permission?: PermissionRequest;
  permissionId?: string;
  decision?: PermissionDecision;
};

type PermissionDecision = "allow_once" | "allow_for_run" | "deny";

type PermissionRequest = {
  id: string;
  kind: "command" | "file" | "network" | "permission" | "tool";
  toolName: string;
  title: string;
  description: string | null;
  reason: string | null;
  command: string | null;
  cwd: string | null;
  path: string | null;
  input: unknown;
  requestedAt: string;
};

const runtimeUrl = "/api/runtime";
const providerKey: Record<Provider, keyof RuntimeHealth["providers"]> = {
  Codex: "codex",
  "Claude Code": "claude",
  "Custom API": "custom",
};

const detectiveSectionOptions = [
  { id: "identity_current_role", label: "基础身份与当前职位", defaultSelected: true },
  { id: "recent_research", label: "最近三年研究兴趣与方向", defaultSelected: true },
  { id: "current_projects_recruiting", label: "近期项目与招生状态", defaultSelected: true },
  { id: "research_output_trend", label: "研究产出与趋势" },
  { id: "group_members_outcomes", label: "课题组成员及去向" },
  { id: "guidance_group_ecology", label: "指导环境与组内生态" },
  { id: "work_style_pressure", label: "工作方式与压力" },
  { id: "resources_career_support", label: "资源、funding、署名与职业支持" },
  { id: "integrity_public_controversies", label: "学术诚信与公开争议" },
  { id: "international_student_support", label: "国际学生支持" },
  { id: "collaboration_industry_network", label: "合作者、产业和职业网络" },
];

type CommunityCacheStatus = {
  state: "missing" | "ready" | "unsearchable" | "refreshing";
  fetchedAt: string | null;
  searchReady: boolean;
  error: string | null;
};

const defaultTask = `请完整读取 skills/advisor-pipeline/SKILL.md，并从 Phase 1 开始导师匹配。

Phase 1 启动前只检查：
1. 已填写目标学校或目标范围
2. 已提供真实 CV，或者至少一个研究兴趣

目标学位和申请季可以稍后补充，但进入客观申请条件筛选前必须齐全。
研究兴趣和权重是可选补充；没有权重时按等权处理。
严格按照 skill 执行，并保留每条关键结论的来源。`;

function Sparkline() {
  return (
    <div className="sparkline" aria-label="候选导师匹配分趋势">
      {[42, 62, 53, 78, 66, 88, 82, 94].map((height, index) => (
        <span key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [provider, setProvider] = useState<Provider>("Codex");
  const [query, setQuery] = useState("");
  const [highFitOnly, setHighFitOnly] = useState(false);
  const [fileName, setFileName] = useState("尚未上传真实 CV");
  const [filePath, setFilePath] = useState("");
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "ready" | "failed">("idle");
  const [notice, setNotice] = useState("");
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [projects, setProjects] = useState<AdvisorProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsRoot, setProjectsRoot] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: "" });
  const [applicationDraft, setApplicationDraft] = useState<{
    season: string;
    degree: string;
    target: string;
    shortlistTarget: string;
    interests: Array<{ name: string; weight: string }>;
  }>({
    season: "",
    degree: "",
    target: "",
    shortlistTarget: "10",
    interests: [{ name: "", weight: "" }],
  });
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeDirty, setIntakeDirty] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerMode, setRunnerMode] = useState<RunnerMode>("finder");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState(defaultTask);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runId, setRunId] = useState("");
  const [runOutputDirectory, setRunOutputDirectory] = useState("");
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [lastRunActivityAt, setLastRunActivityAt] = useState(0);
  const [runStalled, setRunStalled] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [resolvingPermissionId, setResolvingPermissionId] = useState("");
  const [customForm, setCustomForm] = useState({
    name: "Custom API",
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [customState, setCustomState] = useState<"idle" | "checking" | "ready" | "failed">(
    "idle",
  );
  const [customMessage, setCustomMessage] = useState("");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef("");
  const intakeRef = useRef<HTMLElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const investigationSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const syncedProjectIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [communityConsent, setCommunityConsent] = useState(false);
  const [investigationSaving, setInvestigationSaving] = useState(false);
  const [investigationConfirmOpen, setInvestigationConfirmOpen] = useState(false);
  const [evidenceConfigOpen, setEvidenceConfigOpen] = useState(true);
  const [communityCache, setCommunityCache] = useState<CommunityCacheStatus>({
    state: "missing",
    fetchedAt: null,
    searchReady: false,
    error: null,
  });

  async function refreshProjects(preferredId?: string) {
    try {
      const response = await fetch(`${runtimeUrl}/api/projects`, { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取申请项目");
      const payload = await response.json();
      const nextProjects = payload.projects as AdvisorProject[];
      setProjects(nextProjects);
      setProjectsRoot(payload.root || "");
      setActiveProjectId((current) => {
        if (preferredId && nextProjects.some((item) => item.id === preferredId)) {
          return preferredId;
        }
        if (current && nextProjects.some((item) => item.id === current)) return current;
        return nextProjects[0]?.id || "";
      });
    } finally {
      setProjectsLoading(false);
    }
  }

  function showNotice(message: string, duration = 4200) {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimerRef.current = null;
    }, duration);
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshHealth() {
      try {
        const response = await fetch(`${runtimeUrl}/api/health`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("本地运行服务未响应");
        const payload = (await response.json()) as RuntimeHealth;
        if (!cancelled) {
          setRuntimeHealth(payload);
          setRuntimeError("");
          setRuntimeLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRuntimeHealth(null);
          setRuntimeError("本地运行服务未启动");
          setRuntimeLoading(false);
        }
      }
    }

    refreshHealth();
    refreshProjects().catch(() => setRuntimeError("无法读取本地申请项目"));
    const timer = window.setInterval(refreshHealth, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [runEvents]);

  useEffect(() => {
    if (!["starting", "running", "waiting_permission"].includes(runState)) {
      setRunStalled(false);
      return;
    }
    const timer = window.setInterval(() => {
      setRunStalled(
        lastRunActivityAt > 0 && Date.now() - lastRunActivityAt > 90_000,
      );
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [lastRunActivityAt, runState]);

  const activeProject = projects.find((item) => item.id === activeProjectId) || null;
  const candidates = useMemo(
    () => activeProject?.candidates || [],
    [activeProject?.candidates],
  );
  const detectiveResults = activeProject?.detectiveResults || null;
  const rankings = activeProject?.rankings || [];
  const detectiveComplete = Boolean(detectiveResults?.results.length);
  const rankingComplete = rankings.length > 0;
  const topRankings = rankings.slice(0, 3);
  const projectStatus: ProjectStatus = activeProject?.status || {
    schemaVersion: 2,
    phase: "intake",
    stage: "intake",
    candidateCount: 0,
    shortlistCount: 0,
    objectiveReadyCount: 0,
    selectedCount: 0,
    evidenceCount: 0,
    evidenceCoverage: 0,
    rankingCount: 0,
    updatedAt: null,
  };
  const detectiveEvidenceCount = ["detective", "evaluator", "completed"].includes(
    projectStatus.phase,
  )
    ? projectStatus.evidenceCount
    : 0;
  const projectReadiness: ProjectReadiness = activeProject?.readiness || {
    ready: false,
    phase1Ready: false,
    objectiveReady: false,
    completed: 0,
    total: 2,
    checks: [],
    missing: ["填写目标院校或地区范围", "上传 CV 或填写至少一个研究兴趣"],
    objectiveChecks: [],
    objectiveMissing: ["填写目标学位", "填写申请季"],
    matchingSignal: "none",
    interestWeightTotal: 0,
  };
  const draftInterestTotal = applicationDraft.interests.reduce(
    (sum, interest) => sum + (Number(interest.weight) || 0),
    0,
  );
  const hasDraftInterests = applicationDraft.interests.some((interest) =>
    interest.name.trim(),
  );
  const draftCompleted = [
    Boolean(applicationDraft.target.trim()),
    Boolean(filePath) || hasDraftInterests,
  ].filter(Boolean).length;
  const draftMissing = [
    !applicationDraft.target.trim() ? "填写目标院校或地区范围" : "",
    !filePath && !hasDraftInterests ? "上传 CV 或填写至少一个研究兴趣" : "",
  ].filter(Boolean);
  const draftPhaseOneReady = draftMissing.length === 0;
  const draftObjectiveMissing = [
    !applicationDraft.degree.trim() ? "填写目标学位" : "",
    !applicationDraft.season.trim() ? "填写申请季" : "",
  ].filter(Boolean);
  const displayedPhaseOneReady = intakeDirty
    ? draftPhaseOneReady
    : projectReadiness.phase1Ready;
  const displayedObjectiveReady = intakeDirty
    ? draftObjectiveMissing.length === 0
    : projectReadiness.objectiveReady;
  const activePermission = pendingPermissions[0] || null;
  const activePermissionDetail = activePermission
    ? activePermission.command ||
      activePermission.path ||
      activePermission.reason ||
      JSON.stringify(activePermission.input, null, 2)
    : "";
  const selectedSectionLabels = detectiveSectionOptions
    .filter((option) => selectedSections.has(option.id))
    .map((option) => option.label);
  const communityRelevant = [
    "guidance_group_ecology",
    "work_style_pressure",
    "resources_career_support",
  ].some((section) => selectedSections.has(section));
  const confirmedInvestigation = activeProject?.investigation?.confirmed || null;
  const confirmedMatchesCurrentDraft = Boolean(
    confirmedInvestigation &&
      confirmedInvestigation.selectedAdvisorProgramIds.length === selected.size &&
      confirmedInvestigation.selectedAdvisorProgramIds.every((id) => selected.has(id)) &&
      confirmedInvestigation.selectedSections.length === selectedSections.size &&
      confirmedInvestigation.selectedSections.every((id) => selectedSections.has(id)) &&
      confirmedInvestigation.communitySources.consented ===
        (communityRelevant && communityConsent),
  );
  const runnerContent =
    runnerMode === "detective"
      ? {
          kicker: "BACKGROUND CHECK",
          title: "开始导师背调",
          description: "按你勾选的维度调查已选导师，并保留可追溯证据。",
          runningLabel: "正在背调",
          startLabel: "开始背调",
          completionHint: "完成后会自动更新背调证据页面。",
          summary: [
            `只调查已选择的 ${selected.size} 位导师—项目组合`,
            `调查 ${selectedSectionLabels.length} 个维度：${selectedSectionLabels.join("、")}`,
            communityConsent
              ? "导师风评相关维度可使用已授权的本地社区资料"
              : "未授权社区资料；不会下载或读取本地红黑榜",
          ],
        }
      : runnerMode === "ranking"
        ? {
            kicker: "FINAL DECISION",
            title: "生成综合排名",
            description: "复用现有候选与背调证据，生成透明的最终排序。",
            runningLabel: "正在排名",
            startLabel: "生成排名",
            completionHint: "完成后会自动更新最终排名页面。",
            summary: [
              "复用当前项目已有候选与证据，不重新执行导师发现",
              "保留研究匹配、申请可行性、风险和证据缺口",
              "输出评分依据与来源，缺失信息不使用推测补齐",
            ],
          }
        : {
            kicker: "START MATCHING",
            title: "开始寻找导师",
            description: "根据当前项目资料执行低成本导师发现和客观筛选。",
            runningLabel: "正在寻找导师",
            startLabel: "开始寻找导师",
            completionHint: "完成后会自动更新候选导师页面。",
            summary: [
              "读取当前项目的 CV / 研究兴趣与目标范围",
              `建立与范围相称的发现池并筛选到 Top ${
                activeProject?.shortlistTarget || 10
              }`,
              "只补齐 shortlist 的客观申请条件，避免重复搜索",
            ],
          };

  useEffect(() => {
    if (!activeProject) return;
    // Saving a draft replaces the project object, so this effect would re-run on
    // every checkbox click and reset the panels the user is still working in.
    // Local editing state only needs to be re-seeded when the project changes.
    if (syncedProjectIdRef.current === activeProject.id) return;
    syncedProjectIdRef.current = activeProject.id;
    setApplicationDraft({
      season: activeProject.season || "",
      degree: activeProject.degree || "",
      target: activeProject.target || "",
      shortlistTarget: String(activeProject.shortlistTarget || 10),
      interests: activeProject.interests?.length
        ? activeProject.interests.map((interest) => ({
            name: interest.name,
            weight: String(interest.weight),
          }))
        : [{ name: "", weight: "" }],
    });
    setSelected(
      new Set(activeProject.investigation?.draft?.selectedAdvisorProgramIds || []),
    );
    setSelectedSections(
      new Set(activeProject.investigation?.draft?.selectedSections || []),
    );
    setCommunityConsent(
      Boolean(activeProject.investigation?.draft?.communitySources?.requested),
    );
    setFileName(activeProject.cv?.name || "尚未上传真实 CV");
    setFilePath(activeProject.cv?.path || "");
    setUploadState(activeProject.cv?.path ? "ready" : "idle");
    setIntakeDirty(false);
    setEvidenceConfigOpen(!activeProject.detectiveResults?.results.length);
    setInvestigationConfirmOpen(false);
  }, [activeProjectId, activeProject]);

  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`${runtimeUrl}/api/projects/${activeProjectId}/community-cache`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.cache) setCommunityCache(payload.cache);
      })
      .catch(() => {
        setCommunityCache({
          state: "missing",
          fetchedAt: null,
          searchReady: false,
          error: "无法读取本地社区资料状态",
        });
      });
  }, [activeProjectId]);
  const steps = [
    {
      number: "01",
      title: "发现候选导师",
      detail: "解析 CV、构建院系名册、完成研究方向匹配",
      meta:
        projectStatus.candidateCount > 0
          ? `发现池 ${projectStatus.candidateCount} 位，已筛出 ${candidates.length} 位`
          : projectReadiness.phase1Ready
            ? "资料已齐全，可以启动"
            : `Phase 1 准备 ${projectReadiness.completed}/${projectReadiness.total}`,
      state:
        projectStatus.phase === "intake"
          ? "current"
          : projectStatus.phase === "finder"
            ? "current"
            : "done",
    },
    {
      number: "02",
      title: "深度背景调查",
      detail: "论文主线、主页项目、社交动态与学生评价",
      meta:
        detectiveEvidenceCount > 0
          ? `已记录 ${detectiveEvidenceCount} 条背调证据`
          : projectStatus.candidateCount > 0
            ? "等待选择调查对象"
            : "等待导师搜索",
      state:
        detectiveComplete
          ? "done"
          : projectStatus.candidateCount > 0
            ? "current"
            : "waiting",
    },
    {
      number: "03",
      title: "综合评分与决策",
      detail: "研究匹配、客观可行性、风险提示与申请准备信息",
      meta: rankingComplete ? `已生成 ${rankings.length} 位排名` : "尚未开始",
      state: rankingComplete
        ? "done"
        : detectiveComplete
          ? "current"
          : "waiting",
    },
  ];

  const filtered = useMemo(
    () =>
      candidates.filter((candidate) =>
        `${candidate.name} ${candidate.school} ${candidate.program} ${candidate.directions.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) && (!highFitOnly || candidate.fit >= 8),
      ),
    [candidates, highFitOnly, query],
  );

  function toggleCandidate(advisorProgramId: string) {
    setInvestigationConfirmOpen(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(advisorProgramId)) next.delete(advisorProgramId);
      else next.add(advisorProgramId);
      void saveInvestigationConfiguration(
        { selectedAdvisorProgramIds: [...next] },
        false,
      ).catch(() => showNotice("导师选择暂时未能保存，请重试"));
      return next;
    });
  }

  function toggleDetectiveSection(sectionId: string) {
    setInvestigationConfirmOpen(false);
    setSelectedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        const defaultSection = detectiveSectionOptions.find(
          (item) => item.id === sectionId,
        )?.defaultSelected;
        if (
          defaultSection &&
          !window.confirm("取消这项可能让后续背调信息不完整或过时，仍要取消吗？")
        ) {
          return current;
        }
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      void saveInvestigationConfiguration(
        { selectedSections: [...next] },
        false,
      ).catch(() => showNotice("调查维度暂时未能保存，请重试"));
      return next;
    });
  }

  function exportCandidates() {
    if (!candidates.length) {
      showNotice("还没有候选导师可以导出");
      return;
    }
    const header = [
      "排名",
      "导师",
      "院校",
      "项目",
      "研究方向",
      "招生状态",
      "客观可行性",
      "客观条件说明",
      "证据数",
      "匹配分",
    ];
    const rows = candidates.map((candidate) => [
      candidate.rank,
      candidate.name,
      candidate.school,
      candidate.program,
      candidate.directions.join(" / "),
      candidate.status,
      candidate.feasibility,
      candidate.feasibilityReasons.join("；"),
      candidate.evidence,
      candidate.fit,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv" }));
    link.download = `${activeProject?.slug || "advisor"}-candidates.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showNotice("候选导师名单已导出");
  }

  function selectedProviderHealth() {
    return runtimeHealth?.providers[providerKey[provider]] ?? null;
  }

  function openRunner(prompt?: string, mode: RunnerMode = "finder") {
    if (prompt) setTaskPrompt(prompt);
    setRunnerMode(mode);
    setAdvancedOpen(false);
    setRunState("idle");
    setRunId("");
    runIdRef.current = "";
    setRunOutputDirectory("");
    setRunEvents([]);
    setPendingPermissions([]);
    setResolvingPermissionId("");
    setLastRunActivityAt(0);
    setRunStalled(false);
    setRunnerOpen(true);
  }

  function buildPhaseOnePrompt() {
    const project = activeProject;
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

  function firstUsableProvider(): Provider | null {
    if (runtimeHealth?.providers.codex.installed && runtimeHealth.providers.codex.loggedIn) {
      return "Codex";
    }
    if (
      runtimeHealth?.providers.claude.installed &&
      runtimeHealth.providers.claude.loggedIn
    ) {
      return "Claude Code";
    }
    if (runtimeHealth?.providers.custom.installed && runtimeHealth.providers.custom.loggedIn) {
      return "Custom API";
    }
    return null;
  }

  function closeRunner() {
    const health = runtimeHealth?.providers[providerKey[provider]];
    if (!health?.installed || !health.loggedIn) {
      const fallback = firstUsableProvider();
      if (fallback) setProvider(fallback);
    }
    setAdvancedOpen(false);
    setRunnerOpen(false);
  }

  function chooseProvider(item: Provider) {
    const health = runtimeHealth?.providers[providerKey[item]];
    if (health?.installed && health.loggedIn) {
      setProvider(item);
      return;
    }
    if (item === "Custom API") {
      setProvider(item);
      return;
    }
    showNotice(
      item === "Codex"
        ? "Codex 尚未登录，请先在本机完成登录"
        : "Claude Code 尚未登录，请先在本机完成登录",
    );
  }

  function focusApplicationInput() {
    intakeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    showNotice(
      projectReadiness.missing.length
        ? `请先完成：${projectReadiness.missing.join("、")}`
        : "申请资料已齐全",
    );
  }

  function updateInterest(
    index: number,
    field: "name" | "weight",
    value: string,
  ) {
    setIntakeDirty(true);
    setApplicationDraft((current) => ({
      ...current,
      interests: current.interests.map((interest, interestIndex) =>
        interestIndex === index ? { ...interest, [field]: value } : interest,
      ),
    }));
  }

  function updateApplicationField(
    field: "season" | "degree" | "target",
    value: string,
  ) {
    setIntakeDirty(true);
    setApplicationDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveApplicationProfile() {
    if (!activeProjectId) return;
    setIntakeSaving(true);
    try {
      const response = await fetch(`${runtimeUrl}/api/projects/${activeProjectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          season: applicationDraft.season,
          degree: applicationDraft.degree,
          target: applicationDraft.target,
          shortlistTarget: Number(applicationDraft.shortlistTarget) || 10,
          interests: applicationDraft.interests.map((interest) => ({
            name: interest.name,
            weight: Number(interest.weight),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "申请资料保存失败");
      await refreshProjects(activeProjectId);
      setIntakeDirty(false);
      showNotice(
        payload.project.readiness.phase1Ready
          ? "Phase 1 的资料已齐全，现在可以开始寻找导师"
          : `资料已保存，还需完成：${payload.project.readiness.missing.join("、")}`,
      );
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "申请资料保存失败");
    } finally {
      setIntakeSaving(false);
    }
  }

  function startPhaseOne() {
    if (!projectReadiness.phase1Ready) {
      focusApplicationInput();
      return;
    }
    openRunner(buildPhaseOnePrompt());
  }

  async function uploadCv(file: File | undefined) {
    if (!file) return;
    if (!activeProjectId) {
      showNotice("请先创建或选择一个申请项目");
      return;
    }
    setFileName(file.name);
    setUploadState("uploading");
    try {
      const response = await fetch(`${runtimeUrl}/api/files`, {
        method: "POST",
        headers: {
          "x-file-name": encodeURIComponent(file.name),
          "x-file-type": file.type || "application/octet-stream",
          "x-project-id": activeProjectId,
        },
        body: file,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "上传失败");
      setFilePath(payload.path);
      setUploadState("ready");
      await refreshProjects(activeProjectId);
      showNotice("CV 已保存到当前申请项目");
    } catch (error) {
      setUploadState("failed");
      showNotice(error instanceof Error ? error.message : "CV 本地保存失败");
    }
  }

  async function runAgent() {
    const health = selectedProviderHealth();
    if (!projectReadiness.phase1Ready) {
      setRunnerOpen(false);
      focusApplicationInput();
      return;
    }
    if (!health?.installed || !health.loggedIn || !activeProjectId) return;

    setRunState("starting");
    setRunEvents([]);
    setLastRunActivityAt(Date.now());
    setRunStalled(false);
    setRunId("");
    runIdRef.current = "";
    setRunOutputDirectory("");
    setPendingPermissions([]);

    try {
      const effectivePrompt = filePath
        ? `${taskPrompt}\n\n已上传 CV：${filePath}`
        : taskPrompt;
      const response = await fetch(`${runtimeUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          provider:
            provider === "Codex"
              ? "codex"
              : provider === "Claude Code"
                ? "claude"
                : "custom",
          prompt: effectivePrompt,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "无法启动本地 Agent");
      }
      if (!response.body) throw new Error("浏览器不支持流式输出");

      setRunState("running");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as RunEvent;
          setLastRunActivityAt(Date.now());
          setRunStalled(false);
          if (event.runId) {
            runIdRef.current = event.runId;
            setRunId(event.runId);
          }
          if (event.outputDirectory) setRunOutputDirectory(event.outputDirectory);
          if (event.type === "permission.requested" && event.permission) {
            setPendingPermissions((current) => [
              ...current.filter((item) => item.id !== event.permission?.id),
              event.permission as PermissionRequest,
            ]);
            setRunState("waiting_permission");
          }
          if (event.type === "permission.resolved" && event.permissionId) {
            setPendingPermissions((current) => {
              const next = current.filter((item) => item.id !== event.permissionId);
              if (!next.length) setRunState("running");
              return next;
            });
          }
          if (event.message) {
            setRunEvents((current) => {
              const previous = current[current.length - 1];
              if (
                event.type === "item/agentMessage/delta" &&
                previous?.type === event.type &&
                previous.source === event.source
              ) {
                return [
                  ...current.slice(0, -1),
                  {
                    ...previous,
                    message: `${previous.message || ""}${event.message || ""}`,
                  },
                ];
              }
              return [...current.slice(-399), event];
            });
          }
          if (event.type === "run.finished") {
            setPendingPermissions([]);
            setRunState((event.status as RunState) || "completed");
            await refreshProjects(activeProjectId);
            if (event.status === "completed") {
              if (runnerMode === "detective") {
                setView("evidence");
                // A finished round is the only reason to fold the configuration
                // away; editing the draft must leave the panel where it is.
                setEvidenceConfigOpen(false);
                setInvestigationConfirmOpen(false);
                showNotice("导师背调已完成，证据与风险信息已更新");
              } else if (runnerMode === "ranking") {
                setView("ranking");
                showNotice("综合排名已生成");
              } else {
                setView("candidates");
                showNotice("导师搜索已完成，候选名单已更新");
              }
            }
          }
        }
      }
    } catch (error) {
      setPendingPermissions([]);
      setRunState("failed");
      setRunEvents((current) => [
        ...current,
        {
          type: "run.error",
          source: "runtime",
          message: error instanceof Error ? error.message : "本地 Agent 启动失败",
        },
      ]);
    }
  }

  async function stopAgent() {
    const currentRunId = runIdRef.current || runId;
    if (!currentRunId) return;
    await fetch(`${runtimeUrl}/api/runs/${currentRunId}/stop`, { method: "POST" });
    setPendingPermissions([]);
    setRunState("stopped");
  }

  async function resolvePermission(permissionId: string, decision: PermissionDecision) {
    const currentRunId = runIdRef.current || runId;
    if (!currentRunId || resolvingPermissionId) return;
    setResolvingPermissionId(permissionId);
    try {
      const response = await fetch(
        `${runtimeUrl}/api/runs/${currentRunId}/permissions/${permissionId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "授权决定未能发送");
      setPendingPermissions((current) => {
        const next = current.filter((item) => item.id !== permissionId);
        if (!next.length) setRunState("running");
        return next;
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "授权决定未能发送");
    } finally {
      setResolvingPermissionId("");
    }
  }

  async function saveInvestigationConfiguration(
    overrides: {
      selectedAdvisorProgramIds?: string[];
      selectedSections?: string[];
      communityConsent?: boolean;
    } = {},
    refresh = true,
  ) {
    if (!activeProjectId) throw new Error("请先选择申请项目");
    const projectId = activeProjectId;
    const requestBody = {
      investigation: {
        draft: {
          selectedAdvisorProgramIds:
            overrides.selectedAdvisorProgramIds || [...selected],
          selectedSections: overrides.selectedSections || [...selectedSections],
          communitySources: {
            requested: overrides.communityConsent ?? communityConsent,
          },
        },
      },
    };
    const operation = investigationSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        const response = await fetch(`${runtimeUrl}/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "背调配置保存失败");
        setProjects((current) =>
          current.map((project) =>
            project.id === projectId ? payload.project : project,
          ),
        );
        if (refresh) await refreshProjects(projectId);
        return payload.project as AdvisorProject;
      });
    investigationSaveQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async function refreshCommunityKnowledge(projectOverride?: AdvisorProject) {
    if (!activeProjectId) return;
    const confirmed = projectOverride?.investigation.confirmed || confirmedInvestigation;
    if (!confirmed || !confirmed.communitySources.consented) {
      showNotice("请先最终确认包含社区资料授权的调查配置");
      return;
    }
    if (!projectOverride && !confirmedMatchesCurrentDraft) {
      showNotice("调查选择已发生变化，请重新确认后再刷新社区资料");
      return;
    }
    setCommunityCache((current) => ({ ...current, state: "refreshing" }));
    try {
      const response = await fetch(
        `${runtimeUrl}/api/projects/${activeProjectId}/community-cache`,
        { method: "POST" },
      );
      const payload = await response.json();
      if (payload.cache) setCommunityCache(payload.cache);
      if (!response.ok) {
        throw new Error(payload.error || payload.cache?.error || "社区资料刷新失败");
      }
      showNotice("社区资料已在当前申请项目中刷新并生成可搜索文本");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "社区资料刷新失败");
    }
  }

  async function clearCommunityKnowledge() {
    if (!activeProjectId) return;
    const response = await fetch(
      `${runtimeUrl}/api/projects/${activeProjectId}/community-cache`,
      { method: "DELETE" },
    );
    const payload = await response.json();
    if (!response.ok) {
      showNotice(payload.error || "本地社区资料清除失败");
      return;
    }
    setCommunityCache({
      state: "missing",
      fetchedAt: null,
      searchReady: false,
      error: null,
    });
    showNotice("当前项目的本地社区资料已清除");
  }

  async function startInvestigation() {
    if (projectStatus.candidateCount === 0) {
      showNotice("还没有候选导师，请先完成导师搜索");
      return;
    }
    if (selected.size === 0) {
      showNotice("请先选择需要调查的导师与项目");
      return;
    }
    if (selectedSections.size === 0) {
      showNotice("请至少选择一个背调维度");
      return;
    }
    setInvestigationConfirmOpen(true);
  }

  async function confirmAndStartInvestigation() {
    if (!activeProjectId) return;
    setInvestigationSaving(true);
    try {
      const savedProject = await saveInvestigationConfiguration({}, false);
      const response = await fetch(
        `${runtimeUrl}/api/projects/${activeProjectId}/investigation/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftRevision: savedProject.investigation.draft.revision,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "最终确认失败");
      const confirmedProject = payload.project as AdvisorProject;
      const confirmed = confirmedProject.investigation.confirmed;
      if (!confirmed) throw new Error("最终确认快照没有生成");
      setProjects((current) =>
        current.map((project) =>
          project.id === activeProjectId ? confirmedProject : project,
        ),
      );
      if (
        confirmed.communitySources.consented &&
        !communityCache.searchReady
      ) {
        await refreshCommunityKnowledge(confirmedProject);
      }
      setInvestigationConfirmOpen(false);
      openRunner(`请完整读取 skills/advisor-detective/SKILL.md，准备开始 Phase 2 按选择维度背调。

只允许从本地已有的 ADVISOR_STATE.md 或最新 Phase 1 输出中读取真实导师名单。
如果没有真实的 Phase 1 状态文件，请明确说明并停止；绝对不要使用界面中的演示导师姓名。
精确 advisor-program IDs：${JSON.stringify(confirmed.selectedAdvisorProgramIds)}
精确 selected_sections：${JSON.stringify(confirmed.selectedSections)}
确认版本：${confirmed.revision}；配置指纹：${confirmed.fingerprint}
社区资料本地下载授权：${confirmed.communitySources.consented ? "已授权" : "未授权"}。
不得改用 Top N 或只按人数猜测对象；未选择的维度写“用户未选择复核”。
完成后将结构化结果写入 outputs/detective-results.json，并生成 outputs/advisor_detective_YYYYMMDD.xlsx。`, "detective");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "背调最终确认失败");
    } finally {
      setInvestigationSaving(false);
    }
  }

  function startRanking() {
    if (detectiveEvidenceCount === 0) {
      showNotice("请先完成候选导师背调");
      return;
    }
    openRunner(`请完整读取 skills/advisor-evaluator/SKILL.md，使用当前项目已有的真实候选导师和背调证据生成最终排名。

必须保留评分依据、权重、风险提示和证据来源。缺少必要证据时明确指出，不得用推测补齐。
将结构化排名写入 outputs/ranking.json，并按 Skill 的确定性脚本生成 outputs/advisor_application_ready_YYYYMMDD.xlsx。`, "ranking");
  }

  async function connectCustomApi() {
    setCustomState("checking");
    setCustomMessage("正在读取模型列表并验证连接…");
    try {
      const response = await fetch(`${runtimeUrl}/api/custom-provider/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(customForm),
      });
      const payload = await response.json();
      if (Array.isArray(payload.models)) setCustomModels(payload.models);
      if (!response.ok) {
        if (payload.requiresModel) {
          setCustomState("idle");
          setCustomMessage(payload.message);
          return;
        }
        throw new Error(payload.error || payload.message || "连接验证失败");
      }
      setCustomState("ready");
      setCustomMessage(payload.message || "自定义 API 已连接");
      const healthResponse = await fetch(`${runtimeUrl}/api/health`, {
        cache: "no-store",
      });
      setRuntimeHealth(await healthResponse.json());
    } catch (error) {
      setCustomState("failed");
      setCustomMessage(error instanceof Error ? error.message : "连接验证失败");
    }
  }

  async function disconnectCustomApi() {
    await fetch(`${runtimeUrl}/api/custom-provider`, { method: "DELETE" });
    setCustomState("idle");
    setCustomMessage("自定义 API 已断开，Key 已从后端内存清除");
    setCustomModels([]);
    setCustomForm((current) => ({ ...current, apiKey: "", model: "" }));
    const healthResponse = await fetch(`${runtimeUrl}/api/health`, {
      cache: "no-store",
    });
    const nextHealth = await healthResponse.json();
    setRuntimeHealth(nextHealth);
    if (nextHealth.providers.codex.installed && nextHealth.providers.codex.loggedIn) {
      setProvider("Codex");
    } else if (
      nextHealth.providers.claude.installed &&
      nextHealth.providers.claude.loggedIn
    ) {
      setProvider("Claude Code");
    }
  }

  async function createProject() {
    try {
      const response = await fetch(`${runtimeUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(projectDraft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "项目创建失败");
      await refreshProjects(payload.project.id);
      setProjectModalOpen(false);
      setProjectDraft({ name: "" });
      setFileName("尚未上传真实 CV");
      setFilePath("");
      setUploadState("idle");
      setSelected(new Set());
      setView("overview");
      showNotice("申请项目已创建，请继续填写申请资料");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "项目创建失败");
    }
  }

  const availableProviders = runtimeHealth
    ? [
        runtimeHealth.providers.codex,
        runtimeHealth.providers.claude,
        runtimeHealth.providers.custom,
      ].filter((item) => item.installed && item.loggedIn).length
    : null;
  const currentProviderHealth = selectedProviderHealth();
  const savedLabel = intakeSaving
    ? "正在保存"
    : intakeDirty
      ? "有未保存修改"
      : activeProject?.updatedAt
        ? `已保存 ${new Date(activeProject.updatedAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : "尚未保存";

  function openProjectView(nextView: View) {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Advisor Atlas</strong>
            <span>导师匹配控制台</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="主导航">
          <p className="nav-label">工作台</p>
          <button
            className={view === "overview" ? "active" : ""}
            onClick={() => openProjectView("overview")}
          >
            <span className="nav-icon">⌂</span> 总览
          </button>
          <button
            className={view === "candidates" ? "active" : ""}
            onClick={() => openProjectView("candidates")}
          >
            <span className="nav-icon">◎</span> 候选导师
            <em>{candidates.length}</em>
          </button>
          <button
            className={view === "evidence" ? "active" : ""}
            onClick={() => openProjectView("evidence")}
          >
            <span className="nav-icon">◫</span> 背调证据
            <em>{detectiveEvidenceCount}</em>
          </button>
          <button
            className={view === "ranking" ? "active" : ""}
            onClick={() => openProjectView("ranking")}
          >
            <span className="nav-icon">◇</span> 最终排名
          </button>

          <p className="nav-label second">申请项目</p>
          {projectsLoading && <span className="project-loading">正在加载项目…</span>}
          {projects.map((item) => (
            <button
              key={item.id}
              className={`project-link ${item.id === activeProjectId ? "" : "subdued"}`}
              onClick={() => {
                setActiveProjectId(item.id);
                setFileName("尚未上传真实 CV");
                setFilePath("");
                setUploadState("idle");
                setSelected(new Set());
                setView("overview");
              }}
            >
              <span className={`project-dot ${item.id === activeProjectId ? "violet" : "mint"}`} />
              {item.name}
            </button>
          ))}
          <button className="project-link subdued" onClick={() => setProjectModalOpen(true)}>
            <span className="project-dot mint" />
            新建申请项目
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="local-badge">
            <span className="pulse-dot" />
            本地项目 · 文件本地保存
          </div>
          <div className="profile">
            <div className="avatar">本</div>
            <div>
              <strong>本地工作区</strong>
              <span>申请项目独立保存</span>
            </div>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>申请项目</span>
            <b>/</b>
            <strong>{projectsLoading ? "正在加载…" : activeProject?.name || "未选择项目"}</strong>
          </div>
          <div className="top-actions">
            <button
              className="agent-button"
              onClick={() => {
                if (rankingComplete) openProjectView("ranking");
                else if (detectiveComplete) openProjectView("ranking");
                else if (projectStatus.candidateCount > 0) openProjectView("evidence");
                else if (projectReadiness.phase1Ready) startPhaseOne();
                else focusApplicationInput();
              }}
            >
              <span className={runtimeHealth ? "runtime-online" : "runtime-offline"} />
              {rankingComplete
                ? "查看最终结果"
                : detectiveComplete
                  ? "进入综合排名"
                  : projectStatus.candidateCount > 0
                    ? "配置导师背调"
                    : projectReadiness.phase1Ready
                      ? "开始寻找导师"
                      : `Phase 1 ${projectReadiness.completed}/${projectReadiness.total}`}
            </button>
            <button
              className="help-button"
              aria-label="使用帮助"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
          </div>
        </header>

        <div className="content">
          <section className="hero" hidden={view !== "overview"}>
            <div>
              <span className="eyebrow">ADVISOR MATCHING WORKSPACE</span>
              <h1>
                {rankingComplete
                  ? "三阶段已完成，结果已经整理。"
                  : detectiveComplete
                    ? "背调已完成，进入综合决策。"
                    : projectStatus.candidateCount > 0
                      ? "离理想导师，更近一步。"
                      : "从申请目标开始，逐层筛选。"}
              </h1>
              <p>
                {rankingComplete
                  ? "网页展示前三名；完整排名与申请准备信息已按流程写入项目 outputs 文件夹。"
                  : detectiveComplete
                    ? "P2 结果已保留，不需要再次背调；下一步生成综合排名和申请就绪 Excel。"
                    : projectStatus.candidateCount > 0
                      ? "候选导师发现已完成。选择重点对象，开始证据可追溯的深度背调。"
                      : projectReadiness.phase1Ready
                        ? "Phase 1 资料已齐全。选择执行引擎后，即可开始低成本的导师发现与匹配。"
                        : "模型引擎可以随时选择；启动 Phase 1 只需要目标范围，以及 CV 或研究兴趣。"}
              </p>
            </div>
            <div className="hero-side">
              <span>当前引擎</span>
              <button
                className="provider-pill"
                onClick={() =>
                  projectStatus.candidateCount === 0 && projectReadiness.phase1Ready
                    ? startPhaseOne()
                    : openRunner()
                }
              >
                <i
                  className={
                    currentProviderHealth?.loggedIn ? "provider-connected" : "provider-disconnected"
                  }
                />
                {currentProviderHealth?.loggedIn ? provider : "选择模型"}
                <b>⌄</b>
              </button>
              <small>命令、文件或网络权限会在运行面板确认</small>
            </div>
          </section>

          <section className="stats-grid" hidden={view !== "overview"}>
            <article className="stat-card primary-stat">
              <div className="stat-top">
                <span>Phase 1 发现池</span>
                <i>本轮</i>
              </div>
              <div className="stat-value">
                {projectStatus.candidateCount} <small>位</small>
              </div>
              <div className="stat-foot">
                <span>
                  {projectStatus.candidateCount > 0 ? "低成本初筛名册" : "尚未开始导师搜索"}
                </span>
                {projectStatus.candidateCount > 0 && <Sparkline />}
              </div>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <span>高匹配候选</span>
                <i className="green-chip">≥ 8.0</i>
              </div>
              <div className="stat-value">
                {projectStatus.shortlistCount} <small>位</small>
              </div>
              <div className="stat-foot">
                <span className="positive-text">
                  {projectStatus.shortlistCount > 0 ? "已进入客观条件筛选" : "等待真实评分"}
                </span>
              </div>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <span>证据覆盖</span>
                <i className="amber-chip">持续更新</i>
              </div>
              <div className="stat-value">
                {projectStatus.evidenceCoverage}
                <small>%</small>
              </div>
              <div className="progress-track">
                <span style={{ width: `${projectStatus.evidenceCoverage}%` }} />
              </div>
              <div className="stat-foot">
                <span>论文、主页与社交动态</span>
              </div>
            </article>
            <article className="stat-card connection-card">
              <div className="stat-top">
                <span>模型连接</span>
                <i className={availableProviders ? "green-chip" : "amber-chip"}>
                  {runtimeLoading
                    ? "正在检测…"
                    : runtimeError || `${availableProviders ?? 0} 可用`}
                </i>
              </div>
              <div className="provider-row">
                {(["Codex", "Claude Code", "Custom API"] as Provider[]).map(
                  (item) => (
                    <button
                      key={item}
                      className={provider === item ? "selected" : ""}
                      onClick={() => {
                        const health = runtimeHealth?.providers[providerKey[item]];
                        setProvider(item);
                        if (!health?.installed || !health.loggedIn || item === "Custom API") {
                          openRunner();
                        }
                      }}
                    >
                      <span
                        className={
                          runtimeHealth?.providers[providerKey[item]]?.loggedIn
                            ? ""
                            : "provider-offline"
                        }
                      />
                      {item}
                      <small>
                        {runtimeHealth?.providers[providerKey[item]]?.loggedIn
                          ? "已连接"
                          : item === "Custom API"
                            ? "待配置"
                            : "未登录"}
                      </small>
                    </button>
                  ),
                )}
              </div>
            </article>
          </section>

          <section className="main-grid" hidden={view !== "overview"}>
            <article className="panel journey-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">WORKFLOW</span>
                  <h2>导师匹配进度</h2>
                </div>
                <span className={`saved-label ${intakeDirty ? "dirty" : ""}`}>
                  {savedLabel}
                </span>
              </div>
              <div className="journey">
                {steps.map((step) => (
                  <div className={`journey-step ${step.state}`} key={step.number}>
                    <div className="step-marker">
                      {step.state === "done" ? "✓" : step.number}
                    </div>
                    <div className="step-copy">
                      <div>
                        <strong>{step.title}</strong>
                        {step.state === "current" && <span>当前阶段</span>}
                      </div>
                      <p>{step.detail}</p>
                      <small>{step.meta}</small>
                    </div>
                    <button
                      aria-label={`查看${step.title}`}
                      onClick={() => {
                        if (step.number === "01" && !projectReadiness.phase1Ready) {
                          focusApplicationInput();
                        } else if (step.number === "01") {
                          openProjectView("candidates");
                        } else if (step.number === "02") {
                          openProjectView("evidence");
                        } else {
                          openProjectView("ranking");
                        }
                      }}
                    >
                      ›
                    </button>
                  </div>
                ))}
              </div>
            </article>

            <aside
              className={`panel intake-panel ${projectReadiness.phase1Ready ? "intake-ready" : ""}`}
              ref={intakeRef}
            >
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">STEP 1 · PROJECT INPUT</span>
                  <h2>先填写你的申请资料</h2>
                </div>
                <span className="intake-count">
                  {draftCompleted}/{projectReadiness.total}
                </span>
              </div>
              <p className="intake-guide">
                Phase 1 只需目标范围，以及 CV 或研究兴趣二选一。学位与申请季可以稍后补充，但进入客观条件筛选前必须填写。
              </p>
              <div className="intake-progress" aria-label="申请资料完成进度">
                <span
                  style={{
                    width: `${(draftCompleted / projectReadiness.total) * 100}%`,
                  }}
                />
              </div>
              <label className="file-card">
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.md,.txt"
                  onChange={(event) => uploadCv(event.target.files?.[0])}
                />
                <span className="file-icon">CV</span>
                <span>
                  <strong>
                    1. 上传真实 CV <em>与研究兴趣二选一</em>
                  </strong>
                  <small>
                    {uploadState === "uploading"
                      ? "正在保存到本地…"
                      : uploadState === "ready"
                        ? `${fileName} · 已保存`
                        : uploadState === "failed"
                          ? "保存失败，请重试"
                          : "例如：Your_Name_CV.pdf · 支持 PDF / DOCX / MD"}
                  </small>
                </span>
                <b>{uploadState === "ready" ? "更换" : "选择文件"}</b>
              </label>
              <div className="application-form">
                <div className="application-row">
                  <label>
                    <span>2. 目标学位 <em>客观筛选前补齐</em></span>
                    <select
                      value={applicationDraft.degree}
                      onChange={(event) =>
                        updateApplicationField("degree", event.target.value)
                      }
                    >
                      <option value="">请选择</option>
                      <option value="PhD">PhD</option>
                      <option value="MPhil">MPhil</option>
                      <option value="MS">MS</option>
                      <option value="Postdoc">Postdoc</option>
                      <option value="RA">RA</option>
                    </select>
                    <small>例如：PhD</small>
                  </label>
                  <label>
                    <span>3. 申请季 <em>客观筛选前补齐</em></span>
                    <input
                      value={applicationDraft.season}
                      onChange={(event) =>
                        updateApplicationField("season", event.target.value)
                      }
                      placeholder="例如：2027 Fall"
                    />
                    <small>写明年份和入学季</small>
                  </label>
                </div>
                <label>
                  <span>4. 目标院校或地区范围 <em>必填</em></span>
                  <textarea
                    value={applicationDraft.target}
                    onChange={(event) =>
                      updateApplicationField("target", event.target.value)
                    }
                    placeholder="例如：美国 Top 30，优先 HCI / AI；也考虑加拿大多伦多地区"
                    rows={2}
                  />
                  <small>越具体越好，可填写国家、学校层级、院系或明确学校名单</small>
                </label>
                <div className="interest-editor">
                  <div className="interest-editor-title">
                    <span>5. 研究兴趣与权重 <em>可选</em></span>
                    <small className={hasDraftInterests ? "valid" : ""}>
                      {!hasDraftInterests
                        ? "可留空"
                        : draftInterestTotal > 0
                          ? `当前 ${draftInterestTotal}%，保存后归一化`
                          : "未填权重将自动等权"}
                    </small>
                  </div>
                  {applicationDraft.interests.map((interest, index) => (
                    <div className="interest-input-row" key={index}>
                      <input
                        value={interest.name}
                        onChange={(event) => updateInterest(index, "name", event.target.value)}
                        placeholder={index === 0 ? "例如：Human-AI Interaction" : "例如：AI4Health"}
                        aria-label={`研究兴趣 ${index + 1}`}
                      />
                      <label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={interest.weight}
                          onChange={(event) => updateInterest(index, "weight", event.target.value)}
                          placeholder="可选"
                          aria-label={`研究兴趣 ${index + 1} 权重`}
                        />
                        <span>%</span>
                      </label>
                      <button
                        type="button"
                        aria-label={`删除研究兴趣 ${index + 1}`}
                        onClick={() =>
                          {
                            setIntakeDirty(true);
                            setApplicationDraft((current) => ({
                              ...current,
                              interests:
                                current.interests.length === 1
                                  ? [{ name: "", weight: "" }]
                                  : current.interests.filter((_, itemIndex) => itemIndex !== index),
                            }));
                          }
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="add-interest"
                    type="button"
                    disabled={applicationDraft.interests.length >= 5}
                    onClick={() =>
                      {
                        setIntakeDirty(true);
                        setApplicationDraft((current) => ({
                          ...current,
                          interests: [...current.interests, { name: "", weight: "" }],
                        }));
                      }
                    }
                  >
                    + 添加研究兴趣
                  </button>
                </div>
                <div className="shortlist-field">
                  <span>6. Phase 1 希望保留的导师数</span>
                  <div className="shortlist-control">
                    {[5, 10, 15, 20].map((count) => (
                      <button
                        type="button"
                        className={Number(applicationDraft.shortlistTarget) === count ? "active" : ""}
                        key={count}
                        onClick={() => {
                          setIntakeDirty(true);
                          setApplicationDraft((current) => ({
                            ...current,
                            shortlistTarget: String(count),
                          }));
                        }}
                      >
                        Top {count}
                      </button>
                    ))}
                    <label>
                      <span>自定义</span>
                      <input
                        type="number"
                        min="5"
                        max="50"
                        value={applicationDraft.shortlistTarget}
                        onChange={(event) => {
                          setIntakeDirty(true);
                          setApplicationDraft((current) => ({
                            ...current,
                            shortlistTarget: event.target.value,
                          }));
                        }}
                      />
                    </label>
                  </div>
                  <small>默认 Top 10；系统会先建立更大的发现池，再筛到这个数量。</small>
                </div>
                <button
                  className="save-intake"
                  type="button"
                  onClick={saveApplicationProfile}
                  disabled={intakeSaving}
                >
                  {intakeSaving
                    ? "正在保存…"
                    : projectReadiness.phase1Ready
                      ? "更新申请资料"
                      : "保存申请资料"}
                </button>
                <div className={`intake-status ${displayedPhaseOneReady ? "complete" : ""}`}>
                  <span>{displayedPhaseOneReady ? "✓" : "!"}</span>
                  <p>
                    <strong>
                      {displayedPhaseOneReady
                        ? intakeDirty
                          ? "输入已齐全，保存后即可开始发现导师"
                          : "Phase 1 已解锁，可以开始发现导师"
                        : "还需补齐 Phase 1 的最低输入"}
                    </strong>
                    <small>
                      {displayedPhaseOneReady
                        ? displayedObjectiveReady
                          ? "客观申请条件筛选所需信息也已齐全"
                          : `可以先进行发现与匹配；客观筛选前还需：${
                              intakeDirty
                                ? draftObjectiveMissing.join("、")
                                : projectReadiness.objectiveMissing.join("、")
                            }`
                        : `还需：${draftMissing.join("、")}`}
                    </small>
                  </p>
                </div>
              </div>
            </aside>
          </section>

          <section className="panel candidate-panel" hidden={view !== "candidates"}>
            <div className="candidate-header">
              <div>
                <span className="section-kicker">SHORTLIST</span>
                <h2>优先候选导师</h2>
                <p>先看研究匹配和客观申请可行性，再选择值得深度背调的导师</p>
              </div>
              <div className="candidate-actions">
                <label className="search-box">
                  <span>⌕</span>
                  <input
                    aria-label="搜索候选导师"
                    placeholder="搜索姓名、院校或方向"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button
                  className={`filter-button ${highFitOnly ? "active" : ""}`}
                  disabled={!candidates.length}
                  onClick={() => setHighFitOnly((current) => !current)}
                >
                  {highFitOnly ? "显示全部" : "仅看高匹配"}
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="check-cell" />
                    <th>导师</th>
                    <th>项目</th>
                    <th>研究方向</th>
                    <th>招生状态</th>
                    <th>客观可行性</th>
                    <th>证据</th>
                    <th>匹配分</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-candidates">
                          <span>00</span>
                          <strong>还没有真实候选导师</strong>
                          <p>
                            {projectReadiness.phase1Ready
                              ? "Phase 1 资料已经齐全，现在可以开始寻找导师。"
                              : "请填写目标范围，并上传 CV 或填写至少一个研究兴趣。"}
                          </p>
                          <button onClick={startPhaseOne}>
                            {projectReadiness.phase1Ready ? "开始寻找导师" : "先补齐 Phase 1 输入"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((candidate) => (
                      <tr key={candidate.advisorProgramId}>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${candidate.name}`}
                          checked={selected.has(candidate.advisorProgramId)}
                          onChange={() => toggleCandidate(candidate.advisorProgramId)}
                        />
                      </td>
                      <td>
                        <span className="program-name">
                          {candidate.program || "项目待核实"}
                        </span>
                      </td>
                      <td>
                        <div className="advisor-cell">
                          <span className="advisor-avatar">{candidate.initials}</span>
                          <span>
                            <strong>{candidate.name}</strong>
                            <small>{candidate.school}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="direction-tags">
                          {candidate.directions.map((direction) => (
                            <span key={direction}>{direction}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${candidate.statusTone}`}>
                          {candidate.status}
                        </span>
                      </td>
                      <td>
                        <span className={`feasibility-badge ${candidate.feasibility}`}>
                          {candidate.feasibility === "eligible"
                            ? "符合"
                            : candidate.feasibility === "ineligible"
                              ? "不符合"
                              : "待确认"}
                        </span>
                        {candidate.feasibilityReasons.length > 0 && (
                          <small className="feasibility-reason">
                            {candidate.feasibilityReasons.join("；")}
                          </small>
                        )}
                      </td>
                      <td>
                        <span className="evidence-count">{candidate.evidence} 条</span>
                      </td>
                      <td>
                        <div className="fit-score">
                          <strong>{candidate.fit}</strong>
                          <span>
                            <i style={{ width: `${candidate.fit * 10}%` }} />
                          </span>
                        </div>
                      </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span>
                已选择 <strong>{selected.size}</strong> 位导师
              </span>
              <div>
                <button
                  className="secondary-button"
                  disabled={!candidates.length}
                  onClick={exportCandidates}
                >
                  导出候选名单
                </button>
                <button
                  className="primary-button"
                  disabled={selected.size === 0}
                  onClick={() => openProjectView("evidence")}
                >
                  {detectiveComplete ? "查看已完成背调" : "配置深度背调"} <span>→</span>
                </button>
              </div>
            </div>
          </section>

          <section className="result-view" hidden={view !== "evidence"}>
            <header className="view-header">
              <div>
                <span className="section-kicker">BACKGROUND CHECK</span>
                <h1>背调证据</h1>
                <p>集中查看论文、实验室主页、近期项目和公开动态等可追溯证据。</p>
              </div>
              <div className="view-header-actions">
                {detectiveComplete && <span className="phase-complete-chip">✓ P2 已完成</span>}
                <button
                  className={detectiveComplete ? "secondary-button" : "primary-button"}
                  disabled={!selected.size || !selectedSections.size || investigationSaving}
                  onClick={
                    detectiveComplete && !evidenceConfigOpen
                      ? () => setEvidenceConfigOpen(true)
                      : startInvestigation
                  }
                >
                  {investigationSaving
                    ? "正在保存配置…"
                    : detectiveComplete
                      ? evidenceConfigOpen
                        ? "按新配置重新背调"
                        : "补充或重新背调"
                      : "开始背调"}
                </button>
              </div>
            </header>
            {detectiveComplete && (
              <article className="panel phase-summary complete">
                <span className="phase-summary-icon">✓</span>
                <div>
                  <strong>这轮背调已经完成</strong>
                  <p>
                    已调查 {detectiveResults?.results.length || 0} 位导师、
                    {detectiveResults?.selectedSections.length || 0} 个维度，共保留{" "}
                    {detectiveResults?.evidenceCount || 0} 条证据。下面是本轮结果，不需要再次运行。
                  </p>
                  <code>完整结果目录：{activeProject?.path}/outputs</code>
                </div>
                <button
                  className="text-button"
                  onClick={() => setEvidenceConfigOpen((current) => !current)}
                >
                  {evidenceConfigOpen ? "收起配置" : "修改调查范围"}
                </button>
              </article>
            )}
            {(!detectiveComplete || evidenceConfigOpen) && (
            <>
            <div className="evidence-layout configuration-panel">
              <article className="panel investigation-config">
                <div className="config-heading">
                  <div>
                    <span className="section-kicker">SELECTED SECTIONS</span>
                    <h2>选择需要调查的信息</h2>
                  </div>
                  <span>{selected.size} 位导师</span>
                </div>
                <p>
                  {detectiveComplete
                    ? "修改配置不会改变上面的已完成结果；只有重新运行后，结果才会更新。"
                    : "前三项是默认背调起点，可取消但会提示完整性风险；其余维度按需选择。勾选越多，搜索范围和 Token 消耗越高。"}
                </p>
                <div className="detective-options">
                  {detectiveSectionOptions.map((option) => (
                    <label
                      className={option.defaultSelected ? "default-section" : ""}
                      key={option.id}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSections.has(option.id)}
                        onChange={() => toggleDetectiveSection(option.id)}
                      />
                      <span>{option.label}</span>
                      {option.defaultSelected && <b>默认</b>}
                    </label>
                  ))}
                </div>
                <div className="token-hint">
                  预计消耗：
                  <strong>
                    {selected.size * selectedSections.size > 24
                      ? "较高"
                      : selected.size * selectedSections.size > 8
                        ? "中等"
                        : "较低"}
                  </strong>
                  <span>（按导师数 × 调查维度估算）</span>
                </div>
              </article>

              {(communityRelevant || communityCache.state !== "missing") && (
              <article className="panel community-config">
                <div className="config-heading">
                  <div>
                    <span className="section-kicker">LOCAL COMMUNITY CACHE</span>
                    <h2>导师社区资料</h2>
                  </div>
                  <span className={`cache-state ${communityCache.state}`}>
                    {communityCache.state === "ready"
                      ? "可搜索"
                      : communityCache.state === "refreshing"
                        ? "刷新中"
                        : communityCache.state === "unsearchable"
                          ? "不可搜索"
                          : "未下载"}
                  </span>
                </div>
                <p>
                  {communityRelevant
                    ? "仅在当前申请项目本地保存第三方红黑榜快照，不进入 Git。匿名内容只作为线索，还会继续核查其他社区和正式来源。"
                    : "当前选择不包含社区相关维度；不能新增或刷新社区资料，但仍可清除以前的本地缓存。"}
                </p>
                {communityRelevant && (
                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={communityConsent}
                    onChange={(event) => {
                      const consented = event.target.checked;
                      setCommunityConsent(consented);
                      setInvestigationConfirmOpen(false);
                      void saveInvestigationConfiguration(
                        { communityConsent: consented },
                        false,
                      ).catch(() => showNotice("社区资料授权状态暂时未能保存"));
                    }}
                  />
                  <span>我希望在最终确认时，授权本次调查在本地下载并解析这些第三方资料</span>
                </label>
                )}
                {communityCache.error && (
                  <div className="cache-error">{communityCache.error}</div>
                )}
                <div className="cache-actions">
                  <button
                    className="secondary-button"
                    disabled={
                      !confirmedMatchesCurrentDraft ||
                      !confirmedInvestigation?.communitySources.consented ||
                      communityCache.state === "refreshing"
                    }
                    onClick={() => void refreshCommunityKnowledge()}
                  >
                    刷新本地资料
                  </button>
                  <button
                    className="secondary-button"
                    disabled={communityCache.state === "missing"}
                    onClick={clearCommunityKnowledge}
                  >
                    清除本地资料
                  </button>
                </div>
              </article>
              )}
            </div>
            {investigationConfirmOpen && (
              <article className="panel phase-summary investigation-confirmation">
                <span className="phase-summary-icon">!</span>
                <div>
                  <strong>请最终确认本次背调范围</strong>
                  <p>
                    将调查 {selected.size} 个导师—项目组合、
                    {selectedSections.size} 个维度，共 {selected.size * selectedSections.size} 个工作单元。
                  </p>
                  <p>
                    导师—项目：
                    {candidates
                      .filter((candidate) => selected.has(candidate.advisorProgramId))
                      .map((candidate) => `${candidate.name}｜${candidate.program}`)
                      .join("；")}
                  </p>
                  <p>调查维度：{selectedSectionLabels.join("、")}</p>
                  <p>
                    社区资料：
                    {communityRelevant
                      ? communityConsent
                        ? "确认后授权本次本地下载与解析"
                        : "不授权，仍使用其他公开来源"
                      : "本次不涉及"}
                  </p>
                </div>
                <div className="cache-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setInvestigationConfirmOpen(false)}
                  >
                    返回修改
                  </button>
                  <button
                    className="primary-button"
                    disabled={investigationSaving}
                    onClick={confirmAndStartInvestigation}
                  >
                    {investigationSaving ? "正在确认…" : "确认并准备开始背调"}
                  </button>
                </div>
              </article>
            )}
            </>
            )}
            {!detectiveComplete && (
            <article className="panel honest-empty compact-empty">
              <span>{detectiveEvidenceCount || "00"}</span>
              <h2>
                {projectStatus.candidateCount === 0
                  ? "先获得候选导师"
                  : selected.size === 0
                    ? "先选择需要调查的导师"
                    : selectedSections.size === 0
                      ? "请选择至少一个背调维度"
                      : "配置完成，等待开始背调"}
              </h2>
              <p>
                {selected.size > 0 && selectedSections.size > 0
                  ? `将对 ${selected.size} 个导师—项目组合调查 ${selectedSections.size} 个维度。`
                  : "前往候选导师页面选择对象，再配置需要调查的信息。"}
              </p>
              <button
                onClick={() =>
                  projectStatus.candidateCount === 0
                    ? startPhaseOne()
                    : openProjectView("candidates")
                }
              >
                {projectStatus.candidateCount === 0 ? "开始寻找导师" : "前往选择导师"}
              </button>
            </article>
            )}
            {detectiveResults?.results.map((result) => (
              <article className="panel evidence-result-card" key={result.advisorProgramId}>
                <div className="result-card-heading">
                  <div>
                    <span className="section-kicker">背调结果 · 已完成</span>
                    <h2>{result.name}</h2>
                  </div>
                  <span>{result.evidenceCount} 条证据</span>
                </div>
                <div className="evidence-result-sections">
                  {detectiveResults.selectedSections.map((sectionId) => {
                    const option = detectiveSectionOptions.find(
                      (item) => item.id === sectionId,
                    );
                    const section = result.sections?.[sectionId];
                    const summary =
                      typeof section === "string"
                        ? section
                        : section?.summary || "本轮没有生成可展示的结论";
                    const sources =
                      typeof section === "object" && Array.isArray(section?.sourceIds)
                        ? section.sourceIds
                        : [];
                    return (
                      <section key={sectionId}>
                        <div className="result-section-title">
                          <strong>{option?.label || sectionId}</strong>
                          {typeof section === "object" && section?.status === "verified" && (
                            <span>已核实</span>
                          )}
                        </div>
                        <p>{summary}</p>
                        {sources.length > 0 && (
                          <details>
                            <summary>查看 {sources.length} 条证据索引</summary>
                            <small>{sources.join("、")}</small>
                          </details>
                        )}
                      </section>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>

          <section className="result-view" hidden={view !== "ranking"}>
            <header className="view-header">
              <div>
                <span className="section-kicker">FINAL DECISION</span>
                <h1>最终排名</h1>
                <p>页面只展示前三名；完整排名、证据和申请条件保存在项目 Excel 中。</p>
              </div>
              <div className="view-header-actions">
                {rankingComplete && <span className="phase-complete-chip">✓ P3 已完成</span>}
                <button
                  className={rankingComplete ? "secondary-button" : "primary-button"}
                  disabled={detectiveEvidenceCount === 0}
                  onClick={startRanking}
                >
                  {rankingComplete ? "重新生成排名与 Excel" : "生成最终排名与 Excel"}
                </button>
              </div>
            </header>
            {rankingComplete ? (
              <>
                <article className="panel phase-summary complete ranking-summary">
                  <span className="phase-summary-icon">✓</span>
                  <div>
                    <strong>综合评分已经完成</strong>
                    <p>
                      下面展示前 {Math.min(3, rankings.length)} 名。完整 {rankings.length} 位排名、
                      评分明细、证据和申请准备信息由正式任务自动生成到项目输出文件夹。
                    </p>
                    <code>{activeProject?.path}/outputs</code>
                  </div>
                </article>
                <div className="ranking-results">
                {topRankings.map((item) => {
                  const visibleGaps = item.evidenceGaps
                    .filter((gap) => !/冒烟测试|\.json|consented=/.test(gap))
                    .slice(0, 3);
                  return (
                  <article className="panel ranking-result-card" key={item.advisorProgramId}>
                    <div className="ranking-position">#{item.rank}</div>
                    <div className="ranking-result-main">
                      <div className="result-card-heading">
                        <div>
                          <h2>{item.name}</h2>
                          <p>{[item.school, item.program].filter(Boolean).join(" · ")}</p>
                        </div>
                        <strong>{item.totalScore.toFixed(1)}</strong>
                      </div>
                      {item.rationale && <p className="ranking-rationale">{item.rationale}</p>}
                      {visibleGaps.length > 0 && (
                        <div className="ranking-gaps">
                          <strong>优先确认</strong>
                          <ul>
                            {visibleGaps.map((gap) => (
                              <li key={gap}>{gap}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </article>
                  );
                })}
                </div>
                <p className="ranking-footnote">
                  页面仅展示前三名和最关键的待确认项，其余候选与完整字段请查看 Excel。
                </p>
              </>
            ) : (
              <article className="panel honest-empty">
                <span>{projectStatus.rankingCount || "00"}</span>
                <h2>
                  {detectiveEvidenceCount === 0
                    ? "还没有足够的背调证据"
                    : "等待生成最终排名"}
                </h2>
                <p>
                  {detectiveEvidenceCount === 0
                    ? "先完成候选导师背调，系统才能给出有依据的综合判断。"
                    : "证据准备完成后，可以进入综合评分与决策阶段。"}
                </p>
                <button
                  onClick={() =>
                    openProjectView(
                      projectStatus.candidateCount === 0 ? "candidates" : "evidence",
                    )
                  }
                >
                  {projectStatus.candidateCount === 0 ? "前往候选导师" : "查看背调证据"}
                </button>
              </article>
            )}
          </section>
        </div>
      </section>

      {runnerOpen && (
        <div
          className="runner-layer"
          role="dialog"
          aria-modal="true"
          aria-label={runnerContent.title}
        >
          <button
            className="runner-backdrop"
            aria-label={`关闭${runnerContent.title}面板`}
            onClick={closeRunner}
          />
          <aside className="runner-drawer">
            <header className="runner-header">
              <div>
                <span className="section-kicker">{runnerContent.kicker}</span>
                <h2>{runnerContent.title}</h2>
                <p>{runnerContent.description}</p>
              </div>
              <button className="runner-close" onClick={closeRunner} aria-label="关闭">
                ×
              </button>
            </header>

            <section className="runner-section">
              <div className="runner-section-title">
                <strong>选择模型</strong>
                <button
                  onClick={async () => {
                    try {
                      const response = await fetch(`${runtimeUrl}/api/health`, {
                        cache: "no-store",
                      });
                      setRuntimeHealth(await response.json());
                      setRuntimeError("");
                    } catch {
                      setRuntimeError("本地运行服务未启动");
                    }
                  }}
                >
                  刷新状态
                </button>
              </div>
              <div className="runner-providers">
                {(["Codex", "Claude Code", "Custom API"] as Provider[]).map((item) => {
                  const health = runtimeHealth?.providers[providerKey[item]];
                  const usable = Boolean(health?.installed && health.loggedIn);
                  return (
                    <button
                      key={item}
                      className={provider === item ? "active" : ""}
                      onClick={() => chooseProvider(item)}
                    >
                      <span className={usable ? "engine-live" : "engine-idle"}>
                        {item === "Codex" ? "CX" : item === "Claude Code" ? "CL" : "API"}
                      </span>
                      <span>
                        <strong>{item}</strong>
                        <small>
                          {item === "Codex"
                            ? "使用你的 Codex 订阅（推荐）"
                            : item === "Claude Code"
                              ? "使用你的 Claude 订阅"
                              : "连接自己的 API（高级）"}
                        </small>
                      </span>
                      <i className={usable ? "connected" : ""}>
                        {runtimeLoading ? "检测中" : usable ? "可用" : "未连接"}
                      </i>
                    </button>
                  );
                })}
              </div>
              {currentProviderHealth &&
                !currentProviderHealth.loggedIn &&
                provider !== "Custom API" && (
                <div className="auth-hint">
                  <strong>{provider} 尚未登录</strong>
                  <span>
                    {provider === "Codex"
                      ? "请先在本机登录 Codex，然后点击刷新状态。"
                      : "请先在本机登录 Claude Code，然后点击刷新状态。"}
                  </span>
                </div>
              )}
              {provider === "Custom API" && (
                <div className="custom-api-form">
                  <div className="advanced-intro">
                    <strong>高级设置</strong>
                    <span>适合已经拥有 API 地址、Key 和模型名称的用户。</span>
                  </div>
                  <div className="custom-grid">
                    <label>
                      <span>显示名称</span>
                      <input
                        value={customForm.name}
                        onChange={(event) =>
                          setCustomForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="例如 Kimi / DMX / OpenRouter"
                      />
                    </label>
                    <label>
                      <span>API Base URL</span>
                      <input
                        value={customForm.baseUrl}
                        onChange={(event) =>
                          setCustomForm((current) => ({
                            ...current,
                            baseUrl: event.target.value,
                          }))
                        }
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label>
                      <span>API Key</span>
                      <input
                        type="password"
                        value={customForm.apiKey}
                        onChange={(event) =>
                          setCustomForm((current) => ({
                            ...current,
                            apiKey: event.target.value,
                          }))
                        }
                        placeholder="仅保存在本次后端进程内"
                      />
                    </label>
                    <label>
                      <span>精确模型 ID</span>
                      {customModels.length ? (
                        <select
                          value={customForm.model}
                          onChange={(event) =>
                            setCustomForm((current) => ({
                              ...current,
                              model: event.target.value,
                            }))
                          }
                        >
                          <option value="">请选择接口返回的模型</option>
                          {customModels.map((model) => (
                            <option value={model} key={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={customForm.model}
                          onChange={(event) =>
                            setCustomForm((current) => ({
                              ...current,
                              model: event.target.value,
                            }))
                          }
                          placeholder="先读取模型列表"
                        />
                      )}
                    </label>
                  </div>
                  <div className="custom-api-actions">
                    <p className={customState}>
                      {customMessage ||
                        "连接时会读取接口提供的模型列表，并验证你选择的精确模型名称。"}
                    </p>
                    <div>
                      {runtimeHealth?.providers.custom.loggedIn && (
                        <button className="disconnect-api" onClick={disconnectCustomApi}>
                          断开
                        </button>
                      )}
                      <button
                        onClick={connectCustomApi}
                        disabled={
                          customState === "checking" ||
                          !customForm.baseUrl ||
                          !customForm.apiKey
                        }
                      >
                        {customState === "checking"
                          ? "正在验证…"
                          : customModels.length && !customForm.model
                            ? "确认模型"
                            : "读取模型并连接"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="runner-section prompt-section">
              <div className="runner-section-title">
                <strong>本次会做什么</strong>
                {runnerMode === "finder" && filePath && (
                  <span className="attached-file">CV 已准备</span>
                )}
              </div>
              <ul className="run-summary-list">
                {runnerContent.summary.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button
                className="advanced-toggle"
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {advancedOpen ? "收起高级设置" : "查看高级设置"}
              </button>
              {advancedOpen && (
                <div className="advanced-task">
                  <label htmlFor="agent-task-prompt">任务指令</label>
                  <textarea
                    id="agent-task-prompt"
                    aria-label="高级任务指令"
                    value={taskPrompt}
                    onChange={(event) => setTaskPrompt(event.target.value)}
                    disabled={
                      runState === "running" ||
                      runState === "starting" ||
                      runState === "waiting_permission"
                    }
                  />
                  <small>项目目录：{activeProject?.path || projectsRoot}</small>
                </div>
              )}
              {!projectReadiness.phase1Ready && (
                <button
                  className="runner-input-blocker"
                  type="button"
                  onClick={() => {
                    setRunnerOpen(false);
                    window.setTimeout(focusApplicationInput, 100);
                  }}
                >
                  <strong>Phase 1 还缺 {projectReadiness.missing.length} 项最低输入</strong>
                  <span>{projectReadiness.missing.join("、")}</span>
                  <b>返回填写 →</b>
                </button>
              )}
              <p className="safety-note">
                资料保存在本地；运行时由你选择的模型服务处理。需要命令、文件或网络权限时，任务会暂停并在这里询问。
              </p>
            </section>

            {activePermission && (
              <section className="runner-section permission-section" aria-live="assertive">
                <div className="permission-card">
                  <div className="permission-heading">
                    <span className={`permission-icon ${activePermission.kind}`}>!</span>
                    <div>
                      <small>AGENT 正在等待你的授权</small>
                      <h3>{activePermission.title}</h3>
                    </div>
                  </div>
                  <div className="permission-meta">
                    <span>{activePermission.toolName}</span>
                    <span>
                      {activePermission.kind === "command"
                        ? "本地命令"
                        : activePermission.kind === "network"
                          ? "网络访问"
                          : activePermission.kind === "file"
                            ? "文件修改"
                            : "工具调用"}
                    </span>
                  </div>
                  {activePermission.description && (
                    <p>{activePermission.description}</p>
                  )}
                  {activePermissionDetail && (
                    <pre>{activePermissionDetail.slice(0, 1800)}</pre>
                  )}
                  {activePermission.cwd && (
                    <div className="permission-cwd">
                      <span>工作目录</span>
                      <code>{activePermission.cwd}</code>
                    </div>
                  )}
                  <div className="permission-actions">
                    <button
                      className="permission-deny"
                      disabled={resolvingPermissionId === activePermission.id}
                      onClick={() => resolvePermission(activePermission.id, "deny")}
                    >
                      拒绝
                    </button>
                    <button
                      disabled={resolvingPermissionId === activePermission.id}
                      onClick={() => resolvePermission(activePermission.id, "allow_once")}
                    >
                      允许一次
                    </button>
                    <button
                      className="permission-session"
                      disabled={resolvingPermissionId === activePermission.id}
                      onClick={() => resolvePermission(activePermission.id, "allow_for_run")}
                    >
                      本次运行允许
                    </button>
                  </div>
                  <small className="permission-note">
                    “本次运行允许”只复用同一命令入口或同一网络工具目标；其他操作仍会再次询问。
                  </small>
                </div>
                {pendingPermissions.length > 1 && (
                  <p className="permission-queue">
                    后面还有 {pendingPermissions.length - 1} 个授权请求等待处理
                  </p>
                )}
              </section>
            )}

            <section className="runner-section output-section">
              <div className="runner-section-title">
                <strong>任务进度</strong>
                <span className={`run-state ${runState}`}>
                  {runState === "idle"
                    ? "等待启动"
                    : runState === "starting"
                      ? "正在启动"
                      : runState === "running"
                        ? "运行中"
                        : runState === "waiting_permission"
                          ? "等待授权"
                          : runState === "completed"
                            ? "已完成"
                            : runState === "stopped"
                              ? "已停止"
                              : "运行失败"}
                </span>
              </div>
              {runStalled && (
                <div className="run-stalled-warning">
                  <strong>超过 90 秒没有收到新进度</strong>
                  <span>
                    模型可能正在重连或某个操作未返回。可以继续等待，也可以停止后缩小任务范围重试。
                  </span>
                </div>
              )}
              <div className={`agent-log ${runEvents.length ? "" : "empty"}`}>
                {runEvents.length === 0 ? (
                  <div>
                    <span>›_</span>
                    <strong>开始后，进度会实时显示在这里</strong>
                    <small>{runnerContent.completionHint}</small>
                  </div>
                ) : (
                  runEvents.map((event, index) => (
                    <div className={`log-line ${event.source}`} key={`${event.at}-${index}`}>
                      <span>{event.source === "runtime" ? "LOCAL" : event.source.toUpperCase()}</span>
                      <p>{event.message}</p>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
              {runOutputDirectory && advancedOpen && (
                <div className="output-path">
                  <span>输出目录</span>
                  <code>{runOutputDirectory}</code>
                </div>
              )}
            </section>

            <footer className="runner-footer">
              <span>{currentProviderHealth?.loggedIn ? `将使用 ${provider}` : "请选择可用模型"}</span>
              <div>
                {(["running", "starting", "waiting_permission"] as RunState[]).includes(
                  runState,
                ) && (
                  <button className="stop-button" onClick={stopAgent} disabled={!runId}>
                    停止任务
                  </button>
                )}
                <button
                  className="primary-button runner-start"
                  onClick={runAgent}
                  disabled={
                    runState === "running" ||
                    runState === "starting" ||
                    runState === "waiting_permission" ||
                    !currentProviderHealth?.installed ||
                    !currentProviderHealth.loggedIn ||
                    !activeProjectId ||
                    !projectReadiness.phase1Ready ||
                    !taskPrompt.trim()
                  }
                >
                  {runState === "waiting_permission"
                    ? "等待你的授权"
                    : runState === "running" || runState === "starting"
                      ? runnerContent.runningLabel
                    : runnerContent.startLabel}
                  <span>→</span>
                </button>
              </div>
            </footer>
          </aside>
        </div>
      )}

      {helpOpen && (
        <div className="project-modal-layer" role="dialog" aria-modal="true" aria-label="使用帮助">
          <button
            className="runner-backdrop"
            aria-label="关闭使用帮助"
            onClick={() => setHelpOpen(false)}
          />
          <section className="project-modal help-modal">
            <header>
              <div>
                <span className="section-kicker">GETTING STARTED</span>
                <h2>第一次使用，从这里开始</h2>
                <p>按 Phase 1 → Phase 2 → Phase 3 逐层缩小范围。</p>
              </div>
              <button onClick={() => setHelpOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>
            <div className="help-content">
              <ol>
                <li>
                  <strong>准备申请资料</strong>
                  <span>Phase 1 只需目标范围，以及 CV 或研究兴趣；学位和申请季在客观筛选前补齐。</span>
                </li>
                <li>
                  <strong>选择模型</strong>
                  <span>模型随时可以选择；已有 Codex 或 Claude 订阅可直接使用，自定义 API 放在高级选项中。</span>
                </li>
                <li>
                  <strong>开始寻找导师</strong>
                  <span>系统会查找真实导师，记录研究匹配、招生状态和来源。</span>
                </li>
                <li>
                  <strong>选择重点对象</strong>
                  <span>在候选导师页面勾选对象，再选择真正需要调查的维度。</span>
                </li>
                <li>
                  <strong>完成 Phase 2 背调</strong>
                  <span>出现绿色“P2 已完成”后，下面就是本轮结果；只有补充维度时才重新背调。</span>
                </li>
                <li>
                  <strong>生成排名与 Excel</strong>
                  <span>前端展示前三名，完整排名和申请准备信息自动写入当前项目 outputs 文件夹。</span>
                </li>
              </ol>
              <div className="help-note">
                <strong>当前项目输出目录</strong>
                <p>{activeProject?.path}/outputs</p>
                <p>任务耗时与 Top N 和背调维度有关；Agent 请求权限时，网页会暂停并让你决定。</p>
              </div>
            </div>
            <footer>
              <button
                className="primary-button"
                onClick={() => {
                  setHelpOpen(false);
                  if (rankingComplete) openProjectView("ranking");
                  else if (detectiveComplete) openProjectView("ranking");
                  else if (projectStatus.candidateCount > 0) openProjectView("evidence");
                  else if (projectReadiness.phase1Ready) startPhaseOne();
                  else window.setTimeout(focusApplicationInput, 100);
                }}
              >
                {rankingComplete
                  ? "查看最终结果"
                  : detectiveComplete
                    ? "进入综合排名"
                    : projectStatus.candidateCount > 0
                      ? "配置导师背调"
                      : projectReadiness.phase1Ready
                        ? "开始寻找导师"
                        : "去补齐 Phase 1 输入"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {projectModalOpen && (
        <div className="project-modal-layer" role="dialog" aria-modal="true" aria-label="新建申请项目">
          <button
            className="runner-backdrop"
            aria-label="关闭新建项目"
            onClick={() => setProjectModalOpen(false)}
          />
          <section className="project-modal">
            <header>
              <div>
                <span className="section-kicker">NEW PROJECT</span>
                <h2>新建申请项目</h2>
                <p>为一次申请季或一个申请方向创建独立工作区。</p>
              </div>
              <button onClick={() => setProjectModalOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>
            <div className="project-form">
              <label>
                <span>项目名称</span>
                <input
                  value={projectDraft.name}
                  onChange={(event) =>
                    setProjectDraft({ name: event.target.value })
                  }
                  placeholder="例如：我的 2027 博士申请"
                  autoFocus
                />
                <small>创建后再填写 CV、申请季、目标范围和研究兴趣。</small>
              </label>
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setProjectModalOpen(false)}>
                取消
              </button>
              <button
                className="primary-button"
                onClick={createProject}
                disabled={projectDraft.name.trim().length < 2}
              >
                创建并填写资料
              </button>
            </footer>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
