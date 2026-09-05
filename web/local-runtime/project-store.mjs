import { cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_DETECTIVE_SECTIONS,
  DETECTIVE_SECTIONS,
  PROJECT_SCHEMA_VERSION,
  confirmApplicationMaterialsDraft,
  confirmInvestigationDraft,
  createStatus,
  hasCommunitySections,
  normalizeApplicationPathway,
  normalizeHardConstraintStatus,
  normalizeInterests,
  normalizeOpportunityStatus,
  normalizePortfolioStrategy,
  normalizeApplicationMaterials,
  normalizeInvestigation,
  normalizeProjectMetadata,
  normalizeShortlistTarget,
  normalizeStatus,
  recommendedActionForCandidate,
  readinessForProject,
  updateInvestigationDraft,
  updateApplicationMaterialsDraft,
  validateApplicationMaterialsDraft,
  validateInvestigationDraftAgainstCandidates,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";
import { verifyApplicationMaterialArtifacts } from "../../skills/advisor-pipeline/scripts/application-materials-artifacts.mjs";
import { withProjectFileLock } from "../../skills/advisor-pipeline/scripts/project-file-lock.mjs";

export { DEFAULT_DETECTIVE_SECTIONS, DETECTIVE_SECTIONS };

const defaultProjectInput = {
  name: "我的申请项目",
  slug: "new-application",
  season: "",
  degree: "",
  target: "",
  hardConstraints: "",
  interests: [],
  shortlistTarget: 10,
  portfolioStrategy: "balanced",
};

export const CV_ALLOWED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".txt", ".md"]);
export const CV_MAX_BYTES = Math.max(
  1,
  Number(process.env.ADVISOR_ATLAS_CV_MAX_BYTES) || 20 * 1024 * 1024,
);

