import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

const defaultProjectInput = {
  name: "我的申请项目",
  slug: "new-application",
  season: "",
  degree: "",
  target: "",
  interests: [],
};

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
      return JSON.parse(await readFile(resolve(target, "status.json"), "utf8"));
    } catch {
      return {
        phase: "intake",
        candidateCount: 0,
        highMatchCount: 0,
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
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function normalizeInterests(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map((interest) => ({
        name: String(interest?.name || "").trim().slice(0, 120),
        weight: Number(interest?.weight),
      }))
      .filter(
        (interest) =>
          interest.name && Number.isFinite(interest.weight) && interest.weight > 0,
      )
      .map((interest) => ({
        ...interest,
        weight: Math.min(100, Math.round(interest.weight * 10) / 10),
      }));
  }

  function projectReadiness(metadata) {
    const totalWeight = (metadata.interests || []).reduce(
      (sum, interest) => sum + Number(interest.weight || 0),
      0,
    );
    const checks = [
      { key: "cv", label: "上传真实 CV", complete: Boolean(metadata.cv?.path) },
      { key: "degree", label: "填写目标学位", complete: Boolean(metadata.degree) },
      { key: "season", label: "填写申请季", complete: Boolean(metadata.season) },
      { key: "target", label: "填写目标院校或地区范围", complete: Boolean(metadata.target) },
      {
        key: "interests",
        label: "填写研究兴趣，并让权重合计为 100%",
        complete:
          Array.isArray(metadata.interests) &&
          metadata.interests.length > 0 &&
          Math.abs(totalWeight - 100) < 0.01,
      },
    ];
    return {
      ready: checks.every((item) => item.complete),
      completed: checks.filter((item) => item.complete).length,
      total: checks.length,
      checks,
      missing: checks.filter((item) => !item.complete).map((item) => item.label),
      interestWeightTotal: Math.round(totalWeight * 10) / 10,
    };
  }

  async function getProject(slug) {
    const target = projectPath(slug);
    const metadata = JSON.parse(await readFile(resolve(target, "project.json"), "utf8"));
    return {
      ...metadata,
      path: target,
      status: await readStatus(target),
      candidates: await readCandidates(target),
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
      id: slug,
      slug,
      name: String(input.name || slug).trim(),
      season: String(input.season || "").trim(),
      degree: String(input.degree || "").trim(),
      target: String(input.target || "").trim(),
      interests: normalizeInterests(input.interests),
      cv: null,
      createdAt: now,
      updatedAt: now,
    };
    const status = {
      phase: "intake",
      candidateCount: 0,
      highMatchCount: 0,
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
      cp(sourceSkills, resolve(target, ".agents", "skills"), {
        recursive: true,
        force: true,
        filter: (source) => basename(source) !== ".DS_Store",
      }),
      cp(sourceSkills, resolve(target, ".claude", "skills"), {
        recursive: true,
        force: true,
        filter: (source) => basename(source) !== ".DS_Store",
      }),
      writeFile(projectFile, JSON.stringify(metadata, null, 2)),
      writeFile(resolve(target, "status.json"), JSON.stringify(status, null, 2)),
      writeFile(resolve(target, "outputs", "candidates.json"), "[]\n"),
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

    return getProject(slug);
  }

  async function updateProject(slug, input) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = JSON.parse(await readFile(projectFile, "utf8"));
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
      interests:
        input.interests === undefined
          ? metadata.interests
          : normalizeInterests(input.interests),
      updatedAt: new Date().toISOString(),
    };
    if (!updated.name) updated.name = "未命名申请项目";
    await writeFile(projectFile, JSON.stringify(updated, null, 2));
    return getProject(slug);
  }

  async function setProjectCv(slug, cv) {
    const target = projectPath(slug);
    const projectFile = resolve(target, "project.json");
    const metadata = JSON.parse(await readFile(projectFile, "utf8"));
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
    updateProject,
  };
}
