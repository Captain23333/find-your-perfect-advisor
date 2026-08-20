import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createProjectStore } from "../local-runtime/project-store.mjs";
import { withProjectFileLock } from "../../skills/advisor-pipeline/scripts/project-file-lock.mjs";
import {
  investigationCostLevel,
  readinessForProject,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";

async function scratchStore(name) {
  const root = await mkdtemp(resolve(tmpdir(), `advisor-${name}-`));
  await mkdir(resolve(root, "skills"), { recursive: true });
  return { root, store: createProjectStore(root) };
}

test("overlapping updates keep both fields instead of silently dropping one", async () => {
  const { root, store } = await scratchStore("concurrency");
  try {
    await store.createProject({ name: "T", slug: "concurrent-project" });
    await Promise.all([
      store.updateProject("concurrent-project", { target: "AAA" }),
      store.updateProject("concurrent-project", { degree: "PhD" }),
      store.updateProject("concurrent-project", { season: "2027 Fall" }),
    ]);
    const project = await store.getProject("concurrent-project");
    assert.equal(project.target, "AAA");
    assert.equal(project.degree, "PhD");
    assert.equal(project.season, "2027 Fall");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the filesystem lock serializes independent Web and CLI-style writers", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-file-lock-"));
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const writer = (name) =>
    withProjectFileLock(root, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(`${name}:start`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 30));
      order.push(`${name}:end`);
      active -= 1;
    });
  try {
    await Promise.all([writer("web"), writer("cli")]);
    assert.equal(maximumActive, 1);
    assert.equal(order.length, 4);
    assert.match(order.join(" "), /^(web:start web:end cli:start cli:end|cli:start cli:end web:start web:end)$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a draft save racing a confirmation still leaves exactly one snapshot", async () => {
  const { root, store } = await scratchStore("confirm-race");
  try {
    const project = await store.createProject({ name: "T", slug: "race-project" });
    await writeFile(
      resolve(project.path, "outputs", "candidates.json"),
      JSON.stringify([{ advisorProgramId: "ap-1", name: "Advisor" }]),
    );
    const saved = await store.updateProject("race-project", {
      investigation: {
        draft: {
          selectedAdvisorProgramIds: ["ap-1"],
          selectedSections: ["identity_current_role"],
        },
      },
    });
    const revision = saved.investigation.draft.revision;

    const [confirmResult, patchResult] = await Promise.allSettled([
      store.confirmInvestigation("race-project", { draftRevision: revision }),
      store.updateProject("race-project", { name: "Renamed" }),
    ]);
    assert.equal(confirmResult.status, "fulfilled");
    assert.equal(patchResult.status, "fulfilled");

    const final = await store.getProject("race-project");
    assert.equal(final.name, "Renamed");
    assert.ok(final.investigation.confirmed);
    assert.equal(final.investigation.confirmed.revision, revision);
    assert.deepEqual(final.investigation.confirmed.selectedAdvisorProgramIds, ["ap-1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale draft revision is rejected rather than confirmed", async () => {
  const { root, store } = await scratchStore("stale");
  try {
    const project = await store.createProject({ name: "T", slug: "stale-project" });
    await writeFile(
      resolve(project.path, "outputs", "candidates.json"),
      JSON.stringify([{ advisorProgramId: "ap-1", name: "Advisor" }]),
    );
    await store.updateProject("stale-project", {
      investigation: {
        draft: {
          selectedAdvisorProgramIds: ["ap-1"],
          selectedSections: ["identity_current_role"],
        },
      },
    });
    await assert.rejects(
      () => store.confirmInvestigation("stale-project", { draftRevision: 0 }),
      (error) => error.code === "STALE_DRAFT",
    );
    const project2 = await store.getProject("stale-project");
    assert.equal(project2.investigation.confirmed, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project.json is replaced atomically, never left half written", async () => {
  const { root, store } = await scratchStore("atomic");
  try {
    const project = await store.createProject({ name: "T", slug: "atomic-project" });
    const projectFile = resolve(project.path, "project.json");
    const writes = Array.from({ length: 12 }, (_, index) =>
      store.updateProject("atomic-project", { target: `target-${index}` }),
    );
    const reads = Array.from({ length: 12 }, async () => {
      const raw = await readFile(projectFile, "utf8");
      // Never observe a torn file mid-write.
      JSON.parse(raw);
    });
    await Promise.all([...writes, ...reads]);
    assert.ok(JSON.parse(await readFile(projectFile, "utf8")).target.startsWith("target-"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a CV whose file disappeared stops counting as a matching signal", async () => {
  const { root, store } = await scratchStore("cv");
  try {
    const project = await store.createProject({ name: "T", slug: "cv-project" });
    const cvPath = resolve(project.path, "inputs", "cv.pdf");
    await writeFile(cvPath, "%PDF-1.4 real bytes");
    const withCv = await store.setProjectCv("cv-project", {
      name: "cv.pdf",
      path: cvPath,
      size: (await stat(cvPath)).size,
      type: "application/pdf",
    });
    // Stored as an in-project relative path so the project stays portable.
    assert.equal(withCv.cv.path, "inputs/cv.pdf");
    assert.equal(withCv.cv.valid, true);
    assert.equal(withCv.readiness.modes.finder.missing.length, 1); // only target left

    await unlink(cvPath);
    const broken = await store.getProject("cv-project");
    assert.equal(broken.cv.valid, false);
    assert.match(broken.cv.issue, /不存在|移动/);
    assert.equal(broken.readiness.cvValid, false);
    assert.ok(
      broken.readiness.missing.includes("上传 CV 或填写至少一个研究兴趣"),
      "an invalid CV must not satisfy the matching-signal check",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unsupported or empty CV is refused and the previous CV survives", async () => {
  const { root, store } = await scratchStore("cv-reject");
  try {
    const project = await store.createProject({ name: "T", slug: "cv-reject" });
    const goodPath = resolve(project.path, "inputs", "cv.pdf");
    await writeFile(goodPath, "%PDF-1.4 real bytes");
    await store.setProjectCv("cv-reject", {
      name: "cv.pdf",
      path: goodPath,
      size: 19,
      type: "application/pdf",
    });

    const badPath = resolve(project.path, "inputs", "payload.exe");
    await writeFile(badPath, "MZ");
    await assert.rejects(
      () =>
        store.setProjectCv("cv-reject", {
          name: "payload.exe",
          path: badPath,
          size: 2,
          type: "application/octet-stream",
        }),
      (error) => error.code === "INVALID_CV",
    );

    const emptyPath = resolve(project.path, "inputs", "empty.pdf");
    await writeFile(emptyPath, "");
    await assert.rejects(
      () =>
        store.setProjectCv("cv-reject", {
          name: "empty.pdf",
          path: emptyPath,
          size: 0,
          type: "application/pdf",
        }),
      (error) => error.code === "INVALID_CV",
    );

    const outsidePath = resolve(root, "outside.pdf");
    await writeFile(outsidePath, "%PDF-1.4");
    await assert.rejects(
      () =>
        store.setProjectCv("cv-reject", {
          name: "outside.pdf",
          path: outsidePath,
          size: 8,
          type: "application/pdf",
        }),
      (error) => error.code === "INVALID_CV",
    );

    const final = await store.getProject("cv-reject");
    assert.equal(final.cv.name, "cv.pdf");
    assert.equal(final.cv.valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness is decided per mode, so Phase 2 survives a broken Phase 1 CV", () => {
  const migrated = readinessForProject({
    metadata: {
      target: "",
      degree: "",
      season: "",
      interests: [],
      investigation: {
        draft: {
          selectedAdvisorProgramIds: ["ap-1"],
          selectedSections: ["identity_current_role"],
          communitySources: { requested: false },
          revision: 2,
        },
      },
    },
    candidates: [{ advisorProgramId: "ap-1" }],
    detectiveResults: { results: [{ advisorProgramId: "ap-1" }] },
    cvValid: false,
  });

  assert.equal(migrated.modes.finder.ready, false);
  assert.equal(migrated.modes.finder_objective.ready, false);
  // No confirmation yet, so Detective is blocked for the right reason.
  assert.equal(migrated.modes.detective.ready, false);
  assert.match(migrated.modes.detective.missing.join(" "), /最终确认/);
  // Ranking only depends on existing detective output.
  assert.equal(migrated.modes.ranking.ready, true);
});

test("readiness matrix walks the whole pipeline as inputs arrive", () => {
  const base = {
    target: "US HCI programs",
    degree: "",
    season: "",
    interests: [{ name: "HCI", weight: 100 }],
    investigation: { draft: { selectedAdvisorProgramIds: [], selectedSections: [] } },
  };
  const start = readinessForProject({ metadata: base, candidates: [] });
  assert.equal(start.modes.finder.ready, true);
  assert.equal(start.modes.finder_objective.ready, false);
  assert.match(start.modes.finder_objective.missing.join(" "), /导师发现/);
  assert.equal(start.modes.detective.ready, false);
  assert.equal(start.modes.ranking.ready, false);

  const afterFinder = readinessForProject({
    metadata: { ...base, degree: "PhD", season: "2027 Fall" },
    candidates: [{ advisorProgramId: "ap-1" }],
  });
  assert.equal(afterFinder.modes.finder_objective.ready, true);
});

test("cost thresholds match the documented Web levels", () => {
  assert.equal(investigationCostLevel(8), "low");
  assert.equal(investigationCostLevel(9), "medium");
  assert.equal(investigationCostLevel(24), "medium");
  assert.equal(investigationCostLevel(25), "high");
});

test("permanent project deletion removes only the resolved project directory", async () => {
  const { root, store } = await scratchStore("delete");
  try {
    const removed = await store.createProject({ name: "Remove me", slug: "remove-me" });
    const survivor = await store.createProject({ name: "Keep me", slug: "keep-me" });
    await writeFile(resolve(removed.path, "outputs", "valuable-result.txt"), "result");

    const deleted = await store.deleteProject("remove-me");
    assert.equal(deleted.id, "remove-me");
    await assert.rejects(() => stat(removed.path), { code: "ENOENT" });
    assert.ok((await stat(survivor.path)).isDirectory());
    await assert.rejects(() => store.deleteProject("../../outside"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