export function cvExtension(name) {
  const match = String(name || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

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
  // Every mutation is a read -> modify -> write over the whole project.json.
  // Without this queue two overlapping requests both read the same snapshot and
  // the later write silently drops the earlier one's field.
  const projectLocks = new Map();

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

  function withProjectLock(slug, task) {
    const key = normalizeSlug(slug);
    const previous = projectLocks.get(key) || Promise.resolve();
    const operation = previous.then(
      () => withProjectFileLock(projectPath(key), task),
      () => withProjectFileLock(projectPath(key), task),
    );
    const guard = operation.then(
      () => undefined,
      () => undefined,
    );
    projectLocks.set(key, guard);
    void guard.then(() => {
      if (projectLocks.get(key) === guard) projectLocks.delete(key);
    });
    return operation;
  }

  // Rename is atomic on the same filesystem, so a reader (or a second process
  // such as the CLI) never observes a half-written project.json.
  async function writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
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
      return parsed.map((candidate, index) => {
        const matching = {
          hardConstraintStatus: normalizeHardConstraintStatus(candidate?.hardConstraintStatus),
          hardConstraintReasons: Array.isArray(candidate?.hardConstraintReasons)
            ? candidate.hardConstraintReasons.map(String)
            : [],
          applicationPathway: normalizeApplicationPathway(candidate?.applicationPathway),
          opportunityStatus: normalizeOpportunityStatus(candidate?.opportunityStatus),
        };
        return {
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
        overallMatch:
          candidate?.overallMatch != null && Number.isFinite(Number(candidate.overallMatch))
          ? Math.max(0, Math.min(10, Number(candidate.overallMatch)))
          : null,
        profileMatch:
          candidate?.profileMatch != null && Number.isFinite(Number(candidate.profileMatch))
          ? Math.max(0, Math.min(10, Number(candidate.profileMatch)))
          : null,
        competitiveness: ["reach", "match", "safer", "unknown"].includes(
          String(candidate?.competitiveness),
        )
          ? String(candidate.competitiveness)
          : "unknown",
        matchReasons: Array.isArray(candidate?.matchReasons)
          ? candidate.matchReasons.map(String)
          : [],
        ...matching,
        recommendedAction: recommendedActionForCandidate({ ...candidate, ...matching }),
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
        };
      });
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
      const [parsed, candidates] = await Promise.all([
        readFile(resolve(target, "outputs", "ranking.json"), "utf8").then(JSON.parse),
        readCandidates(target),
      ]);
      const rankings = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rankings)
          ? parsed.rankings
          : Array.isArray(parsed?.ranking)
            ? parsed.ranking
            : [];
      const candidatesById = new Map(
        candidates.map((candidate) => [candidate.advisorProgramId, candidate]),
      );
      return rankings.map((item, index) => {
        const inherited = candidatesById.get(String(item?.advisorProgramId || "")) || {};
        const combined = { ...inherited, ...item };
        const matching = {
          hardConstraintStatus: normalizeHardConstraintStatus(combined.hardConstraintStatus),
          applicationPathway: normalizeApplicationPathway(combined.applicationPathway),
          opportunityStatus: normalizeOpportunityStatus(combined.opportunityStatus),
        };
        const rawTotal = combined.totalScore ?? combined.score;
        return {
        ...combined,
        rank: Number(item?.rank || index + 1),
        totalScore:
          rawTotal !== null && rawTotal !== undefined && rawTotal !== "" && Number.isFinite(Number(rawTotal))
            ? Number(rawTotal)
            : null,
        ...matching,
        recommendedAction: recommendedActionForCandidate({ ...combined, ...matching }),
        evidenceGaps: Array.isArray(item?.evidenceGaps)
          ? item.evidenceGaps.map(String)
          : [],
        };
      });
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

  // `Boolean(cv.path)` kept reporting "已保存" after the file was moved or
  // deleted, so the CV is re-checked on disk every time the project is read.
  function cvAbsolutePath(target, cv) {
    const raw = String(cv?.path || "");
    if (!raw) return null;
    const absolute = resolve(target, raw);
    if (absolute !== target && absolute.startsWith(`${target}${sep}`)) return absolute;

    // Older project copies stored an absolute checkout path. If the whole
    // project folder moved, recover only that path's basename inside this
    // project's own inputs/ directory. Uploaded files carry a UUID prefix, so
    // the stored path basename legitimately differs from the user-facing
    // `cv.name`. This never follows the stale outside path and keeps
    // ZIP/worktree moves portable.
    const storedName = basename(raw);
    if (storedName && CV_ALLOWED_EXTENSIONS.has(cvExtension(storedName))) {
      return resolve(target, "inputs", storedName);
    }
    return null;
  }

  async function inspectCv(target, cv) {
    if (!cv?.path) return { present: false, valid: false, issue: null, absolutePath: null };
    const absolutePath = cvAbsolutePath(target, cv);
    if (!absolutePath) {
      return {
        present: true,
        valid: false,
        issue: "CV 路径不在当前申请项目目录内，请重新上传",
        absolutePath: null,
      };
    }
    const inputsRoot = resolve(target, "inputs");
    if (!absolutePath.startsWith(`${inputsRoot}${sep}`)) {
      return {
        present: true,
        valid: false,
        issue: "CV 不在项目的 inputs/ 目录内，请重新上传",
        absolutePath,
      };
    }
    let stats = null;
    try {
      stats = await stat(absolutePath);
    } catch {
      return {
        present: true,
        valid: false,
        issue: "原 CV 文件已不存在或被移动，请重新上传",
        absolutePath,
      };
    }
    if (!stats.isFile()) {
      return { present: true, valid: false, issue: "CV 路径不是普通文件", absolutePath };
    }
    if (stats.size <= 0) {
      return { present: true, valid: false, issue: "CV 文件内容为空", absolutePath };
    }
    if (stats.size > CV_MAX_BYTES) {
      return {
        present: true,
        valid: false,
        issue: `CV 超过 ${Math.round(CV_MAX_BYTES / (1024 * 1024))} MB 上限`,
        absolutePath,
      };
    }
    if (!CV_ALLOWED_EXTENSIONS.has(cvExtension(cv.name) || cvExtension(absolutePath))) {
      return {
        present: true,
        valid: false,
        issue: "只支持 PDF / DOC / DOCX / TXT / MD 格式的 CV",
        absolutePath,
      };
    }
    return { present: true, valid: true, issue: null, absolutePath, size: stats.size };
  }

  async function getProject(slug) {
    const target = projectPath(slug);
    const detectiveResults = await readDetectiveResults(target);
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(resolve(target, "project.json"), "utf8")),
      slug,
      detectiveResults,
    );
    const candidates = await readCandidates(target);
    const rankings = await readRankings(target);
    const cvStatus = await inspectCv(target, metadata.cv);
    const confirmedMaterials = normalizeApplicationMaterials(
      metadata.applicationMaterials,
    ).confirmed;
    const confirmedMaterialRanking = confirmedMaterials
      ? rankings.find(
          (item) => item.advisorProgramId === confirmedMaterials.advisorProgramId,
        )
      : null;
    const materialArtifacts = confirmedMaterials
      ? Object.fromEntries(
          await Promise.all(
            ["research_proposal", "outreach_email"].map(async (mode) => [
              mode,
              await verifyApplicationMaterialArtifacts({
                projectPath: target,
                mode,
                advisorProgramId: confirmedMaterials.advisorProgramId,
                confirmedRevision: confirmedMaterials.revision,
                confirmedFingerprint: confirmedMaterials.fingerprint,
                expectedAdvisorName: confirmedMaterialRanking?.name || "",
                applicantName: metadata.applicantName,
                cvValid: cvStatus.valid,
              }),
            ]),
          ),
        )
      : {
          research_proposal: { complete: false, missing: [] },
          outreach_email: { complete: false, missing: [] },
        };
    return {
      ...metadata,
      cv: metadata.cv
        ? {
            ...metadata.cv,
            absolutePath: cvStatus.absolutePath,
            valid: cvStatus.valid,
            issue: cvStatus.issue,
          }
        : null,
      path: target,
      status: await readStatus(target),
      candidates,
      detectiveResults,
      rankings,
      materialArtifacts,
      readiness: readinessForProject({
        metadata,
        candidates,
        detectiveResults,
        rankings,
        materialArtifacts,
        cvValid: cvStatus.valid,
      }),
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
      applicantName: String(input.applicantName || "").trim(),
      season: String(input.season || "").trim(),
      degree: String(input.degree || "").trim(),
      target: String(input.target || "").trim(),
      hardConstraints: String(input.hardConstraints || "").trim(),
      interests: normalizeInterests(input.interests),
      shortlistTarget: normalizeShortlistTarget(input.shortlistTarget),
      portfolioStrategy: normalizePortfolioStrategy(input.portfolioStrategy),
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

  async function updateProjectLocked(slug, input) {
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
      applicantName:
        input.applicantName === undefined
          ? metadata.applicantName
          : String(input.applicantName || "").trim().slice(0, 160),
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
      hardConstraints:
        input.hardConstraints === undefined
          ? metadata.hardConstraints
          : String(input.hardConstraints || "").trim().slice(0, 1000),
      shortlistTarget:
        input.shortlistTarget === undefined
          ? metadata.shortlistTarget
          : normalizeShortlistTarget(input.shortlistTarget, metadata.shortlistTarget),
      portfolioStrategy:
        input.portfolioStrategy === undefined
          ? metadata.portfolioStrategy
          : normalizePortfolioStrategy(input.portfolioStrategy, metadata.portfolioStrategy),
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
      applicationMaterials:
        input.applicationMaterials === undefined
          ? metadata.applicationMaterials
          : updateApplicationMaterialsDraft(
              metadata.applicationMaterials,
              input.applicationMaterials,
            ),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    if (!updated.name) updated.name = "未命名申请项目";
    await writeJsonAtomic(projectFile, updated);
    return getProject(slug);
  }

  async function confirmInvestigationLocked(slug, input = {}) {
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
    await writeJsonAtomic(projectFile, updated);
    return getProject(slug);
  }

  async function confirmApplicationMaterialsLocked(slug, input = {}) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(projectFile, "utf8")),
      slug,
    );
    if (!Number.isInteger(input.draftRevision)) {
      const error = new Error("缺少有效的申请材料草稿版本，请重新检查最终摘要");
      error.code = "MISSING_DRAFT_REVISION";
      throw error;
    }
    const rankings = await readRankings(target);
    const validation = validateApplicationMaterialsDraft(
      metadata.applicationMaterials,
      rankings,
    );
    if (!validation.valid) {
      const error = new Error(validation.errors.join("；"));
      error.code = "INVALID_SELECTION";
      throw error;
    }
    const now = new Date().toISOString();
    const updated = {
      ...metadata,
      applicationMaterials: confirmApplicationMaterialsDraft(
        metadata.applicationMaterials,
        { expectedRevision: input.draftRevision, now },
      ),
      updatedAt: now,
    };
    await writeJsonAtomic(projectFile, updated);
    return getProject(slug);
  }

  async function setProjectCvLocked(slug, cv) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = normalizeMetadata(
      JSON.parse(await readFile(projectFile, "utf8")),
      slug,
    );
    const absolutePath = resolve(target, String(cv.path || ""));
    // Projects move between machines, so store the in-project relative path and
    // let readers resolve it against the project directory.
    const relativePath = absolutePath.startsWith(`${target}${sep}`)
      ? absolutePath.slice(target.length + 1).split(sep).join("/")
      : String(cv.path || "");
    const candidate = {
      name: String(cv.name || "").slice(0, 240),
      path: relativePath,
      size: Number(cv.size || 0),
      type: String(cv.type || "application/octet-stream"),
      uploadedAt: new Date().toISOString(),
    };
    const inspection = await inspectCv(target, candidate);
    if (!inspection.valid) {
      const error = new Error(inspection.issue || "CV 文件无法通过校验");
      error.code = "INVALID_CV";
      throw error;
    }
    const updated = {
      ...metadata,
      cv: candidate,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(projectFile, updated);
    return getProject(slug);
  }

  async function deleteProjectLocked(slug) {
    const target = projectPath(slug);
    // Resolve and read the project first so DELETE cannot be used as a generic
    // recursive filesystem endpoint, even if a caller guesses a directory name.
    const project = await getProject(slug);
    await rm(target, { recursive: true, force: false });
    return {
      id: project.id,
      name: project.name,
      path: target,
    };
  }

  const updateProject = (slug, input) =>
    withProjectLock(slug, () => updateProjectLocked(slug, input));
  const confirmInvestigation = (slug, input = {}) =>
    withProjectLock(slug, () => confirmInvestigationLocked(slug, input));
  const confirmApplicationMaterials = (slug, input = {}) =>
    withProjectLock(slug, () => confirmApplicationMaterialsLocked(slug, input));
  const setProjectCv = (slug, cv) =>
    withProjectLock(slug, () => setProjectCvLocked(slug, cv));
  const deleteProject = (slug) =>
    withProjectLock(slug, () => deleteProjectLocked(slug));

  async function ensureDefaultProject() {
    await mkdir(projectsRoot, { recursive: true });
    const projects = await listProjects();
    if (projects.length) return projects[0];
    return createProject(defaultProjectInput, { allowExisting: true });
  }

  return {
    projectsRoot,
    createProject,
    deleteProject,
    inspectCv,
    confirmInvestigation,
    confirmApplicationMaterials,
    ensureDefaultProject,
    getProject,
    listProjects,
    normalizeSlug,
    setProjectCv,
    syncProjectSkills,
    updateProject,
  };
}
