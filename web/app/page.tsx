"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Provider = "Claude Code" | "Codex" | "Custom API";
type View = "overview" | "candidates" | "evidence" | "ranking";
type RunState = "idle" | "starting" | "running" | "completed" | "failed" | "stopped";

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
  phase: "intake" | "finder" | "detective" | "evaluator" | "completed";
  candidateCount: number;
  highMatchCount: number;
  evidenceCount: number;
  evidenceCoverage: number;
  rankingCount: number;
  updatedAt: string | null;
};

type ProjectReadiness = {
  ready: boolean;
  completed: number;
  total: number;
  checks: Array<{ key: string; label: string; complete: boolean }>;
  missing: string[];
  interestWeightTotal: number;
};

type AdvisorProject = {
  id: string;
  slug: string;
  name: string;
  season: string;
  degree: string;
  target: string;
  interests: Array<{ name: string; weight: number }>;
  updatedAt: string;
  path: string;
  status: ProjectStatus;
  candidates: AdvisorCandidate[];
  cv: {
    name: string;
    path: string;
    size: number;
    type: string;
    uploadedAt: string;
  } | null;
  readiness: ProjectReadiness;
};

type AdvisorCandidate = {
  rank: number;
  initials: string;
  name: string;
  school: string;
  fit: number;
  status: string;
  statusTone: string;
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
};

const runtimeUrl = "http://127.0.0.1:4318";
const providerKey: Record<Provider, keyof RuntimeHealth["providers"]> = {
  Codex: "codex",
  "Claude Code": "claude",
  "Custom API": "custom",
};

