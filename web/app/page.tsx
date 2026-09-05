"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildApplicationMaterialTaskPrompt,
  buildInvestigationTaskPrompt,
  buildPhaseOneTaskPrompt,
  buildRankingTaskPrompt,
  defaultTask,
} from "./run-task-prompts.mjs";
import { appendVisibleRunEvent } from "./run-event-state.mjs";

type Provider = "Claude Code" | "Codex" | "Custom API";
type View = "overview" | "candidates" | "evidence" | "ranking" | "materials";
type RunnerMode =
  | "finder"
  | "detective"
  | "ranking"
  | "research_proposal"
  | "outreach_email";
type RunState =
  | "idle"
  | "starting"
  | "running"
  | "waiting_permission"
  | "completed"
  | "partial"
  | "needs_input"
  | "failed"
  | "cancelled"
  | "interrupted";

type RunInputField = {
  id: string;
  label: string;
  required: boolean;
  hint: string | null;
};

type RunInputRequest = {
  reason: string | null;
  fields: RunInputField[];
  requestedAt: string;
};

type ActiveRun = {
  id: string;
  projectId: string;
  provider: string;
  mode: RunnerMode;
  status: string;
  startedAt: string;
  outputDirectory: string;
  missingArtifacts?: string[];
  requestedInput?: RunInputRequest | null;
  pendingPermissions?: PermissionRequest[];
};

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
  cvValid?: boolean;
  modes?: Record<
    | "finder"
    | "finder_objective"
    | "detective"
    | "ranking"
    | "research_proposal"
    | "outreach_email",
    { ready: boolean; missing: string[] }
  >;
};

