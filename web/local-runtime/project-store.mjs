import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

const defaultProjectInput = {
  name: "我的申请项目",
  slug: "new-application",
  season: "",
  degree: "",
  target: "",
  interests: [],
  shortlistTarget: 10,
};

export const DEFAULT_DETECTIVE_SECTIONS = [
  "identity_current_role",
  "recent_research",
  "current_projects_recruiting",
];

export const DETECTIVE_SECTIONS = [
  ...DEFAULT_DETECTIVE_SECTIONS,
  "research_output_trend",
  "group_members_outcomes",
  "guidance_group_ecology",
  "work_style_pressure",
  "resources_career_support",
  "integrity_public_controversies",
  "international_student_support",
  "collaboration_industry_network",
];

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
      return {
        schemaVersion: 2,
        stage: status.phase === "intake" ? "intake" : "discovery",
        shortlistCount: Number(status.highMatchCount || 0),
        objectiveReadyCount: 0,
        selectedCount: 0,
        ...status,
      };
    } catch {
      return {
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

  function normalizeInterests(input) {
    if (!Array.isArray(input)) return [];
    const interests = input
      .map((interest) => ({
        name: String(interest?.name || "").trim().slice(0, 120),
        weight: Number(interest?.weight),
      }))
      .filter((interest) => interest.name);
    if (!interests.length) return [];

    const explicitTotal = interests.reduce(
      (sum, interest) =>
        sum + (Number.isFinite(interest.weight) && interest.weight > 0 ? interest.weight : 0),
      0,
    );
    const missingCount = interests.filter(
      (interest) => !Number.isFinite(interest.weight) || interest.weight <= 0,
    ).length;
    const explicitCount = interests.length - missingCount;
    const fallbackWeight =
      explicitTotal > 0 && explicitTotal < 100 && missingCount > 0
        ? (100 - explicitTotal) / missingCount
        : explicitTotal > 0 && explicitCount > 0
          ? explicitTotal / explicitCount
          : 1;
    const basis = interests.map((interest) => ({
      ...interest,
      weight:
        Number.isFinite(interest.weight) && interest.weight > 0
          ? interest.weight
          : fallbackWeight,
    }));
    const basisTotal = basis.reduce((sum, interest) => sum + interest.weight, 0);
    return basis.map((interest, index) => ({
      name: interest.name,
      weight:
        index === basis.length - 1
          ? Math.round(
              (100 -
                basis
                  .slice(0, -1)
                  .reduce(
                    (sum, item) =>
                      sum + Math.round((item.weight / basisTotal) * 1000) / 10,
                    0,
                  )) *
                10,
            ) / 10
          : Math.round((interest.weight / basisTotal) * 1000) / 10,
    }));
  }

  function normalizeShortlistTarget(value, fallback = 10) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(5, Math.min(50, Math.round(parsed)));
  }

  function normalizeSectionList(input, allowed, fallback = []) {
    if (!Array.isArray(input)) return [...fallback];
    return [...new Set(input.map(String).filter((item) => allowed.includes(item)))];
  }

  function normalizeInvestigation(input, existing = {}) {
    const selectedIds = Array.isArray(input?.selectedAdvisorProgramIds)
      ? input.selectedAdvisorProgramIds
      : existing.selectedAdvisorProgramIds;
    const consented = Boolean(
      input?.communitySources?.consented ??
        existing.communitySources?.consented ??
        false,
    );
    return {
      selectedAdvisorProgramIds: [
        ...new Set((selectedIds || []).map(String).filter(Boolean)),
      ].slice(0, 30),
      selectedSections: normalizeSectionList(
        input?.selectedSections ?? existing.selectedSections,
        DETECTIVE_SECTIONS,
        DEFAULT_DETECTIVE_SECTIONS,
      ),
      communitySources: {
        consented,
        refreshRequested: Boolean(
          input?.communitySources?.refreshRequested ??
            existing.communitySources?.refreshRequested ??
            false,
        ),
        consentedAt: consented
          ? input?.communitySources?.consentedAt ||
            existing.communitySources?.consentedAt ||
            new Date().toISOString()
          : null,
      },
    };
  }

  function normalizeMetadata(metadata) {
    const upgradingFromFinderSelections = Number(metadata.schemaVersion || 0) < 3;
    return {
      ...metadata,
      schemaVersion: 3,
      shortlistTarget: normalizeShortlistTarget(metadata.shortlistTarget),
      investigation: normalizeInvestigation(
        upgradingFromFinderSelections &&
          !(metadata.investigation?.selectedSections || []).length
          ? {
              ...metadata.investigation,
              selectedSections: DEFAULT_DETECTIVE_SECTIONS,
            }
          : metadata.investigation,
        metadata.investigation,
      ),
    };
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
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(resolve(target, "project.json"), "utf8")),
    );
    return {
      ...metadata,
      path: target,
      status: await readStatus(target),
      candidates: await readCandidates(target),
      detectiveResults: await readDetectiveResults(target),
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
    const metadata = {
      schemaVersion: 3,
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
    };
    const status = {
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
      updatedAt: now,
    };

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
    const metadata = normalizeMetadata(JSON.parse(await readFile(projectFile, "utf8")));
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
          : normalizeInvestigation(input.investigation, metadata.investigation),
      schemaVersion: 3,
      updatedAt: new Date().toISOString(),
    };
    if (!updated.name) updated.name = "未命名申请项目";
    await writeFile(projectFile, JSON.stringify(updated, null, 2));
    return getProject(slug);
  }

  async function setProjectCv(slug, cv) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = normalizeMetadata(JSON.parse(await readFile(projectFile, "utf8")));
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
    ensureDefaultProject,
    getProject,
    listProjects,
    normalizeSlug,
    setProjectCv,
    syncProjectSkills,
    updateProject,
  };
}