const defaultTask = `请完整读取 skills/advisor-pipeline/SKILL.md，并从 Phase 1 开始导师匹配。

先检查以下必要输入是否齐全：
1. 真实 CV 文件
2. 目标学校或目标范围
3. 研究兴趣及权重
4. 目标学位和申请季

如果缺少任何输入，请只列出缺失项并停止等待，不要编造信息。
如果输入齐全，严格按照 skill 执行，并保留每条关键结论的来源。`;

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
    interests: Array<{ name: string; weight: string }>;
  }>({
    season: "",
    degree: "",
    target: "",
    interests: [{ name: "", weight: "" }],
  });
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeDirty, setIntakeDirty] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState(defaultTask);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runId, setRunId] = useState("");
  const [runOutputDirectory, setRunOutputDirectory] = useState("");
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
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
  const intakeRef = useRef<HTMLElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

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

  const activeProject = projects.find((item) => item.id === activeProjectId) || null;
  const candidates = activeProject?.candidates || [];
  const projectStatus: ProjectStatus = activeProject?.status || {
    phase: "intake",
    candidateCount: 0,
    highMatchCount: 0,
    evidenceCount: 0,
    evidenceCoverage: 0,
    rankingCount: 0,
    updatedAt: null,
  };
  const projectReadiness: ProjectReadiness = activeProject?.readiness || {
    ready: false,
    completed: 0,
    total: 5,
    checks: [],
    missing: ["上传真实 CV", "填写目标学位", "填写申请季", "填写目标院校或地区范围", "填写研究兴趣"],
    interestWeightTotal: 0,
  };
  const draftInterestTotal = applicationDraft.interests.reduce(
    (sum, interest) => sum + (Number(interest.weight) || 0),
    0,
  );
  const draftInterestReady =
    applicationDraft.interests.some(
      (interest) => interest.name.trim() && Number(interest.weight) > 0,
    ) && Math.abs(draftInterestTotal - 100) < 0.01;
  const draftCompleted = [
    Boolean(filePath),
    Boolean(applicationDraft.degree.trim()),
    Boolean(applicationDraft.season.trim()),
    Boolean(applicationDraft.target.trim()),
    draftInterestReady,
  ].filter(Boolean).length;
  const draftMissing = [
    !filePath ? "上传真实 CV" : "",
    !applicationDraft.degree.trim() ? "填写目标学位" : "",
    !applicationDraft.season.trim() ? "填写申请季" : "",
    !applicationDraft.target.trim() ? "填写目标院校或地区范围" : "",
    !draftInterestReady ? "填写研究兴趣，并让权重合计为 100%" : "",
  ].filter(Boolean);

  useEffect(() => {
    if (!activeProject) return;
    setApplicationDraft({
      season: activeProject.season || "",
      degree: activeProject.degree || "",
      target: activeProject.target || "",
      interests: activeProject.interests?.length
        ? activeProject.interests.map((interest) => ({
            name: interest.name,
            weight: String(interest.weight),
          }))
        : [{ name: "", weight: "" }],
    });
    setFileName(activeProject.cv?.name || "尚未上传真实 CV");
    setFilePath(activeProject.cv?.path || "");
    setUploadState(activeProject.cv?.path ? "ready" : "idle");
    setIntakeDirty(false);
  }, [activeProjectId, activeProject?.updatedAt]);
  const steps = [
    {
      number: "01",
      title: "发现候选导师",
      detail: "解析 CV、构建院系名册、完成研究方向匹配",
      meta:
        projectStatus.candidateCount > 0
          ? `已找到 ${projectStatus.candidateCount} 位真实候选`
          : projectReadiness.ready
            ? "资料已齐全，可以启动"
            : `请先完成申请资料 ${projectReadiness.completed}/${projectReadiness.total}`,
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
        projectStatus.evidenceCount > 0
          ? `已记录 ${projectStatus.evidenceCount} 条证据`
          : projectStatus.candidateCount > 0
            ? "等待选择调查对象"
            : "等待导师搜索",
      state:
        projectStatus.phase === "detective"
          ? "current"
          : ["evaluator", "completed"].includes(projectStatus.phase)
            ? "done"
            : "waiting",
    },
    {
      number: "03",
      title: "综合评分与决策",
      detail: "透明权重、风险提示与个性化套磁切入点",
      meta: projectStatus.rankingCount > 0 ? `已生成 ${projectStatus.rankingCount} 位排名` : "尚未开始",
      state:
        projectStatus.phase === "evaluator"
          ? "current"
          : projectStatus.phase === "completed"
            ? "done"
            : "waiting",
    },
  ];

  const filtered = useMemo(
    () =>
      candidates.filter((candidate) =>
        `${candidate.name} ${candidate.school} ${candidate.directions.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) && (!highFitOnly || candidate.fit >= 8),
      ),
    [candidates, highFitOnly, query],
  );

  function toggleCandidate(name: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function exportCandidates() {
    if (!candidates.length) {
      showNotice("还没有候选导师可以导出");
      return;
    }
    const header = ["排名", "导师", "院校", "研究方向", "招生状态", "证据数", "匹配分"];
    const rows = candidates.map((candidate) => [
      candidate.rank,
      candidate.name,
      candidate.school,
      candidate.directions.join(" / "),
      candidate.status,
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

  function openRunner(prompt?: string) {
    if (prompt) setTaskPrompt(prompt);
    setAdvancedOpen(false);
    setRunnerOpen(true);
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
        payload.project.readiness.ready
          ? "申请资料已齐全，现在可以开始寻找导师"
          : `资料已保存，还需完成：${payload.project.readiness.missing.join("、")}`,
      );
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "申请资料保存失败");
    } finally {
      setIntakeSaving(false);
    }
  }

  function startPhaseOne() {
    if (!projectReadiness.ready) {
      focusApplicationInput();
      return;
    }
    openRunner(defaultTask);
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
      setTaskPrompt(
        `${defaultTask}\n\n本次真实 CV 文件路径：${payload.path}\n申请目标：${activeProject?.target || "待确认"}\n目标学位：${activeProject?.degree || "待确认"} · ${activeProject?.season || "待确认"}\n研究兴趣权重：${
          activeProject?.interests?.length
            ? activeProject.interests
                .map((interest) => `${interest.name} ${interest.weight}%`)
                .join("，")
            : "待确认"
        }。`,
      );
      showNotice("CV 已保存到当前申请项目");
    } catch (error) {
      setUploadState("failed");
      showNotice(error instanceof Error ? error.message : "CV 本地保存失败");
    }
  }

  async function runAgent() {
    const health = selectedProviderHealth();
    if (!projectReadiness.ready) {
      setRunnerOpen(false);
      focusApplicationInput();
      return;
    }
    if (!health?.installed || !health.loggedIn || !activeProjectId) return;

    setRunState("starting");
    setRunEvents([]);
    setRunId("");
    setRunOutputDirectory("");

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
          if (event.runId) setRunId(event.runId);
          if (event.outputDirectory) setRunOutputDirectory(event.outputDirectory);
          if (event.message) {
            setRunEvents((current) => [...current.slice(-399), event]);
          }
          if (event.type === "run.finished") {
            setRunState((event.status as RunState) || "completed");
            await refreshProjects(activeProjectId);
            if (event.status === "completed") {
              setView("candidates");
              showNotice("导师搜索已完成，候选名单已更新");
            }
          }
        }
      }
    } catch (error) {
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
    if (!runId) return;
    await fetch(`${runtimeUrl}/api/runs/${runId}/stop`, { method: "POST" });
    setRunState("stopped");
  }

  function startInvestigation() {
    if (projectStatus.candidateCount === 0) {
      showNotice("还没有候选导师，请先完成导师搜索");
      return;
    }
    openRunner(`请完整读取 skills/advisor-detective/SKILL.md，准备开始 Phase 2 深度背调。

只允许从本地已有的 ADVISOR_STATE.md 或最新 Phase 1 输出中读取真实导师名单。
如果没有真实的 Phase 1 状态文件，请明确说明并停止；绝对不要使用界面中的演示导师姓名。
需要背调的人数：${selected.size}。
在正式搜索前，先按照 skill 展示调查深度、范围与消耗确认。`);
  }

  function startRanking() {
    if (projectStatus.evidenceCount === 0) {
      showNotice("请先完成候选导师背调");
      return;
    }
    openRunner(`请完整读取 skills/advisor-evaluator/SKILL.md，使用当前项目已有的真实候选导师和背调证据生成最终排名。

必须保留评分依据、权重、风险提示和证据来源。缺少必要证据时明确指出，不得用推测补齐。`);
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
            <em>{projectStatus.candidateCount}</em>
          </button>
          <button
            className={view === "evidence" ? "active" : ""}
            onClick={() => openProjectView("evidence")}
          >
            <span className="nav-icon">◫</span> 背调证据
            <em>{projectStatus.evidenceCount}</em>
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
              onClick={projectReadiness.ready ? startPhaseOne : focusApplicationInput}
            >
              <span className={runtimeHealth ? "runtime-online" : "runtime-offline"} />
              {projectReadiness.ready
                ? "开始寻找导师"
                : `完成申请资料 ${projectReadiness.completed}/${projectReadiness.total}`}
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
                {projectStatus.candidateCount > 0
                  ? "离理想导师，更近一步。"
                  : "从一份真实 CV 开始。"}
              </h1>
              <p>
                {projectStatus.candidateCount > 0
                  ? "候选导师发现已完成。选择重点对象，开始证据可追溯的深度背调。"
                  : projectReadiness.ready
                    ? "申请资料已齐全。选择执行引擎后，即可开始寻找与你真正匹配的导师。"
                    : `先完成申请资料（${projectReadiness.completed}/${projectReadiness.total}），再开始寻找导师。`}
              </p>
            </div>
            <div className="hero-side">
              <span>当前引擎</span>
              <button
                className="provider-pill"
                onClick={projectReadiness.ready ? () => openRunner() : focusApplicationInput}
              >
                <i
                  className={
                    currentProviderHealth?.loggedIn ? "provider-connected" : "provider-disconnected"
                  }
                />
                {currentProviderHealth?.loggedIn ? provider : "选择模型"}
                <b>⌄</b>
              </button>
            </div>
          </section>

          <section className="stats-grid" hidden={view !== "overview"}>
            <article className="stat-card primary-stat">
              <div className="stat-top">
                <span>候选导师</span>
                <i>本轮</i>
              </div>
              <div className="stat-value">
                {projectStatus.candidateCount} <small>位</small>
              </div>
              <div className="stat-foot">
                <span>
                  {projectStatus.candidateCount > 0 ? "真实候选结果" : "尚未开始导师搜索"}
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
                {projectStatus.highMatchCount} <small>位</small>
              </div>
              <div className="stat-foot">
                <span className="positive-text">
                  {projectStatus.highMatchCount > 0 ? "匹配分 ≥ 8.0" : "等待真实评分"}
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
                        if (health?.installed && health.loggedIn) {
                          setProvider(item);
                        } else if (item === "Custom API" && projectReadiness.ready) {
                          setProvider(item);
                          openRunner();
                        } else if (!projectReadiness.ready) {
                          focusApplicationInput();
                        } else {
                          chooseProvider(item);
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
                        if (step.number === "01" && !projectReadiness.ready) {
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
              className={`panel intake-panel ${projectReadiness.ready ? "intake-ready" : ""}`}
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
                系统只会根据你提供的真实信息寻找导师。下列 5 项全部完成后，才会开放导师搜索。
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
                    1. 上传真实 CV <em>必填</em>
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
                    <span>2. 目标学位 <em>必填</em></span>
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
                    <span>3. 申请季 <em>必填</em></span>
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
                    <span>5. 研究兴趣与权重 <em>必填</em></span>
                    <small className={Math.abs(draftInterestTotal - 100) < 0.01 ? "valid" : ""}>
                      合计 {draftInterestTotal || 0}% / 100%
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
                          placeholder="权重"
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
                <button
                  className="save-intake"
                  type="button"
                  onClick={saveApplicationProfile}
                  disabled={intakeSaving}
                >
                  {intakeSaving
                    ? "正在保存…"
                    : projectReadiness.ready
                      ? "更新申请资料"
                      : "保存申请资料"}
                </button>
                <div className={`intake-status ${projectReadiness.ready ? "complete" : ""}`}>
                  <span>{projectReadiness.ready ? "✓" : "!"}</span>
                  <p>
                    <strong>
                      {projectReadiness.ready
                        ? "资料已齐全，可以开始寻找导师"
                        : "填写完成后才能启动导师搜索"}
                    </strong>
                    <small>
                      {projectReadiness.ready
                        ? "导师搜索已解锁"
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
                <p>基于研究方向、近期论文和招生状态生成的匹配结果</p>
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
                    <th>研究方向</th>
                    <th>招生状态</th>
                    <th>证据</th>
                    <th>匹配分</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-candidates">
                          <span>00</span>
                          <strong>还没有真实候选导师</strong>
                          <p>
                            {projectReadiness.ready
                              ? "资料已经齐全，现在可以开始寻找导师。"
                              : "请先上传 CV，并填写申请季、目标范围和研究兴趣。"}
                          </p>
                          <button onClick={startPhaseOne}>
                            {projectReadiness.ready ? "开始寻找导师" : "先完成申请资料"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((candidate) => (
                      <tr key={candidate.name}>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${candidate.name}`}
                          checked={selected.has(candidate.name)}
                          onChange={() => toggleCandidate(candidate.name)}
                        />
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
                  onClick={startInvestigation}
                >
                  开始深度背调 <span>→</span>
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
              <button
                className="primary-button"
                disabled={!selected.size}
                onClick={startInvestigation}
              >
                开始背调
              </button>
            </header>
            <article className="panel honest-empty">
              <span>{projectStatus.evidenceCount || "00"}</span>
              <h2>
                {projectStatus.candidateCount === 0
                  ? "先获得候选导师"
                  : selected.size === 0
                    ? "先选择需要调查的导师"
                    : "尚未开始深度背调"}
              </h2>
              <p>
                {projectStatus.candidateCount === 0
                  ? "完成导师搜索后，候选名单会出现在这里。"
                  : selected.size === 0
                    ? "前往候选导师页面勾选重点对象，再开始证据可追溯的背景调查。"
                    : `已选择 ${selected.size} 位导师，可以开始调查。`}
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
          </section>

          <section className="result-view" hidden={view !== "ranking"}>
            <header className="view-header">
              <div>
                <span className="section-kicker">FINAL DECISION</span>
                <h1>最终排名</h1>
                <p>综合研究匹配、招生状态、证据完整度和风险因素生成透明排名。</p>
              </div>
              <button
                className="primary-button"
                disabled={projectStatus.evidenceCount === 0}
                onClick={startRanking}
              >
                生成最终排名
              </button>
            </header>
            <article className="panel honest-empty">
              <span>{projectStatus.rankingCount || "00"}</span>
              <h2>
                {projectStatus.evidenceCount === 0
                  ? "还没有足够的背调证据"
                  : "等待生成最终排名"}
              </h2>
              <p>
                {projectStatus.evidenceCount === 0
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
          </section>
        </div>
      </section>

      {runnerOpen && (
        <div className="runner-layer" role="dialog" aria-modal="true" aria-label="开始寻找导师">
          <button
            className="runner-backdrop"
            aria-label="关闭寻找导师面板"
            onClick={closeRunner}
          />
          <aside className="runner-drawer">
            <header className="runner-header">
              <div>
                <span className="section-kicker">START MATCHING</span>
                <h2>开始寻找导师</h2>
                <p>选择你要使用的模型，系统会根据当前项目资料执行导师搜索。</p>
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
                {filePath && <span className="attached-file">CV 已准备</span>}
              </div>
              <ul className="run-summary-list">
                <li>读取当前项目的 CV 和申请目标</li>
                <li>查找与你研究方向匹配的真实导师</li>
                <li>保存候选名单、匹配依据和来源</li>
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
                    disabled={runState === "running" || runState === "starting"}
                  />
                  <small>项目目录：{activeProject?.path || projectsRoot}</small>
                </div>
              )}
              {!projectReadiness.ready && (
                <button
                  className="runner-input-blocker"
                  type="button"
                  onClick={() => {
                    setRunnerOpen(false);
                    window.setTimeout(focusApplicationInput, 100);
                  }}
                >
                  <strong>开始前还缺 {projectReadiness.missing.length} 项申请资料</strong>
                  <span>{projectReadiness.missing.join("、")}</span>
                  <b>返回填写 →</b>
                </button>
              )}
              <p className="safety-note">
                资料保存在本地；运行时由你选择的模型服务处理本次任务。
              </p>
            </section>

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
                        : runState === "completed"
                          ? "已完成"
                          : runState === "stopped"
                            ? "已停止"
                            : "运行失败"}
                </span>
              </div>
              <div className={`agent-log ${runEvents.length ? "" : "empty"}`}>
                {runEvents.length === 0 ? (
                  <div>
                    <span>›_</span>
                    <strong>开始后，进度会实时显示在这里</strong>
                    <small>完成后会自动更新候选导师页面。</small>
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
                {(runState === "running" || runState === "starting") && (
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
                    !currentProviderHealth?.installed ||
                    !currentProviderHealth.loggedIn ||
                    !activeProjectId ||
                    !projectReadiness.ready ||
                    !taskPrompt.trim()
                  }
                >
                  {runState === "running" || runState === "starting"
                    ? "正在寻找导师"
                    : "开始寻找导师"}
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
                <p>按顺序完成资料、模型选择和导师搜索即可。</p>
              </div>
              <button onClick={() => setHelpOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>
            <div className="help-content">
              <ol>
                <li>
                  <strong>准备申请资料</strong>
                  <span>上传最新 CV，填写申请季、目标院校范围和研究兴趣权重。</span>
                </li>
                <li>
                  <strong>选择模型</strong>
                  <span>已有 Codex 或 Claude 订阅可直接使用；自定义 API 放在高级选项中。</span>
                </li>
                <li>
                  <strong>开始寻找导师</strong>
                  <span>系统会查找真实导师，记录研究匹配、招生状态和来源。</span>
                </li>
                <li>
                  <strong>选择重点对象</strong>
                  <span>在候选导师页面勾选对象，再进入深度背调和最终排名。</span>
                </li>
              </ol>
              <div className="help-note">
                <strong>运行前需要知道</strong>
                <p>任务需要联网，耗时取决于搜索范围。使用自定义 API 时可能产生服务商费用。</p>
              </div>
            </div>
            <footer>
              <button
                className="primary-button"
                onClick={() => {
                  setHelpOpen(false);
                  if (projectReadiness.ready) startPhaseOne();
                  else window.setTimeout(focusApplicationInput, 100);
                }}
              >
                {projectReadiness.ready ? "开始寻找导师" : "去填写申请资料"}
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