type AdvisorProject = {
  schemaVersion: number;
  id: string;
  slug: string;
  name: string;
  applicantName: string;
  season: string;
  degree: string;
  target: string;
  hardConstraints: string;
  portfolioStrategy: "balanced" | "conservative" | "ambitious";
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
  applicationMaterials: {
    draft: {
      advisorProgramId: string;
      materials: Array<"research_proposal" | "outreach_email">;
      order: Array<"research_proposal" | "outreach_email">;
      literaturePolicy: {
        advisorWorks: true;
        fieldWorks: true;
        downloadOpenAccess: true;
      };
      revision: number;
      updatedAt: string;
    };
    confirmed: {
      advisorProgramId: string;
      materials: Array<"research_proposal" | "outreach_email">;
      order: Array<"research_proposal" | "outreach_email">;
      literaturePolicy: {
        advisorWorks: true;
        fieldWorks: true;
        downloadOpenAccess: true;
      };
      revision: number;
      confirmedAt: string;
      fingerprint: string;
      source: "user_confirmed" | "legacy_artifact";
    } | null;
  };
  materialArtifacts: Record<
    "research_proposal" | "outreach_email",
    {
      complete: boolean;
      missing: string[];
      targetRoot?: string;
      literature?: Array<{
        literatureId: string;
        category: "advisor_work" | "field_work";
        title: string;
        authors: string[];
        year: number | null;
        canonicalUrl: string;
        localPath: string;
        sha256: string;
        relationship: { type?: string; note?: string } | null;
      }>;
    }
  >;
  cv: {
    name: string;
    path: string;
    absolutePath: string | null;
    valid: boolean;
    issue: string | null;
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
  totalScore: number | null;
  profileMatch?: number | null;
  overallMatch?: number | null;
  competitiveness?: "reach" | "match" | "safer" | "unknown";
  hardConstraintStatus?: "pass" | "fail" | "unknown";
  applicationPathway?: string;
  opportunityStatus?: string;
  recommendedAction?: string;
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
  profileMatch?: number | null;
  overallMatch?: number | null;
  competitiveness?: "reach" | "match" | "safer" | "unknown";
  matchReasons?: string[];
  hardConstraintStatus?: "pass" | "fail" | "unknown";
  hardConstraintReasons?: string[];
  applicationPathway?:
    | "supervisor_led"
    | "committee_led"
    | "advertised_position"
    | "structured_program"
    | "unknown";
  opportunityStatus?: "verified_open" | "signal_only" | "unknown" | "verified_closed";
  recommendedAction?:
    | "apply_vacancy"
    | "contact_supervisor"
    | "apply_program"
    | "monitor"
    | "exclude"
    | "verify_constraints"
    | "verify_eligibility"
    | "verify_pathway";
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
  level?: "progress" | "warning" | "action_required" | "error" | "diagnostic";
  message?: string;
  status?: string;
  mode?: RunnerMode;
  missingArtifacts?: string[];
  requestedInput?: RunInputRequest | null;
  pendingPermissions?: PermissionRequest[];
  outputDirectory?: string;
  raw?: unknown;
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

const runModeArtifactLabels: Record<RunnerMode, string> = {
  finder: "Phase 1 候选导师",
  detective: "Phase 2 背调结果",
  ranking: "Phase 3 综合排名",
  research_proposal: "Research Proposal 与可核验文献包",
  outreach_email: "陶瓷信与引用审计",
};

function runModeArtifactLabel(mode: RunnerMode) {
  return runModeArtifactLabels[mode] || "本阶段结果";
}

const runInputFieldLabels: Record<string, string> = {
  cv: "上传可读取的真实 CV",
  degree: "目标学位",
  degreeLevel: "目标学位",
  season: "申请季",
  target: "目标院校或地区范围",
  applicantName: "申请者真实姓名",
  interests: "研究兴趣（逗号分隔）",
  shortlistTarget: "shortlist 数量",
};

const hiddenProjectsStorageKey = "advisor-atlas.hidden-project-ids.v1";

const applicationPathwayLabels: Record<string, string> = {
  supervisor_led: "导师主导",
  committee_led: "委员会录取",
  advertised_position: "公开岗位",
  structured_program: "结构化项目",
  unknown: "路径待核实",
};

const recommendedActionLabels: Record<string, string> = {
  apply_vacancy: "按岗位申请",
  contact_supervisor: "先联系导师",
  apply_program: "申请项目",
  monitor: "继续监测",
  exclude: "排除",
  verify_constraints: "先核实硬条件",
  verify_eligibility: "先核实申请资格",
  verify_pathway: "核实申请路径",
};

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
  const [runtimeRefreshing, setRuntimeRefreshing] = useState(false);
  const [projects, setProjects] = useState<AdvisorProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsRoot, setProjectsRoot] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenProjectsReady, setHiddenProjectsReady] = useState(false);
  const [hiddenProjectsOpen, setHiddenProjectsOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState("");
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<AdvisorProject | null>(
    null,
  );
  const [deleteProjectConfirmation, setDeleteProjectConfirmation] = useState("");
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: "" });
  const [applicationDraft, setApplicationDraft] = useState<{
    applicantName: string;
    season: string;
    degree: string;
    target: string;
    hardConstraints: string;
    portfolioStrategy: "balanced" | "conservative" | "ambitious";
    shortlistTarget: string;
    interests: Array<{ name: string; weight: string }>;
  }>({
    applicantName: "",
    season: "",
    degree: "",
    target: "",
    hardConstraints: "",
    portfolioStrategy: "balanced",
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
  const [missingArtifacts, setMissingArtifacts] = useState<string[]>([]);
  const [technicalEvents, setTechnicalEvents] = useState<RunEvent[]>([]);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [requestedInput, setRequestedInput] = useState<RunInputRequest | null>(null);
  const [inputAnswers, setInputAnswers] = useState<Record<string, string>>({});
  const [inputSaving, setInputSaving] = useState(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [lastInterruptedRun, setLastInterruptedRun] = useState<ActiveRun | null>(null);
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
  const attachedRunIdRef = useRef("");
  const runnerModeRef = useRef<RunnerMode>("finder");
  const syncedProjectIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [communityConsent, setCommunityConsent] = useState(false);
  const [investigationSaving, setInvestigationSaving] = useState(false);
  const [investigationConfirmOpen, setInvestigationConfirmOpen] = useState(false);
  const [evidenceConfigOpen, setEvidenceConfigOpen] = useState(true);
  const [materialAdvisorId, setMaterialAdvisorId] = useState("");
  const [selectedMaterials, setSelectedMaterials] = useState<
    Set<"research_proposal" | "outreach_email">
  >(() => new Set(["research_proposal", "outreach_email"]));
  const [materialOrder, setMaterialOrder] = useState<
    "research_proposal_first" | "outreach_email_first"
  >("research_proposal_first");
  const [materialsSaving, setMaterialsSaving] = useState(false);
  const [materialsConfirmOpen, setMaterialsConfirmOpen] = useState(false);
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
        if (
          preferredId &&
          !hiddenProjectIds.has(preferredId) &&
          nextProjects.some((item) => item.id === preferredId)
        ) {
          return preferredId;
        }
        if (
          current &&
          !hiddenProjectIds.has(current) &&
          nextProjects.some((item) => item.id === current)
        ) {
          return current;
        }
        return nextProjects.find((item) => !hiddenProjectIds.has(item.id))?.id || "";
      });
    } finally {
      setProjectsLoading(false);
    }
  }

  async function refreshRuntimeStatus(notify = false) {
    setRuntimeRefreshing(true);
    try {
      const response = await fetch(`${runtimeUrl}/api/health`, { cache: "no-store" });
      if (!response.ok) throw new Error("本地运行服务未响应");
      const payload = (await response.json()) as RuntimeHealth;
      setRuntimeHealth(payload);
      setRuntimeError("");
      if (notify) showNotice("模型连接状态已刷新");
    } catch {
      setRuntimeHealth(null);
      setRuntimeError("本地运行服务未启动");
      if (notify) showNotice("刷新失败：本地运行服务未启动");
    } finally {
      setRuntimeLoading(false);
      setRuntimeRefreshing(false);
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
    // Initial bootstrap is intentionally one-shot; later project refreshes are
    // triggered by explicit mutations and project switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(hiddenProjectsStorageKey) || "[]");
      if (Array.isArray(saved)) {
        setHiddenProjectIds(new Set(saved.map(String)));
      }
    } catch {
      // A damaged browser preference must not make the project list unusable.
    } finally {
      setHiddenProjectsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!hiddenProjectsReady) return;
    window.localStorage.setItem(
      hiddenProjectsStorageKey,
      JSON.stringify([...hiddenProjectIds]),
    );
    if (activeProjectId && hiddenProjectIds.has(activeProjectId)) {
      setActiveProjectId(
        projects.find((item) => !hiddenProjectIds.has(item.id))?.id || "",
      );
    }
  }, [activeProjectId, hiddenProjectIds, hiddenProjectsReady, projects]);

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
  const selectedMaterialAdvisor = rankings.find(
    (item) => item.advisorProgramId === materialAdvisorId,
  );
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
    missing: ["填写目标院校或地区范围", "上传可读取的真实 CV"],
    objectiveChecks: [],
    objectiveMissing: ["填写目标学位", "填写申请季"],
    matchingSignal: "none",
    interestWeightTotal: 0,
    cvValid: false,
    modes: {
      finder: { ready: false, missing: ["填写目标院校或地区范围"] },
      finder_objective: { ready: false, missing: [] },
      detective: { ready: false, missing: [] },
      ranking: { ready: false, missing: [] },
      research_proposal: { ready: false, missing: [] },
      outreach_email: { ready: false, missing: [] },
    },
  };
  // A project payload from an older runtime has no readiness matrix. Degrade to
  // the Phase 1 rule instead of throwing while rendering, which blanks the page.
  function modeReadiness(mode: RunnerMode): { ready: boolean; missing: string[] } {
    const modes = projectReadiness.modes;
    if (!modes) {
      return {
        ready: projectReadiness.phase1Ready,
        missing: projectReadiness.missing || [],
      };
    }
    if (mode === "detective") return modes.detective;
    if (mode === "ranking") return modes.ranking;
    if (mode === "research_proposal") return modes.research_proposal;
    if (mode === "outreach_email") return modes.outreach_email;
    return modes.finder;
  }

  const draftInterestTotal = applicationDraft.interests.reduce(
    (sum, interest) => sum + (Number(interest.weight) || 0),
    0,
  );
  const hasDraftInterests = applicationDraft.interests.some((interest) =>
    interest.name.trim(),
  );
  const draftCompleted = [
    Boolean(applicationDraft.target.trim()),
    Boolean(filePath),
  ].filter(Boolean).length;
  const draftMissing = [
    !applicationDraft.target.trim() ? "填写目标院校或地区范围" : "",
    !filePath ? "上传可读取的真实 CV" : "",
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
  const confirmedMaterials = activeProject?.applicationMaterials?.confirmed || null;
  const materialArtifacts = activeProject?.materialArtifacts;
  const completedMaterialCount = ["outreach_email", "research_proposal"].filter(
    (material) =>
      materialArtifacts?.[
        material as "outreach_email" | "research_proposal"
      ]?.complete,
  ).length;
  const materialWorkflowBlock = !rankingComplete
    ? projectStatus.candidateCount === 0
      ? {
          title: "先完成候选导师发现",
          description: "申请材料必须绑定真实导师—项目组合，请先从 CV 和申请目标建立候选名单。",
          action: "前往候选导师",
          view: "candidates" as View,
        }
      : detectiveEvidenceCount === 0
        ? {
            title: "先完成重点导师背调",
            description: "请先选择重点导师并完成证据核验，再进入最终目标确认。",
            action: "前往背调证据",
            view: "evidence" as View,
          }
        : {
            title: "先生成最终排名",
            description: "背调已经具备基础证据，请先形成可追溯排名，再精确选择导师—项目组合。",
            action: "前往最终排名",
            view: "ranking" as View,
          }
    : null;
  const applicantIdentityReady = Boolean(
    activeProject?.cv?.valid && activeProject?.applicantName?.trim(),
  );
  const materialOrderList = [...selectedMaterials].sort((left, right) => {
    const preferred = materialOrder === "research_proposal_first"
      ? ["research_proposal", "outreach_email"]
      : ["outreach_email", "research_proposal"];
    return preferred.indexOf(left) - preferred.indexOf(right);
  });
  const confirmedMaterialsMatchDraft = Boolean(
    confirmedMaterials &&
      confirmedMaterials.advisorProgramId === materialAdvisorId &&
      confirmedMaterials.materials.length === selectedMaterials.size &&
      confirmedMaterials.materials.every((item) => selectedMaterials.has(item)) &&
      confirmedMaterials.order.length === materialOrderList.length &&
      confirmedMaterials.order.every((item, index) => item === materialOrderList[index]),
  );
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
            `只调查已选择的 ${selected.size} 个导师—项目组合`,
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
        : runnerMode === "research_proposal"
          ? {
              kicker: "RESEARCH PROPOSAL",
              title: "生成 Research Proposal",
              description: "围绕已确认导师与项目，建立可核验文献包后再写作。",
              runningLabel: "正在研究与写作",
              startLabel: "开始生成 RP",
              completionHint: "只有 RP、审计文件和本地文献包全部通过校验才会完成。",
              summary: [
                `精确目标：${confirmedMaterials?.advisorProgramId || "尚未确认"}`,
                "同时核验导师本人/团队文献与领域文献",
                "只下载合法公开 PDF，记录 SHA-256、来源与读取层级",
              ],
            }
          : runnerMode === "outreach_email"
            ? {
                kicker: "ADVISOR OUTREACH",
                title: "生成陶瓷信",
                description: "用真实申请者经历与已核验导师文献建立一条具体连接。",
                runningLabel: "正在核验与起草",
                startLabel: "开始生成陶瓷信",
                completionHint: "完成后会保留邮件草稿、引用审计和本地文献包。",
                summary: [
                  `精确目标：${confirmedMaterials?.advisorProgramId || "尚未确认"}`,
                  "检查官方联系规则，不承诺导师一定回复",
                  "邮件不自动发送；引用来源全部留在本地审计中",
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
    // Investigation/material choices only re-seed on a project switch. Profile
    // and CV state may also change after an upload or Agent run, so refresh them
    // whenever there is no unsaved form edit.
    const projectChanged = syncedProjectIdRef.current !== activeProject.id;
    if (projectChanged || !intakeDirty) {
      setApplicationDraft({
        applicantName: activeProject.applicantName || "",
        season: activeProject.season || "",
        degree: activeProject.degree || "",
        target: activeProject.target || "",
        hardConstraints: activeProject.hardConstraints || "",
        portfolioStrategy: activeProject.portfolioStrategy || "balanced",
        shortlistTarget: String(activeProject.shortlistTarget || 10),
        interests: activeProject.interests?.length
          ? activeProject.interests.map((interest) => ({
              name: interest.name,
              weight: String(interest.weight),
            }))
          : [{ name: "", weight: "" }],
      });
    }
    setFileName(activeProject.cv?.name || "尚未上传真实 CV");
    setFilePath(activeProject.cv?.valid ? activeProject.cv.absolutePath || "" : "");
    setUploadState(activeProject.cv?.valid ? "ready" : activeProject.cv?.path ? "failed" : "idle");
    if (!projectChanged) return;
    syncedProjectIdRef.current = activeProject.id;
    setSelected(
      new Set(activeProject.investigation?.draft?.selectedAdvisorProgramIds || []),
    );
    setSelectedSections(
      new Set(activeProject.investigation?.draft?.selectedSections || []),
    );
    setCommunityConsent(
      Boolean(activeProject.investigation?.draft?.communitySources?.requested),
    );
    setIntakeDirty(false);
    setEvidenceConfigOpen(!activeProject.detectiveResults?.results.length);
    setInvestigationConfirmOpen(false);
    const savedMaterials = activeProject.applicationMaterials?.draft;
    setMaterialAdvisorId(savedMaterials?.advisorProgramId || "");
    setSelectedMaterials(
      new Set(savedMaterials?.materials?.length
        ? savedMaterials.materials
        : ["research_proposal", "outreach_email"]),
    );
    setMaterialOrder(
      savedMaterials?.order?.[0] === "outreach_email"
        ? "outreach_email_first"
        : "research_proposal_first",
    );
    setMaterialsConfirmOpen(false);
  }, [activeProjectId, activeProject, intakeDirty]);

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

  // Closing the panel or reloading the page must not lose a running task. The
  // runtime already tracks it; the console just never asked.
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    if (activeRun && activeRun.projectId !== activeProjectId) {
      attachedRunIdRef.current = "";
      setActiveRun(null);
      setRunState("idle");
      setRunEvents([]);
      setPendingPermissions([]);
      setRequestedInput(null);
      setMissingArtifacts([]);
      setRunId("");
      runIdRef.current = "";
    }
    fetch(`${runtimeUrl}/api/runs?projectId=${encodeURIComponent(activeProjectId)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        const running = (payload.active || [])[0] as ActiveRun | undefined;
        if (running) {
          setLastInterruptedRun(null);
          void attachToRun(running);
          return;
        }
        const latest = (payload.recent || [])[0] as ActiveRun | undefined;
        if (latest?.status === "interrupted") {
          setLastInterruptedRun(latest);
          setRunnerMode(latest.mode);
          runnerModeRef.current = latest.mode;
          setRunId(latest.id);
          runIdRef.current = latest.id;
          setRunOutputDirectory(latest.outputDirectory || "");
          setRunState("interrupted");
          setMissingArtifacts(latest.missingArtifacts || []);
          setRunEvents([
            {
              type: "run.interrupted",
              source: "runtime",
              level: "warning",
              message:
                "本地运行服务曾在任务结束前重启，这个 Agent 会话已经中断，请检查已有产物后重新启动。",
            },
          ]);
        } else {
          setLastInterruptedRun(null);
          setRunState((current) => (current === "interrupted" ? "idle" : current));
        }
      })
      .catch(() => {
        // A missing runtime is already surfaced by the health check.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      "硬条件状态",
      "硬条件说明",
      "申请路径",
      "机会状态",
      "下一步",
      "申请定位",
      "履历匹配分",
      "综合匹配分",
      "综合匹配依据",
      "证据数",
      "研究匹配分",
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
      candidate.hardConstraintStatus || "unknown",
      candidate.hardConstraintReasons?.join("；") || "",
      candidate.applicationPathway || "unknown",
      candidate.opportunityStatus || "unknown",
      candidate.recommendedAction || "verify_pathway",
      candidate.competitiveness || "unknown",
      candidate.profileMatch ?? "",
      candidate.overallMatch ?? "",
      candidate.matchReasons?.join("；") || "",
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
    // Reopening while a task is still running must show that task, not wipe it.
    if (activeRun) {
      setRunnerOpen(true);
      return;
    }
    setRunnerMode(mode);
    runnerModeRef.current = mode;
    setAdvancedOpen(false);
    setRunState("idle");
    setRunId("");
    runIdRef.current = "";
    setRunOutputDirectory("");
    setRunEvents([]);
    setPendingPermissions([]);
    setResolvingPermissionId("");
    setMissingArtifacts([]);
    setRequestedInput(null);
    setInputAnswers({});
    setLastRunActivityAt(0);
    setRunStalled(false);
    setRunnerOpen(true);
  }

  function buildPhaseOnePrompt() {
    return buildPhaseOneTaskPrompt({ project: activeProject, filePath });
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

  // Closing only hides the panel. Stopping the agent is a separate, explicit
  // decision the user has to make on purpose.
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
    setView("overview");
    window.requestAnimationFrame(() => {
      intakeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    showNotice(
      activeProject?.cv && !activeProject.cv.valid
        ? activeProject.cv.issue || "CV 文件已失效，请重新上传"
        : projectReadiness.missing.length
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
    field:
      | "applicantName"
      | "season"
      | "degree"
      | "target"
      | "hardConstraints"
      | "portfolioStrategy",
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
          applicantName: applicationDraft.applicantName,
          season: applicationDraft.season,
          degree: applicationDraft.degree,
          target: applicationDraft.target,
          hardConstraints: applicationDraft.hardConstraints,
          portfolioStrategy: applicationDraft.portfolioStrategy,
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
    if (intakeDirty) {
      setView("overview");
      showNotice("请先保存刚刚修改的申请资料，再重新匹配");
      window.requestAnimationFrame(() => {
        intakeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    if (!modeReadiness("finder").ready) {
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
      if (requestedInput?.fields.some((field) => field.id === "cv")) {
        setInputAnswers((current) => ({ ...current, cv: payload.path }));
      }
      await refreshProjects(activeProjectId);
      showNotice("CV 已保存到当前申请项目");
    } catch (error) {
      setUploadState("failed");
      showNotice(error instanceof Error ? error.message : "CV 本地保存失败");
    }
  }

  // Both the POST that starts a run and the GET that re-attaches to one deliver
  // the same NDJSON event stream, so a single reader keeps recovery and startup
  // behaving identically.
  async function consumeRunStream(body: ReadableStream<Uint8Array>, mode: RunnerMode) {
    const reader = body.getReader();
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
        if (event.type === "run.attached") {
          setPendingPermissions(event.pendingPermissions || []);
          setRunState(
            event.status === "needs_input"
              ? "needs_input"
              : event.pendingPermissions?.length
                ? "waiting_permission"
                : "running",
          );
          if (event.requestedInput) setRequestedInput(event.requestedInput);
        }
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
        if (event.type === "input.requested" && event.requestedInput) {
          setRequestedInput(event.requestedInput);
          setInputAnswers({});
        }
        if (event.type === "run.waiting_input") {
          setRunState("needs_input");
          if (event.requestedInput) setRequestedInput(event.requestedInput);
        }
        if (event.type === "run.continued") {
          setRunState("running");
          setRequestedInput(null);
        }
        if (event.level === "diagnostic" || event.type === "diagnostic") {
          // Internal plumbing stays available but never competes with progress.
          setTechnicalEvents((current) => [...current.slice(-199), event]);
        }
        if (event.message && event.level !== "diagnostic") {
          setRunEvents((current) => appendVisibleRunEvent(current, event));
        }
        if (event.type === "run.finished") {
          setPendingPermissions([]);
          setActiveRun(null);
          attachedRunIdRef.current = "";
          setRunState((event.status as RunState) || "completed");
          setMissingArtifacts(event.missingArtifacts || []);
          if (event.requestedInput) setRequestedInput(event.requestedInput);
          await refreshProjects(activeProjectId);
          // Only a verified artifact counts as done; a model that merely
          // answered must never be reported as a finished phase.
          if (event.status === "completed") {
            if (mode === "detective") {
              setView("evidence");
              // A finished round is the only reason to fold the configuration
              // away; editing the draft must leave the panel where it is.
              setEvidenceConfigOpen(false);
              setInvestigationConfirmOpen(false);
              showNotice("导师背调已完成，证据与风险信息已更新");
            } else if (mode === "ranking") {
              setView("ranking");
              showNotice("综合排名已生成");
            } else if (mode === "research_proposal") {
              setView("materials");
              showNotice("Research Proposal 与本地文献核验包已生成");
            } else if (mode === "outreach_email") {
              setView("materials");
              showNotice("陶瓷信、引用审计与本地文献核验包已生成");
            } else {
              setView("candidates");
              showNotice("导师搜索已完成，候选名单已更新");
            }
          } else if (event.status === "needs_input") {
            showNotice("本轮已结束，Agent 需要你补充资料后才能继续");
          } else if (event.status === "partial") {
            showNotice(`本轮已结束，但尚未产生${runModeArtifactLabel(mode)}`);
          }
        }
      }
    }
  }

  async function attachToRun(run: ActiveRun) {
    if (attachedRunIdRef.current === run.id) return;
    attachedRunIdRef.current = run.id;
    setLastInterruptedRun(null);
    setActiveRun(run);
    setRunnerMode(run.mode);
    runnerModeRef.current = run.mode;
    setRunId(run.id);
    runIdRef.current = run.id;
    setRunOutputDirectory(run.outputDirectory || "");
    setRunEvents([]);
    setTechnicalEvents([]);
    setMissingArtifacts([]);
    setRequestedInput(run.requestedInput || null);
    setRunState(run.pendingPermissions?.length ? "waiting_permission" : "running");
    if (run.status === "needs_input") setRunState("needs_input");
    setPendingPermissions(run.pendingPermissions || []);
    setLastRunActivityAt(Date.now());
    try {
      const response = await fetch(`${runtimeUrl}/api/runs/${run.id}/stream`);
      if (!response.ok || !response.body) throw new Error("无法接回正在运行的任务");
      await consumeRunStream(response.body, run.mode);
    } catch (error) {
      attachedRunIdRef.current = "";
      setActiveRun(null);
      setRunState("failed");
      setRunEvents((current) => [
        ...current,
        {
          type: "run.error",
          source: "runtime",
          message:
            error instanceof Error ? error.message : "无法接回正在运行的任务",
        },
      ]);
    }
  }

  async function runAgent(promptOverride?: string) {
    const health = selectedProviderHealth();
    const readiness = modeReadiness(runnerMode);
    if (!readiness.ready) {
      setRunnerOpen(false);
      focusApplicationInput();
      return;
    }
    if (!health?.installed || !health.loggedIn || !activeProjectId) return;

    setRunState("starting");
    setLastInterruptedRun(null);
    setRunEvents([]);
    setLastRunActivityAt(Date.now());
    setRunStalled(false);
    setRunId("");
    runIdRef.current = "";
    setRunOutputDirectory("");
    setPendingPermissions([]);
    setTechnicalEvents([]);
    setMissingArtifacts([]);
    setRequestedInput(null);

    try {
      const basePrompt = promptOverride || taskPrompt;
      const cvPath = activeProject?.cv?.absolutePath || filePath;
      const effectivePrompt =
        cvPath && activeProject?.cv?.valid
          ? `${basePrompt}\n\n已上传 CV：${cvPath}`
          : basePrompt;
      const response = await fetch(`${runtimeUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          mode: runnerMode,
          confirmedRevision:
            ["research_proposal", "outreach_email"].includes(runnerMode)
              ? activeProject?.applicationMaterials?.confirmed?.revision ?? undefined
              : activeProject?.investigation?.confirmed?.revision ?? undefined,
          provider:
            provider === "Codex"
              ? "codex"
              : provider === "Claude Code"
                ? "claude"
                : "custom",
          prompt: effectivePrompt,
        }),
      });

      if (response.status === 409) {
        const payload = await response.json();
        if (payload.activeRun) {
          showNotice("该项目已有任务在运行，已为你接回原任务");
          await attachToRun(payload.activeRun as ActiveRun);
          return;
        }
        throw new Error(payload.error || "无法启动本地 Agent");
      }
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "无法启动本地 Agent");
      }
      if (!response.body) throw new Error("浏览器不支持流式输出");

      setRunState("running");
      setActiveRun({
        id: runIdRef.current,
        projectId: activeProjectId,
        provider,
        mode: runnerMode,
        status: "running",
        startedAt: new Date().toISOString(),
        outputDirectory: "",
      });
      await consumeRunStream(response.body, runnerMode);
    } catch (error) {
      setPendingPermissions([]);
      setActiveRun(null);
      attachedRunIdRef.current = "";
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

  async function cancelRun() {
    const currentRunId = runIdRef.current || runId;
    if (!currentRunId) return;
    if (!window.confirm("取消后本轮进度不会保存，确定要停止正在运行的任务吗？")) {
      return;
    }
    await fetch(`${runtimeUrl}/api/runs/${currentRunId}/stop`, { method: "POST" });
    setPendingPermissions([]);
    setActiveRun(null);
    attachedRunIdRef.current = "";
    setRunState("cancelled");
  }


  async function submitRequestedInput() {
    if (!requestedInput || !activeProjectId) return;
    const missing = requestedInput.fields.filter(
      (field) => field.required && !(inputAnswers[field.id] || "").trim(),
    );
    if (missing.length) {
      showNotice(
        `还需要填写：${missing
          .map((field) => field.label || runInputFieldLabels[field.id] || field.id)
          .join("、")}`,
      );
      return;
    }
    setInputSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const field of requestedInput.fields) {
        const value = (inputAnswers[field.id] || "").trim();
        if (!value) continue;
        if (field.id === "degree" || field.id === "degreeLevel") patch.degree = value;
        else if (field.id === "season") patch.season = value;
        else if (field.id === "target") patch.target = value;
        else if (field.id === "shortlistTarget") {
          patch.shortlistTarget = Number(value) || 10;
        } else if (field.id === "interests") {
          patch.interests = value
            .split(/[,，、]/)
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ name, weight: 0 }));
        }
      }
      if (Object.keys(patch).length > 0) {
        const response = await fetch(`${runtimeUrl}/api/projects/${activeProjectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "补充资料保存失败");
        await refreshProjects(activeProjectId);
      }
      const currentRunId = runIdRef.current || runId;
      if (!currentRunId) throw new Error("原 Agent 会话已丢失，无法继续");
      const continuation = await fetch(
        `${runtimeUrl}/api/runs/${currentRunId}/continue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: inputAnswers }),
        },
      );
      const continuationPayload = await continuation.json();
      if (!continuation.ok) {
        throw new Error(continuationPayload.error || "Agent 会话无法继续");
      }
      setRequestedInput(null);
      setInputAnswers({});
      setRunState("running");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "补充资料保存失败");
    } finally {
      setInputSaving(false);
    }
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
      openRunner(buildInvestigationTaskPrompt(), "detective");
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
    openRunner(buildRankingTaskPrompt(), "ranking");
  }

  async function saveApplicationMaterialsDraft(
    showConfirmation = true,
    override?: {
      materials: Set<"research_proposal" | "outreach_email">;
      order: Array<"research_proposal" | "outreach_email">;
    },
  ) {
    if (!activeProjectId) throw new Error("请先选择申请项目");
    if (!materialAdvisorId) throw new Error("请选择一个精确导师—项目组合");
    const materials = override?.materials || selectedMaterials;
    const order = override?.order || materialOrderList;
    if (!materials.size) throw new Error("请至少选择一种申请材料");
    const response = await fetch(`${runtimeUrl}/api/projects/${activeProjectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicationMaterials: {
          advisorProgramId: materialAdvisorId,
          materials: [...materials],
          order,
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "申请材料配置保存失败");
    setProjects((current) =>
      current.map((project) =>
        project.id === activeProjectId ? payload.project : project,
      ),
    );
    if (showConfirmation) setMaterialsConfirmOpen(true);
    return payload.project as AdvisorProject;
  }

  async function prepareApplicationMaterial(
    material: "research_proposal" | "outreach_email",
  ) {
    if (materialWorkflowBlock) {
      showNotice(materialWorkflowBlock.title);
      openProjectView(materialWorkflowBlock.view);
      return;
    }
    if (!applicantIdentityReady) {
      showNotice("请先补齐真实姓名并确认原 CV 仍可读取");
      focusApplicationInput();
      return;
    }
    if (!materialAdvisorId) {
      showNotice("请先选择一个精确导师—项目组合");
      return;
    }
    const nextMaterials = new Set<"research_proposal" | "outreach_email">([material]);
    const nextOrder = [material];
    setSelectedMaterials(nextMaterials);
    setMaterialOrder(
      material === "outreach_email" ? "outreach_email_first" : "research_proposal_first",
    );
    setMaterialsSaving(true);
    try {
      await saveApplicationMaterialsDraft(true, {
        materials: nextMaterials,
        order: nextOrder,
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "申请材料配置保存失败");
    } finally {
      setMaterialsSaving(false);
    }
  }

  async function confirmApplicationMaterials() {
    setMaterialsSaving(true);
    try {
      const saved = await saveApplicationMaterialsDraft(false);
      const response = await fetch(
        `${runtimeUrl}/api/projects/${activeProjectId}/application-materials/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftRevision: saved.applicationMaterials.draft.revision,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "申请材料最终确认失败");
      setProjects((current) =>
        current.map((project) =>
          project.id === activeProjectId ? payload.project : project,
        ),
      );
      setMaterialsConfirmOpen(false);
      showNotice("申请材料目标、顺序与文献核验条件已确认");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "申请材料最终确认失败");
    } finally {
      setMaterialsSaving(false);
    }
  }

  function startApplicationMaterial(
    mode: "research_proposal" | "outreach_email",
  ) {
    const readiness = modeReadiness(mode);
    if (!readiness.ready) {
      showNotice(`生成申请材料前，请先完成：${readiness.missing.join("、")}`);
      intakeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const confirmed = activeProject?.applicationMaterials?.confirmed;
    if (!confirmed || !confirmedMaterialsMatchDraft) {
      showNotice("请先最终确认当前申请材料配置");
      return;
    }
    openRunner(buildApplicationMaterialTaskPrompt(mode), mode);
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

  function latestProjectView(project: AdvisorProject): View {
    if (project.rankings?.length) return "ranking";
    if (project.detectiveResults?.results?.length) return "evidence";
    if (project.candidates?.length) return "candidates";
    return "overview";
  }

  function selectProject(projectId: string, nextView: View = "overview") {
    setProjectMenuId("");
    setActiveProjectId(projectId);
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function hideProject(project: AdvisorProject) {
    setHiddenProjectIds((current) => new Set(current).add(project.id));
    setProjectMenuId("");
    showNotice(`“${project.name}”已从列表隐藏，本地文件仍完整保留`);
  }

  function restoreProject(project: AdvisorProject) {
    setHiddenProjectIds((current) => {
      const next = new Set(current);
      next.delete(project.id);
      return next;
    });
    showNotice(`“${project.name}”已恢复到项目列表`);
  }

  function openDeleteProject(project: AdvisorProject) {
    setProjectMenuId("");
    setDeleteProjectTarget(project);
    setDeleteProjectConfirmation("");
  }

  async function permanentlyDeleteProject() {
    if (
      !deleteProjectTarget ||
      deleteProjectConfirmation !== deleteProjectTarget.name ||
      deleteProjectBusy
    ) {
      return;
    }
    setDeleteProjectBusy(true);
    try {
      const response = await fetch(
        `${runtimeUrl}/api/projects/${deleteProjectTarget.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmName: deleteProjectConfirmation }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "本地项目删除失败");
      const deletedId = deleteProjectTarget.id;
      const deletedName = deleteProjectTarget.name;
      setHiddenProjectIds((current) => {
        const next = new Set(current);
        next.delete(deletedId);
        return next;
      });
      setDeleteProjectTarget(null);
      setDeleteProjectConfirmation("");
      syncedProjectIdRef.current = null;
      await refreshProjects();
      showNotice(`“${deletedName}”及其本地文件已彻底删除`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "本地项目删除失败");
    } finally {
      setDeleteProjectBusy(false);
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
  const visibleProjects = projects.filter((item) => !hiddenProjectIds.has(item.id));
  const hiddenProjects = projects.filter((item) => hiddenProjectIds.has(item.id));
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
          <button
            className={view === "materials" ? "active" : ""}
            onClick={() => openProjectView("materials")}
          >
            <span className="nav-icon">✦</span> 陶瓷信与 RP
            <em>{completedMaterialCount}/2</em>
          </button>

          <section className="project-nav" aria-label="申请项目">
            <p className="nav-label second">申请项目</p>
            <div className="project-list">
              {projectsLoading && <span className="project-loading">正在加载项目…</span>}
              {!projectsLoading && !visibleProjects.length && (
                <span className="project-loading">暂无显示中的项目</span>
              )}
              {visibleProjects.map((item) => (
                <div className="project-row" key={item.id}>
                  <button
                    className={`project-link ${item.id === activeProjectId ? "" : "subdued"}`}
                    onClick={() => selectProject(item.id, latestProjectView(item))}
                    title={item.name}
                  >
                    <span
                      className={`project-dot ${
                        item.id === activeProjectId ? "violet" : "mint"
                      }`}
                    />
                    <span className="project-label">
                      <span className="project-name">{item.name}</span>
                      <small>
                        {item.rankings.length
                          ? `${item.rankings.length} 位排名 · 点击查看`
                          : item.detectiveResults?.results.length
                            ? `${item.detectiveResults.results.length} 位背调 · 点击查看`
                            : item.candidates.length
                              ? `${item.candidates.length} 位候选 · 点击查看`
                              : "尚未产生结果"}
                      </small>
                    </span>
                  </button>
                  <button
                    className="project-menu-button"
                    aria-label={`管理项目 ${item.name}`}
                    aria-expanded={projectMenuId === item.id}
                    onClick={() =>
                      setProjectMenuId((current) => (current === item.id ? "" : item.id))
                    }
                  >
                    ⋯
                  </button>
                  {projectMenuId === item.id && (
                    <div className="project-menu" role="menu">
                      <button role="menuitem" onClick={() => hideProject(item)}>
                        从列表隐藏
                        <small>保留全部本地文件</small>
                      </button>
                      <button
                        className="danger"
                        role="menuitem"
                        onClick={() => openDeleteProject(item)}
                      >
                        彻底删除本地文件
                        <small>不可恢复</small>
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button
                className="project-link subdued new-project-link"
                onClick={() => setProjectModalOpen(true)}
              >
                <span className="project-dot mint" />
                <span className="project-name">新建申请项目</span>
              </button>
              {hiddenProjects.length > 0 && (
                <div className="hidden-projects">
                  <button
                    className="hidden-projects-toggle"
                    onClick={() => setHiddenProjectsOpen((current) => !current)}
                    aria-expanded={hiddenProjectsOpen}
                  >
                    {hiddenProjectsOpen ? "收起" : "显示"}已隐藏项目（{hiddenProjects.length}）
                  </button>
                  {hiddenProjectsOpen &&
                    hiddenProjects.map((item) => (
                      <div className="hidden-project-row" key={item.id}>
                        <span title={item.name}>{item.name}</span>
                        <button onClick={() => restoreProject(item)}>恢复</button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </section>
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
            {activeRun && (
              <button
                className="running-badge"
                onClick={() => setRunnerOpen(true)}
                title="任务仍在后台运行，点击查看进度"
              >
                <span className="pulse-dot" />
                任务运行中 · {runModeArtifactLabel(activeRun.mode)}
              </button>
            )}
            {!activeRun && lastInterruptedRun && (
              <button
                className="running-badge interrupted-badge"
                onClick={() => {
                  setRunnerMode(lastInterruptedRun.mode);
                  runnerModeRef.current = lastInterruptedRun.mode;
                  setRunnerOpen(true);
                }}
                title="上次任务因本地运行服务重启而中断，点击查看"
              >
                上次任务已中断 · {runModeArtifactLabel(lastInterruptedRun.mode)}
              </button>
            )}
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
                        : "模型引擎可以随时选择；启动 Phase 1 需要目标范围和一份真实 CV。"}
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
                Phase 1 需要目标范围和一份真实 CV。申请者姓名用于后续 RP 与套磁信；学位与申请季最迟在客观条件筛选前补齐。
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
                    1. 上传真实 CV <em>必需</em>
                  </strong>
                  <small>
                    {uploadState === "uploading"
                      ? "正在保存到本地…"
                      : activeProject?.cv && !activeProject.cv.valid
                        ? activeProject.cv.issue || "CV 文件已失效，请重新上传"
                        : uploadState === "ready"
                          ? `${fileName} · 已保存`
                          : uploadState === "failed"
                            ? "保存失败，请重试"
                            : "例如：Your_Name_CV.pdf · 支持 PDF / DOCX / MD（不超过 20 MB）"}
                  </small>
                </span>
                <b>{uploadState === "ready" ? "更换" : "选择文件"}</b>
              </label>
              <div className="application-form">
                <label>
                  <span>2. 申请者真实姓名 <em>RP / 套磁信前必填</em></span>
                  <input
                    value={applicationDraft.applicantName}
                    onChange={(event) =>
                      updateApplicationField("applicantName", event.target.value)
                    }
                    placeholder="例如：Zihan Hu"
                    autoComplete="name"
                  />
                  <small>用于核对申请者身份和邮件签名；若项目要求匿名 RP，不会强行写入 PDF</small>
                </label>
                <div className="application-row">
                  <label>
                    <span>3. 目标学位 <em>客观筛选前补齐</em></span>
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
                    <span>4. 申请季 <em>客观筛选前补齐</em></span>
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
                  <span>5. 目标院校或地区范围 <em>必填</em></span>
                  <textarea
                    value={applicationDraft.target}
                    onChange={(event) =>
                      updateApplicationField("target", event.target.value)
                    }
                    placeholder="例如：欧洲 QS 100–300 为主，优先 HCI / AI；排除美国；少量冲刺即可"
                    rows={2}
                  />
                  <small>越具体越好，可填写国家、学校层级、院系或明确学校名单</small>
                </label>
                <label>
                  <span>6. 必须满足的硬条件 <em>可选，但会先于评分执行</em></span>
                  <textarea
                    value={applicationDraft.hardConstraints}
                    onChange={(event) =>
                      updateApplicationField("hardConstraints", event.target.value)
                    }
                    placeholder="例如：仅欧洲；QS 100–300；排除美国；必须全奖或带薪岗位"
                    rows={2}
                  />
                  <small>不满足的候选会被排除；无法从官方来源判断时会标为“待核实”，不会假装满足</small>
                </label>
                <label>
                  <span>7. 申请组合策略 <em>用于控制冲刺比例</em></span>
                  <select
                    value={applicationDraft.portfolioStrategy}
                    onChange={(event) =>
                      updateApplicationField("portfolioStrategy", event.target.value)
                    }
                  >
                    <option value="balanced">均衡：少量冲刺，以主申和相对稳妥为主</option>
                    <option value="conservative">稳妥优先：尽量减少高门槛项目</option>
                    <option value="ambitious">冲刺优先：允许更多高门槛项目</option>
                  </select>
                  <small>只用于组合规划，不代表录取概率；系统仍会分别展示研究匹配与申请现实度</small>
                </label>
                <div className="interest-editor">
                  <div className="interest-editor-title">
                    <span>8. 研究兴趣与权重 <em>可选</em></span>
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
                  <span>9. Phase 1 希望保留的导师数</span>
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
                {candidates.length > 0 && (
                  <button className="secondary-button rematch-button" onClick={startPhaseOne}>
                    重新匹配
                  </button>
                )}
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
                    <th className="check-cell" scope="col">
                      <span className="visually-hidden">选择</span>
                    </th>
                    <th scope="col">导师</th>
                    <th scope="col">项目</th>
                    <th scope="col">研究方向</th>
                    <th scope="col">招生状态</th>
                    <th scope="col">客观可行性</th>
                    <th scope="col">硬条件</th>
                    <th scope="col">申请路径 / 下一步</th>
                    <th scope="col">证据</th>
                    <th scope="col">申请定位</th>
                    <th scope="col">研究匹配</th>
                    <th scope="col">履历匹配</th>
                    <th scope="col">综合匹配</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={13}>
                        <div className="empty-candidates">
                          <span>00</span>
                          <strong>还没有真实候选导师</strong>
                          <p>
                            {projectReadiness.phase1Ready
                              ? "Phase 1 资料已经齐全，现在可以开始寻找导师。"
                              : "请填写目标范围并上传一份可读取的真实 CV。"}
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
                      <th scope="row" className="advisor-row-header">
                        <div className="advisor-cell">
                          <span className="advisor-avatar">{candidate.initials}</span>
                          <span>
                            <strong>{candidate.name}</strong>
                            <small>{candidate.school}</small>
                          </span>
                        </div>
                      </th>
                      <td>
                        <span className="program-name">
                          {candidate.program || "项目待核实"}
                        </span>
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
                        <span
                          className={`constraint-badge ${candidate.hardConstraintStatus || "unknown"}`}
                          title={candidate.hardConstraintReasons?.join("；") || "尚无硬条件核验说明"}
                        >
                          {candidate.hardConstraintStatus === "pass"
                            ? "满足"
                            : candidate.hardConstraintStatus === "fail"
                              ? "不满足"
                              : "待核实"}
                        </span>
                      </td>
                      <td>
                        <div className="pathway-action">
                          <strong>
                            {applicationPathwayLabels[candidate.applicationPathway || "unknown"]}
                          </strong>
                          <small>
                            {recommendedActionLabels[candidate.recommendedAction || "verify_pathway"]}
                          </small>
                        </div>
                      </td>
                      <td>
                        <span className="evidence-count">{candidate.evidence} 条</span>
                      </td>
                      <td>
                        <span className={`competitiveness-badge ${candidate.competitiveness || "unknown"}`}>
                          {candidate.competitiveness === "reach"
                            ? "冲刺"
                            : candidate.competitiveness === "match"
                              ? "主申"
                              : candidate.competitiveness === "safer"
                                ? "相对稳妥"
                                : "待判断"}
                        </span>
                      </td>
                      <td>
                        <div className="fit-score">
                          <strong>{candidate.fit}</strong>
                          <span>
                            <i style={{ width: `${candidate.fit * 10}%` }} />
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="fit-score" title="基于 CV 中的方法、论文、项目与可迁移能力">
                          <strong>{candidate.profileMatch ?? "—"}</strong>
                          {candidate.profileMatch != null && (
                            <span><i style={{ width: `${candidate.profileMatch * 10}%` }} /></span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="fit-score overall-score" title={candidate.matchReasons?.join("；") || "等待基于 CV 的综合判断"}>
                          <strong>{candidate.overallMatch ?? "—"}</strong>
                          {candidate.overallMatch != null && (
                            <span><i style={{ width: `${candidate.overallMatch * 10}%` }} /></span>
                          )}
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
                已选择 <strong>{selected.size}</strong> 个导师—项目组合
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
                    已调查 {detectiveResults?.results.length || 0} 个导师—项目组合、
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
                  <span>{selected.size} 个导师—项目组合</span>
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
                        <strong>{item.totalScore != null ? item.totalScore.toFixed(1) : "—"}</strong>
                      </div>
                      <div className="ranking-decision-factors">
                        <span className={`constraint-badge ${item.hardConstraintStatus || "unknown"}`}>
                          硬条件：{item.hardConstraintStatus === "pass" ? "满足" : item.hardConstraintStatus === "fail" ? "不满足" : "待核实"}
                        </span>
                        <span className={`competitiveness-badge ${item.competitiveness || "unknown"}`}>
                          {item.competitiveness === "reach" ? "冲刺" : item.competitiveness === "match" ? "主申" : item.competitiveness === "safer" ? "相对稳妥" : "定位待判断"}
                        </span>
                        <span>{applicationPathwayLabels[item.applicationPathway || "unknown"] || "路径待核实"}</span>
                        <strong>{recommendedActionLabels[item.recommendedAction || "verify_pathway"] || "核实申请路径"}</strong>
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

          <section className="result-view materials-view" hidden={view !== "materials"}>
            <header className="view-header materials-view-header">
              <div>
                <span className="section-kicker">APPLICATION MATERIALS</span>
                <h1>陶瓷信与 Research Proposal</h1>
                <p>
                  两项材料共享同一个已确认导师—项目目标，但分别生成、分别校验；完成一项后，
                  可以随时回来继续另一项。
                </p>
              </div>
              <span className={`materials-progress-chip ${completedMaterialCount === 2 ? "complete" : ""}`}>
                {completedMaterialCount}/2 已完成
              </span>
            </header>

            {materialWorkflowBlock ? (
              <article className="panel materials-gate">
                <span className="materials-gate-icon">↳</span>
                <div>
                  <span className="section-kicker">完成前置工作</span>
                  <h2>{materialWorkflowBlock.title}</h2>
                  <p>{materialWorkflowBlock.description}</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => openProjectView(materialWorkflowBlock.view)}
                >
                  {materialWorkflowBlock.action}
                </button>
              </article>
            ) : (
              <>
                <article className="panel material-target-panel">
                  <div className="material-target-copy">
                    <span className="target-step">01</span>
                    <div>
                      <span className="section-kicker">精确申请目标</span>
                      <h2>先指定一位导师和对应项目</h2>
                      <p>不会默认使用排名第一，也不会把同名导师的其他项目视为同一个目标。</p>
                    </div>
                  </div>
                  <label className="materials-field">
                    <span>导师—项目组合</span>
                    <select
                      value={materialAdvisorId}
                      onChange={(event) => {
                        setMaterialAdvisorId(event.target.value);
                        setMaterialsConfirmOpen(false);
                      }}
                    >
                      <option value="">请选择精确目标</option>
                      {rankings.map((item) => (
                        <option key={item.advisorProgramId} value={item.advisorProgramId}>
                          #{item.rank} {item.name} · {item.program || item.school} · {item.advisorProgramId}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedMaterialAdvisor ? (
                    <div className="selected-material-target">
                      <span>当前目标</span>
                      <strong>{selectedMaterialAdvisor.name}</strong>
                      <small>
                        {[selectedMaterialAdvisor.school, selectedMaterialAdvisor.program]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      <code>{selectedMaterialAdvisor.advisorProgramId}</code>
                    </div>
                  ) : (
                    <div className="selected-material-target empty">
                      <span>等待选择</span>
                      <strong>还没有绑定目标导师</strong>
                      <small>选择后，再在下面决定先生成哪一项材料。</small>
                    </div>
                  )}
                </article>

                {!applicantIdentityReady && (
                  <article className="panel material-identity-warning">
                    <div>
                      <strong>生成前还需要补全申请者资料</strong>
                      <p>
                        {!activeProject?.applicantName?.trim()
                          ? "请填写申请者真实姓名。"
                          : "已记录申请者姓名。"}
                        {activeProject?.cv?.valid
                          ? " 当前项目中的原 CV 会被两项材料持续复用。"
                          : ` ${activeProject?.cv?.issue || "请上传一份可读取的真实 CV。"}`}
                      </p>
                    </div>
                    <button className="secondary-button" onClick={focusApplicationInput}>
                      补全申请资料
                    </button>
                  </article>
                )}

                <div className="application-material-windows">
                  {([
                    {
                      id: "outreach_email" as const,
                      index: "02A",
                      kicker: "ADVISOR OUTREACH",
                      title: "陶瓷信",
                      description: "生成简洁、具体、可直接复制的联系邮件，并保留事实桥与引用审计。",
                      deliverables: ["邮件正文", "联系规则核验", "证据与引用审计"],
                    },
                    {
                      id: "research_proposal" as const,
                      index: "02B",
                      kicker: "RESEARCH PROPOSAL",
                      title: "Research Proposal",
                      description: "先核对项目格式，再完成文献综述、研究问题、方法与可行性论证。",
                      deliverables: ["LaTeX 与 BibTeX", "可提交版 PDF", "文献与格式审计"],
                    },
                  ]).map((material) => {
                    const artifact = materialArtifacts?.[material.id];
                    const ready = modeReadiness(material.id);
                    const includedInConfirmedSnapshot = Boolean(
                      confirmedMaterialsMatchDraft &&
                        confirmedMaterials?.advisorProgramId === materialAdvisorId &&
                        confirmedMaterials.materials.includes(material.id),
                    );
                    const waitingForThisConfirmation = Boolean(
                      materialsConfirmOpen && selectedMaterials.has(material.id),
                    );
                    const status = artifact?.complete
                      ? "已完成"
                      : includedInConfirmedSnapshot && ready.ready
                        ? "可以生成"
                        : waitingForThisConfirmation
                          ? "等待确认"
                          : "尚未生成";
                    return (
                      <article
                        className={`panel application-material-window ${artifact?.complete ? "complete" : ""}`}
                        key={material.id}
                      >
                        <header>
                          <span className="target-step">{material.index}</span>
                          <span className={`material-window-status ${artifact?.complete ? "complete" : ""}`}>
                            {status}
                          </span>
                        </header>
                        <div className="material-window-copy">
                          <span className="section-kicker">{material.kicker}</span>
                          <h2>{material.title}</h2>
                          <p>{material.description}</p>
                        </div>
                        <ul className="material-deliverables">
                          {material.deliverables.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        <div className="material-window-readiness">
                          <strong>{artifact?.complete ? "产物已通过本地校验" : "生成条件"}</strong>
                          <small>
                            {artifact?.complete
                              ? "你仍然可以为同一目标重新生成，不影响另一项材料。"
                              : includedInConfirmedSnapshot
                                ? ready.ready
                                  ? "目标和申请者资料已齐全，可以开始。"
                                  : ready.missing.join("；")
                                : "选择此项后会先展示精确目标与生成边界，确认前不会开始写作。"}
                          </small>
                        </div>
                        {artifact?.literature?.length ? (
                          <details className="material-source-details">
                            <summary>查看已核验的 {artifact.literature.length} 条文献</summary>
                            <ul className="material-literature-list">
                              {artifact.literature.map((source) => (
                                <li key={`${material.id}-${source.literatureId}`}>
                                  <span className={`literature-kind ${source.category}`}>
                                    {source.category === "advisor_work" ? "导师/团队" : "独立领域"}
                                  </span>
                                  <a href={source.canonicalUrl} target="_blank" rel="noreferrer">
                                    {source.literatureId} · {source.title}
                                  </a>
                                  <small>
                                    {source.authors.join(", ")}{source.year ? ` (${source.year})` : ""}
                                  </small>
                                  <code>{source.localPath}</code>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        <div className="material-window-actions">
                          {includedInConfirmedSnapshot ? (
                            <button
                              className={artifact?.complete ? "secondary-button" : "primary-button"}
                              disabled={!ready.ready || materialsSaving}
                              onClick={() => startApplicationMaterial(material.id)}
                            >
                              {artifact?.complete ? "为当前目标重新生成" : `开始生成${material.title}`}
                            </button>
                          ) : (
                            <button
                              className="primary-button"
                              disabled={
                                materialsSaving ||
                                !materialAdvisorId ||
                                !applicantIdentityReady
                              }
                              onClick={() => prepareApplicationMaterial(material.id)}
                            >
                              {materialsSaving && selectedMaterials.has(material.id)
                                ? "正在准备…"
                                : `选择生成${material.title}`}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {materialsConfirmOpen && (
                  <article className="materials-confirmation material-page-confirmation" role="status">
                    <div>
                      <span className="section-kicker">FINAL CONFIRMATION</span>
                      <strong>请确认本次只生成这一项材料</strong>
                    </div>
                    <ul>
                      <li>
                        目标：{selectedMaterialAdvisor?.name || "待核实"} · {selectedMaterialAdvisor?.program || selectedMaterialAdvisor?.school} · <code>{materialAdvisorId}</code>
                      </li>
                      <li>
                        本次材料：{materialOrderList[0] === "research_proposal" ? "Research Proposal" : "陶瓷信"}
                      </li>
                      <li>两类文献：导师本人/团队 + 独立领域；只保存合法公开 PDF 和完整来源记录</li>
                      <li>不会发送邮件、不会提交 RP、不会改变另一项已经生成的材料</li>
                    </ul>
                    <div className="materials-actions">
                      <button onClick={() => setMaterialsConfirmOpen(false)}>返回修改</button>
                      <button
                        className="primary-button"
                        disabled={materialsSaving}
                        onClick={confirmApplicationMaterials}
                      >
                        {materialsSaving ? "正在确认…" : "确认目标与本次材料"}
                      </button>
                    </div>
                  </article>
                )}

                <aside className="materials-policy-note">
                  <strong>统一生成边界</strong>
                  <p>
                    两项材料都复用项目最初上传的真实 CV；只绑定当前明确选择的导师—项目组合。
                    文献必须区分导师/团队作品与独立领域作品，合法公开版本及校验信息保存在本地。
                  </p>
                  {confirmedMaterialsMatchDraft && confirmedMaterials && (
                    <code>
                      {activeProject?.path}/outputs/application-materials/{confirmedMaterials.advisorProgramId}
                    </code>
                  )}
                </aside>
              </>
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
            <div className="runner-scroll-body">
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
                  className={`runtime-refresh-button ${runtimeRefreshing ? "refreshing" : ""}`}
                  disabled={runtimeRefreshing}
                  aria-busy={runtimeRefreshing}
                  onClick={() => void refreshRuntimeStatus(true)}
                >
                  <span aria-hidden="true">↻</span>
                  {runtimeRefreshing ? "正在刷新…" : "刷新状态"}
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
                    <span>
                      适合已经拥有 API 地址、Key 和模型名称的用户。任务由项目随附的
                      Codex 本地运行引擎执行，不要求登录 Codex。
                    </span>
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
              {!modeReadiness(runnerMode).ready && (
                <button
                  className="runner-input-blocker"
                  type="button"
                  onClick={() => {
                    setRunnerOpen(false);
                    window.setTimeout(focusApplicationInput, 100);
                  }}
                >
                  <strong>
                    {runnerContent.title}还缺 {modeReadiness(runnerMode).missing.length} 项前置条件
                  </strong>
                  <span>{modeReadiness(runnerMode).missing.join("、")}</span>
                  <b>返回处理 →</b>
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
                            : runState === "partial"
                              ? "已结束 · 缺少产物"
                              : runState === "needs_input"
                                ? "等待补充资料"
                                : runState === "cancelled"
                                  ? "已取消"
                                  : runState === "interrupted"
                                    ? "已中断"
                                    : "运行失败"}
                </span>
              </div>
              {runState === "partial" && missingArtifacts.length > 0 && (
                <div className="run-partial-warning" role="status">
                  <strong>本轮已结束，但尚未产生{runModeArtifactLabel(runnerMode)}</strong>
                  <ul>
                    {missingArtifacts.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <span>可以补充资料后再跑一轮；已经写入 outputs/ 的部分不会被覆盖。</span>
                </div>
              )}
              {requestedInput && (
                <div className="run-input-request" role="form">
                  <strong>Agent 需要你补充资料后才能继续</strong>
                  {requestedInput.reason && <p>{requestedInput.reason}</p>}
                  {requestedInput.fields.map((field) => (
                    <label key={field.id} className="run-input-field">
                      <span>
                        {field.label || runInputFieldLabels[field.id] || field.id}
                        {field.required ? " *" : ""}
                      </span>
                      {field.id === "cv" ? (
                        <>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.txt,.md"
                            disabled={inputSaving || uploadState === "uploading"}
                            onChange={(event) =>
                              void uploadCv(event.target.files?.[0])
                            }
                          />
                          <small>
                            {inputAnswers.cv
                              ? `${fileName} · 已保存，可继续原任务`
                              : uploadState === "uploading"
                                ? "正在保存 CV…"
                                : "请选择一份新的真实 CV；原 Agent 会话会保留"}
                          </small>
                        </>
                      ) : (
                        <input
                          value={inputAnswers[field.id] || ""}
                          placeholder={field.hint || ""}
                          onChange={(event) =>
                            setInputAnswers((current) => ({
                              ...current,
                              [field.id]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </label>
                  ))}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={inputSaving}
                    onClick={() => void submitRequestedInput()}
                  >
                    {inputSaving ? "正在保存并继续…" : "保存并继续本轮"}
                  </button>
                </div>
              )}
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
              {technicalEvents.length > 0 && (
                <div className="technical-log">
                  <button
                    type="button"
                    className="advanced-toggle"
                    onClick={() => setTechnicalOpen((current) => !current)}
                  >
                    {technicalOpen
                      ? "收起技术细节"
                      : `技术细节（${technicalEvents.length} 条）`}
                  </button>
                  {technicalOpen && (
                    <pre>
                      {technicalEvents
                        .map((event) =>
                          event.message ||
                          (typeof event.raw === "string"
                            ? event.raw
                            : JSON.stringify(event.raw ?? event)),
                        )
                        .join("\n")
                        .slice(-8000)}
                    </pre>
                  )}
                </div>
              )}
              {runOutputDirectory && advancedOpen && (
                <div className="output-path">
                  <span>输出目录</span>
                  <code>{runOutputDirectory}</code>
                </div>
              )}
            </section>
            </div>

            <footer className="runner-footer">
              <span>{currentProviderHealth?.loggedIn ? `将使用 ${provider}` : "请选择可用模型"}</span>
              <div>
                {(["running", "starting", "waiting_permission"] as RunState[]).includes(
                  runState,
                ) && (
                  <button className="stop-button" onClick={cancelRun} disabled={!runId}>
                    取消任务
                  </button>
                )}
                <button
                  className="primary-button runner-start"
                  onClick={() => runAgent()}
                  disabled={
                    runState === "running" ||
                    runState === "starting" ||
                    runState === "waiting_permission" ||
                    !currentProviderHealth?.installed ||
                    !currentProviderHealth.loggedIn ||
                    !activeProjectId ||
                    !modeReadiness(runnerMode).ready ||
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
                  <span>Phase 1 需要目标范围和真实 CV；申请者姓名在生成 RP 或套磁信前必填，学位和申请季在客观筛选前补齐。</span>
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

      {deleteProjectTarget && (
        <div
          className="project-modal-layer"
          role="dialog"
          aria-modal="true"
          aria-label="彻底删除本地项目"
        >
          <button
            className="runner-backdrop"
            aria-label="取消删除"
            onClick={() => !deleteProjectBusy && setDeleteProjectTarget(null)}
          />
          <section className="project-modal delete-project-modal">
            <header>
              <div>
                <span className="section-kicker danger-kicker">PERMANENT DELETE</span>
                <h2>彻底删除本地项目？</h2>
                <p>项目资料、CV、运行记录和所有结果都会从本机删除，无法恢复。</p>
              </div>
              <button
                onClick={() => setDeleteProjectTarget(null)}
                aria-label="关闭"
                disabled={deleteProjectBusy}
              >
                ×
              </button>
            </header>
            <div className="project-form delete-project-form">
              <div className="delete-project-summary">
                <strong>{deleteProjectTarget.name}</strong>
                <span>{deleteProjectTarget.path}</span>
              </div>
              <label>
                <span>输入项目名称以确认</span>
                <input
                  value={deleteProjectConfirmation}
                  onChange={(event) => setDeleteProjectConfirmation(event.target.value)}
                  placeholder={deleteProjectTarget.name}
                  autoFocus
                />
                <small>如果只是不想在侧栏看到它，请取消并选择“从列表隐藏”。</small>
              </label>
            </div>
            <footer>
              <button
                className="secondary-button"
                onClick={() => setDeleteProjectTarget(null)}
                disabled={deleteProjectBusy}
              >
                取消
              </button>
              <button
                className="danger-button"
                onClick={permanentlyDeleteProject}
                disabled={
                  deleteProjectBusy ||
                  deleteProjectConfirmation !== deleteProjectTarget.name
                }
              >
                {deleteProjectBusy ? "正在删除…" : "彻底删除本地文件"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
