import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import {
  DEFAULT_DETECTIVE_SECTIONS,
  DETECTIVE_SECTIONS,
  PROJECT_SCHEMA_VERSION,
  confirmInvestigationDraft,
  createStatus,
  hasCommunitySections,
  normalizeInterests,
  normalizeInvestigation,
  normalizeProjectMetadata,
  normalizeShortlistTarget,
  normalizeStatus,
  updateInvestigationDraft,
  validateInvestigationDraftAgainstCandidates,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";

export { DEFAULT_DETECTIVE_SECTIONS, DETECTIVE_SECTIONS };

const defaultProjectInput = {
  name: "我的申请项目",
  slug: "new-application",
  season: "",
  degree: "",
  target: "",
  interests: [],
  shortlistTarget: 10,
};

const COMMUNITY_CACHE_FILES = new Set([
  "community-blacklist-current.pdf",
  "community-blacklist-current.txt",
  "community-red-flags-current.txt",
  "community-knowledge-metadata.json",
  "community-links.json",
]);

export function createProjectStore(projectRoot) {
  const projectsRoot = resolve(projectRoot, "projects");
  const sourceSkills = resolve(projectRoot, "skills");

  function normalizeSlug(input) {
    const slug = String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!slug || slug.length < 3) {
      throw new Error("项目目录名至少需要 3 个英文字母或数字");
    }
    return slug;
  }

  function generatedSlug() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `application-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
      now.getDate(),
    )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
  }

  function projectPath(slug) {
    const normalized = normalizeSlug(slug);
    const target = resolve(projectsRoot, normalized);
    if (!target.startsWith(`${projectsRoot}${sep}`)) {
      throw new Error("项目目录无效");
    }
    return target;
  }

  async function readStatus(target) {
    try {
      const status = JSON.parse(await readFile(resolve(target, "status.json"), "utf8"));
      return normalizeStatus(status);
    } catch {
      return createStatus();
    }
  }

  async function readCandidates(target) {
    try {
      const parsed = JSON.parse(
        await readFile(resolve(target, "outputs", "candidates.json"), "utf8"),
      );
      if (!Array.isArray(parsed)) return [];
      return parsed.map((candidate, index) => ({
        ...candidate,
        advisorProgramId:
          String(candidate?.advisorProgramId || "").trim() ||
          `legacy-${index + 1}-${String(candidate?.name || "advisor")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")}`,
        program: String(candidate?.program || ""),
        name: String(candidate?.name || ""),
        school: String(candidate?.school || ""),
        initials: String(candidate?.initials || ""),
        rank: Number(candidate?.rank || index + 1),
        fit: Number(candidate?.fit || 0),
        status: String(candidate?.status || "待核实"),
        statusTone: String(candidate?.statusTone || "unknown"),
        directions: Array.isArray(candidate?.directions)
          ? candidate.directions.map(String)
          : [],
        evidence: Math.max(0, Number(candidate?.evidence) || 0),
        feasibility: String(candidate?.feasibility || "needs_confirmation"),
        feasibilityReasons: Array.isArray(candidate?.feasibilityReasons)
          ? candidate.feasibilityReasons.map(String)
          : [],
      }));
    } catch {
      return [];
    }
  }

  async function readDetectiveResults(target) {
    try {
      const parsed = JSON.parse(
        await readFile(resolve(target, "outputs", "detective-results.json"), "utf8"),
      );
      return {
        selectedSections: Array.isArray(parsed?.selectedSections)
          ? parsed.selectedSections.map(String)
          : [],
        communitySources: {
          consented: Boolean(
            parsed?.communitySources?.consented ??
              parsed?.community_sources?.consented,
          ),
        },
        results: Array.isArray(parsed?.results) ? parsed.results : [],
        evidenceCount: Number(parsed?.evidenceCount || 0),
        evidenceCoverage: Number(parsed?.evidenceCoverage || 0),
        generatedAt: parsed?.generatedAt || null,
      };
    } catch {
      return null;
    }
  }

  async function readRankings(target) {
    try {
      const parsed = JSON.parse(
        await readFile(resolve(target, "outputs", "ranking.json"), "utf8"),
      );
      const rankings = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rankings)
          ? parsed.rankings
          : Array.isArray(parsed?.ranking)
            ? parsed.ranking
            : [];
      return rankings.map((item, index) => ({
        ...item,
        rank: Number(item?.rank || index + 1),
        totalScore: Number(item?.totalScore ?? item?.score ?? 0),
        evidenceGaps: Array.isArray(item?.evidenceGaps)
          ? item.evidenceGaps.map(String)
          : [],
      }));
    } catch {
      return [];
    }
  }

  function normalizeMetadata(metadata, fallbackId, legacyDetectiveResults = null) {
    return normalizeProjectMetadata(metadata, {
      fallbackId,
      legacyDetectiveResults,
    });
  }

  function projectReadiness(metadata) {
    const hasCv = Boolean(metadata.cv?.path);
    const hasInterests = Array.isArray(metadata.interests) && metadata.interests.length > 0;
    const checks = [
      { key: "target", label: "填写目标院校或地区范围", complete: Boolean(metadata.target) },
      {
        key: "matching_signal",
        label: "上传 CV 或填写至少一个研究兴趣",
        complete: hasCv || hasInterests,
      },
    ];
    const objectiveChecks = [
      { key: "degree", label: "填写目标学位", complete: Boolean(metadata.degree) },
      { key: "season", label: "填写申请季", complete: Boolean(metadata.season) },
    ];
    return {
      ready: checks.every((item) => item.complete),
      phase1Ready: checks.every((item) => item.complete),
      objectiveReady: objectiveChecks.every((item) => item.complete),
      completed: checks.filter((item) => item.complete).length,
      total: checks.length,
      checks,
      missing: checks.filter((item) => !item.complete).map((item) => item.label),
      objectiveChecks,
      objectiveMissing: objectiveChecks
        .filter((item) => !item.complete)
        .map((item) => item.label),
      matchingSignal: hasCv ? "cv" : hasInterests ? "interests" : "none",
      interestWeightTotal: hasInterests ? 100 : 0,
    };
  }

  async function getProject(slug) {
    const target = projectPath(slug);
    const detectiveResults = await readDetectiveResults(target);
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(resolve(target, "project.json"), "utf8")),
      slug,
      detectiveResults,
    );
    return {
      ...metadata,
      path: target,
      status: await readStatus(target),
      candidates: await readCandidates(target),
      detectiveResults,
      rankings: await readRankings(target),
      readiness: projectReadiness(metadata),
    };
  }

  async function listProjects() {
    await mkdir(projectsRoot, { recursive: true });
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        projects.push(await getProject(entry.name));
      } catch {
        // Ignore folders that are not Advisor Atlas projects.
      }
    }
    return projects.sort((a, b) =>
      String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)),
    );
  }

  async function createProject(input, options = {}) {
    const slug = normalizeSlug(input.slug || generatedSlug());
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");

    try {
      await readFile(projectFile, "utf8");
      if (!options.allowExisting) {
        throw new Error(`项目目录 ${slug} 已存在`);
      }
      return getProject(slug);
    } catch (error) {
      if (error.message?.includes("已存在")) throw error;
    }

    const now = new Date().toISOString();
    const metadata = normalizeProjectMetadata({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: slug,
      slug,
      name: String(input.name || slug).trim(),
      season: String(input.season || "").trim(),
      degree: String(input.degree || "").trim(),
      target: String(input.target || "").trim(),
      interests: normalizeInterests(input.interests),
      shortlistTarget: normalizeShortlistTarget(input.shortlistTarget),
      cv: null,
      investigation: normalizeInvestigation(input.investigation),
      createdAt: now,
      updatedAt: now,
    }, { fallbackId: slug, now });
    const status = createStatus(now);

    await Promise.all([
      mkdir(resolve(target, "inputs"), { recursive: true }),
      mkdir(resolve(target, "outputs"), { recursive: true }),
      mkdir(resolve(target, "runs"), { recursive: true }),
      mkdir(resolve(target, ".agents", "skills"), { recursive: true }),
      mkdir(resolve(target, ".claude", "skills"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(projectFile, JSON.stringify(metadata, null, 2)),
      writeFile(resolve(target, "status.json"), JSON.stringify(status, null, 2)),
      writeFile(resolve(target, "outputs", "candidates.json"), "[]\n"),
      writeFile(resolve(target, "outputs", "advisor_records.json"), "[]\n"),
      writeFile(resolve(target, "outputs", "program_records.json"), "[]\n"),
      writeFile(resolve(target, "outputs", "evidence.json"), "[]\n"),
      writeFile(
        resolve(target, "README.md"),
        `# ${metadata.name}

这是一个独立的 Advisor Atlas 申请项目目录。

- \`inputs/\`：CV 与用户输入
- \`outputs/\`：最终表格和报告；\`candidates.json\` 是前端候选表数据源
- \`runs/\`：每次 Agent 运行记录
- \`.agents/skills/\`：Codex 项目级 Skills
- \`.claude/skills/\`：Claude Code 项目级 Skills

可以通过网页控制台运行，也可以直接在此目录启动 \`codex\` 或 \`claude\`。
`,
      ),
    ]);
    await syncProjectSkills(slug);

    return getProject(slug);
  }

  async function syncProjectSkills(slug) {
    const target = projectPath(slug);
    const copyOptions = {
      recursive: true,
      force: true,
      filter: (source) =>
        basename(source) !== ".DS_Store" &&
        !COMMUNITY_CACHE_FILES.has(basename(source)) &&
        !basename(source).endsWith(".tmp"),
    };
    await Promise.all([
      mkdir(resolve(target, ".agents", "skills"), { recursive: true }),
      mkdir(resolve(target, ".claude", "skills"), { recursive: true }),
    ]);
    await Promise.all([
      cp(sourceSkills, resolve(target, ".agents", "skills"), copyOptions),
      cp(sourceSkills, resolve(target, ".claude", "skills"), copyOptions),
    ]);
  }

  async function updateProject(slug, input) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(projectFile, "utf8")),
      slug,
    );
    const updated = {
      ...metadata,
      name:
        input.name === undefined
          ? metadata.name
          : String(input.name || "").trim().slice(0, 120),
      season:
        input.season === undefined
          ? metadata.season
          : String(input.season || "").trim().slice(0, 80),
      degree:
        input.degree === undefined
          ? metadata.degree
          : String(input.degree || "").trim().slice(0, 80),
      target:
        input.target === undefined
          ? metadata.target
          : String(input.target || "").trim().slice(0, 500),
      shortlistTarget:
        input.shortlistTarget === undefined
          ? metadata.shortlistTarget
          : normalizeShortlistTarget(input.shortlistTarget, metadata.shortlistTarget),
      interests:
        input.interests === undefined
          ? metadata.interests
          : normalizeInterests(input.interests),
      investigation:
        input.investigation === undefined
          ? metadata.investigation
          : updateInvestigationDraft(
              metadata.investigation,
              input.investigation,
            ),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    if (!updated.name) updated.name = "未命名申请项目";
    await writeFile(projectFile, JSON.stringify(updated, null, 2));
    return getProject(slug);
  }

  async function confirmInvestigation(slug, input = {}) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const detectiveResults = await readDetectiveResults(target);
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(projectFile, "utf8")),
      slug,
      detectiveResults,
    );
    if (!Number.isInteger(input.draftRevision)) {
      const error = new Error("缺少有效的调查草稿版本，请重新检查最终摘要");
      error.code = "MISSING_DRAFT_REVISION";
      throw error;
    }
    const candidates = await readCandidates(target);
    const validation = validateInvestigationDraftAgainstCandidates(
      metadata.investigation,
      candidates,
    );
    if (!validation.valid) {
      const error = new Error(validation.errors.join("；"));
      error.code = "INVALID_SELECTION";
      throw error;
    }
    if (
      metadata.investigation.draft.communitySources.requested &&
      !hasCommunitySections(metadata.investigation.draft.selectedSections)
    ) {
      const error = new Error("当前维度不需要社区资料授权");
      error.code = "INVALID_SELECTION";
      throw error;
    }
    const now = new Date().toISOString();
    const updated = {
      ...metadata,
      investigation: confirmInvestigationDraft(metadata.investigation, {
        expectedRevision: input.draftRevision,
        now,
      }),
      updatedAt: now,
    };
    await writeFile(projectFile, JSON.stringify(updated, null, 2));
    return getProject(slug);
  }

  async function setProjectCv(slug, cv) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(projectFile, "utf8")),
      slug,
    );
    const updated = {
      ...metadata,
      cv: {
        name: String(cv.name || "").slice(0, 240),
        path: String(cv.path || ""),
        size: Number(cv.size || 0),
        type: String(cv.type || "application/octet-stream"),
        uploadedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    await writeFile(projectFile, JSON.stringify(updated, null, 2));
    return getProject(slug);
  }

  async function ensureDefaultProject() {
    await mkdir(projectsRoot, { recursive: true });
    const projects = await listProjects();
    if (projects.length) return projects[0];
    return createProject(defaultProjectInput, { allowExisting: true });
  }

  return {
    projectsRoot,
    createProject,
    confirmInvestigation,
    ensureDefaultProject,
    getProject,
    listProjects,
    normalizeSlug,
    setProjectCv,
    syncProjectSkills,
    updateProject,
  };
}
