import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  createRunRegistry,
  markOrphanedRunsInterrupted,
  runSnapshot,
} from "../local-runtime/run-registry.mjs";
import { classifyProviderLine } from "../local-runtime/run-events.mjs";
import {
  extractInputRequest,
  parseInputRequest,
  verifyRunArtifacts,
} from "../local-runtime/run-artifacts.mjs";
import { createProjectStore } from "../local-runtime/project-store.mjs";
import { writePortableXlsx } from "../../skills/advisor-pipeline/scripts/workbook-runtime.mjs";

async function writeWorkbookFixture(outputs, name) {
  await writePortableXlsx(
    {
      sheets: [
        {
          name: "结果",
          headers: ["状态"],
          rows: [["ok"]],
          widths: [18],
          freezeRows: 1,
          freezeColumns: 1,
        },
      ],
    },
    resolve(outputs, name),
  );
}

function fakeRun(id, projectId, overrides = {}) {
  return {
    id,
    finished: false,
    permissions: new Map(),
    metadata: {
      id,
      projectId,
      mode: "detective",
      status: "running",
      startedAt: "2026-08-19T00:00:00.000Z",
      ...overrides,
    },
  };
}

async function scratchProject(name) {
  const root = await mkdtemp(resolve(tmpdir(), `advisor-${name}-`));
  await mkdir(resolve(root, "skills"), { recursive: true });
  const store = createProjectStore(root);
  const project = await store.createProject({ name: "T", slug: "run-fixture" });
  return { root, store, project };
}

test("one project can only have one active run at a time", () => {
  const registry = createRunRegistry();
  const first = registry.register(fakeRun("run-1", "project-a"));
  assert.equal(registry.activeForProject("project-a"), first);

  assert.throws(
    () => registry.register(fakeRun("run-2", "project-a")),
    (error) => {
      assert.equal(error.code, "PROJECT_RUN_CONFLICT");
      assert.equal(error.activeRun.id, "run-1");
      return true;
    },
  );

  // A different project is unaffected.
  registry.register(fakeRun("run-3", "project-b"));
  assert.equal(registry.activeForProject("project-b").id, "run-3");
  assert.equal(registry.size, 2);

  // Releasing frees the slot; a finished run never blocks a new one.
  registry.release("run-1");
  assert.equal(registry.activeForProject("project-a"), null);
  const replacement = registry.register(fakeRun("run-4", "project-a"));
  assert.equal(replacement.id, "run-4");
});

test("run snapshots carry the pending permission requests", () => {
  const run = fakeRun("run-5", "project-c");
  run.permissions.set("perm-1", {
    permission: { id: "perm-1", toolName: "WebFetch" },
  });
  const snapshot = runSnapshot(run);
  assert.equal(snapshot.id, "run-5");
  assert.deepEqual(snapshot.pendingPermissions, [
    { id: "perm-1", toolName: "WebFetch" },
  ]);
  run.metadata.status = "needs_input";
  run.metadata.requestedInput = {
    fields: [{ id: "degree", label: "目标学位", required: true }],
  };
  assert.equal(runSnapshot(run).requestedInput.fields[0].id, "degree");
});

test("runs left over from a dead runtime are marked interrupted, not running", async () => {
  const { root, store, project } = await scratchProject("orphan");
  try {
    const runDirectory = resolve(project.path, "runs", "orphan-run");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      resolve(runDirectory, "metadata.json"),
      JSON.stringify({ id: "orphan-run", projectId: project.id, status: "running" }),
    );
    const finishedDirectory = resolve(project.path, "runs", "done-run");
    await mkdir(finishedDirectory, { recursive: true });
    await writeFile(
      resolve(finishedDirectory, "metadata.json"),
      JSON.stringify({ id: "done-run", projectId: project.id, status: "completed" }),
    );
    const waitingDirectory = resolve(project.path, "runs", "waiting-run");
    await mkdir(waitingDirectory, { recursive: true });
    await writeFile(
      resolve(waitingDirectory, "metadata.json"),
      JSON.stringify({ id: "waiting-run", projectId: project.id, status: "needs_input" }),
    );

    const interrupted = await markOrphanedRunsInterrupted(store);
    assert.deepEqual(interrupted.sort(), ["orphan-run", "waiting-run"]);

    const reread = JSON.parse(
      await readFile(resolve(runDirectory, "metadata.json"), "utf8"),
    );
    assert.equal(reread.status, "interrupted");
    assert.ok(reread.finishedAt);
    const untouched = JSON.parse(
      await readFile(resolve(finishedDirectory, "metadata.json"), "utf8"),
    );
    assert.equal(untouched.status, "completed");
    const waiting = JSON.parse(
      await readFile(resolve(waitingDirectory, "metadata.json"), "utf8"),
    );
    assert.equal(waiting.status, "interrupted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finder is only complete with a real candidate array and stable ids", async () => {
  const { root, project } = await scratchProject("finder");
  const outputs = resolve(project.path, "outputs");
  try {
    const missing = await verifyRunArtifacts({ projectPath: project.path, mode: "finder" });
    // createProject seeds an empty array, so this is "no candidates", not "no file".
    assert.equal(missing.complete, false);

    await writeFile(resolve(outputs, "candidates.json"), "{not json");
    const invalid = await verifyRunArtifacts({ projectPath: project.path, mode: "finder" });
    assert.equal(invalid.complete, false);
    assert.match(invalid.missing.join(" "), /不是合法/);

    await writeFile(
      resolve(outputs, "candidates.json"),
      JSON.stringify([{ name: "No Id Advisor" }]),
    );
    const noIds = await verifyRunArtifacts({ projectPath: project.path, mode: "finder" });
    assert.equal(noIds.complete, false);
    assert.match(noIds.missing.join(" "), /advisorProgramId/);

    await writeFile(
      resolve(outputs, "candidates.json"),
      JSON.stringify([{ advisorProgramId: "ap-1", name: "Real Advisor" }]),
    );
    const missingWorkbook = await verifyRunArtifacts({
      projectPath: project.path,
      mode: "finder",
    });
    assert.equal(missingWorkbook.complete, false);
    assert.match(missingWorkbook.missing.join(" "), /advisor_shortlist/);

    const brokenWorkbook = resolve(outputs, "advisor_shortlist_broken.xlsx");
    await writeFile(brokenWorkbook, "not an xlsx");
    const invalidWorkbook = await verifyRunArtifacts({
      projectPath: project.path,
      mode: "finder",
    });
    assert.equal(invalidWorkbook.complete, false);
    assert.match(invalidWorkbook.missing.join(" "), /不是完整可打开/);

    await rm(brokenWorkbook);
    await writeWorkbookFixture(outputs, "advisor_shortlist_20260831.xlsx");
    const stale = await verifyRunArtifacts({
      projectPath: project.path,
      mode: "finder",
      startedAt: new Date(Date.now() + 5_000).toISOString(),
    });
    assert.equal(stale.complete, false);
    assert.match(stale.missing.join(" "), /旧工作簿/);

    const good = await verifyRunArtifacts({ projectPath: project.path, mode: "finder" });
    assert.equal(good.complete, true);
    assert.deepEqual(good.missing, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detective results from an older confirmation do not count as this round", async () => {
  const { root, project } = await scratchProject("detective");
  const outputs = resolve(project.path, "outputs");
  const baseArgs = {
    projectPath: project.path,
    mode: "detective",
    confirmedRevision: 4,
    confirmedFingerprint: "fingerprint-now",
    selectedAdvisorProgramIds: ["ap-1"],
    selectedSections: ["identity_current_role", "recent_research"],
    startedAt: "2026-08-19T10:00:00.000Z",
  };
  try {
    const stale = {
      confirmedRevision: 3,
      confirmedFingerprint: "fingerprint-old",
      generatedAt: "2026-08-19T11:00:00.000Z",
      results: [
        {
          advisorProgramId: "ap-1",
          sections: {
            identity_current_role: "ok",
            recent_research: { status: "not_completed", summary: "缺少来源" },
          },
        },
      ],
    };
    await writeFile(resolve(outputs, "detective-results.json"), JSON.stringify(stale));
    const staleOutcome = await verifyRunArtifacts(baseArgs);
    assert.equal(staleOutcome.complete, false);
    assert.match(staleOutcome.missing.join(" "), /确认版本 3/);

    // Same shape, current revision: an explicitly unfinished dimension is fine.
    await writeFile(
      resolve(outputs, "detective-results.json"),
      JSON.stringify({
        ...stale,
        confirmedRevision: 4,
        confirmedFingerprint: "fingerprint-now",
      }),
    );
    await writeWorkbookFixture(outputs, "advisor_detective_20260831.xlsx");
    const current = await verifyRunArtifacts(baseArgs);
    assert.equal(current.complete, true);

    // A silently absent dimension is not.
    await writeFile(
      resolve(outputs, "detective-results.json"),
      JSON.stringify({
        confirmedRevision: 4,
        confirmedFingerprint: "fingerprint-now",
        generatedAt: "2026-08-19T11:00:00.000Z",
        results: [{ advisorProgramId: "ap-1", sections: { identity_current_role: "ok" } }],
      }),
    );
    const unmarked = await verifyRunArtifacts(baseArgs);
    assert.equal(unmarked.complete, false);
    assert.match(unmarked.missing.join(" "), /既没有结论也没有标记未完成/);

    // A selected advisor with no entry at all is reported by id.
    await writeFile(
      resolve(outputs, "detective-results.json"),
      JSON.stringify({
        confirmedRevision: 4,
        confirmedFingerprint: "fingerprint-now",
        generatedAt: "2026-08-19T11:00:00.000Z",
        results: [
          {
            advisorProgramId: "ap-9",
            sections: { identity_current_role: "ok", recent_research: "ok" },
          },
        ],
      }),
    );
    const uncovered = await verifyRunArtifacts(baseArgs);
    assert.equal(uncovered.complete, false);
    assert.match(uncovered.missing.join(" "), /ap-1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a new Detective run never accepts a legacy artifact without its confirmation", async () => {
  const { root, project } = await scratchProject("legacy-detective");
  const outputs = resolve(project.path, "outputs");
  const args = {
    projectPath: project.path,
    mode: "detective",
    confirmedRevision: 2,
    confirmedFingerprint: "fingerprint",
    selectedAdvisorProgramIds: ["ap-1"],
    selectedSections: ["identity_current_role"],
    startedAt: "2026-08-19T10:00:00.000Z",
  };
  try {
    await writeFile(
      resolve(outputs, "detective-results.json"),
      JSON.stringify({
        generatedAt: "2026-08-01T00:00:00.000Z",
        results: [{ advisorProgramId: "ap-1", sections: { identity_current_role: "ok" } }],
      }),
    );
    const old = await verifyRunArtifacts(args);
    assert.equal(old.complete, false);

    await writeFile(
      resolve(outputs, "detective-results.json"),
      JSON.stringify({
        generatedAt: "2026-08-19T10:30:00.000Z",
        results: [{ advisorProgramId: "ap-1", sections: { identity_current_role: "ok" } }],
      }),
    );
    const fresh = await verifyRunArtifacts(args);
    assert.equal(fresh.complete, false);
    assert.match(fresh.missing.join(" "), /没有记录本次确认版本|配置指纹/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ranking needs a sortable result, not just valid JSON", async () => {
  const { root, project } = await scratchProject("ranking");
  const outputs = resolve(project.path, "outputs");
  try {
    const absent = await verifyRunArtifacts({ projectPath: project.path, mode: "ranking" });
    assert.equal(absent.complete, false);
    assert.match(absent.missing.join(" "), /尚未生成/);

    await writeFile(resolve(outputs, "ranking.json"), JSON.stringify({ rankings: [] }));
    const empty = await verifyRunArtifacts({ projectPath: project.path, mode: "ranking" });
    assert.equal(empty.complete, false);

    await writeFile(
      resolve(outputs, "ranking.json"),
      JSON.stringify({ rankings: [{ advisorProgramId: "ap-1", note: "no score" }] }),
    );
    const unsortable = await verifyRunArtifacts({
      projectPath: project.path,
      mode: "ranking",
    });
    assert.equal(unsortable.complete, false);

    await writeFile(
      resolve(outputs, "ranking.json"),
      JSON.stringify({ rankings: [{ advisorProgramId: "ap-1", rank: 1, totalScore: 8.4 }] }),
    );
    const noWorkbook = await verifyRunArtifacts({
      projectPath: project.path,
      mode: "ranking",
    });
    assert.equal(noWorkbook.complete, false);
    assert.match(noWorkbook.missing.join(" "), /advisor_application_ready/);
    await writeWorkbookFixture(outputs, "advisor_application_ready_20260831.xlsx");
    const good = await verifyRunArtifacts({ projectPath: project.path, mode: "ranking" });
    assert.equal(good.complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structured input requests are recognised inside ordinary agent messages", () => {
  const direct = parseInputRequest({
    type: "input.requested",
    reason: "需要学位",
    fields: [{ id: "degree", label: "目标学位", required: true }],
  });
  assert.equal(direct.fields.length, 1);
  assert.equal(direct.fields[0].id, "degree");

  const cv = parseInputRequest({
    type: "input.requested",
    reason: "需要真实 CV",
    fields: [{ id: "cv", label: "上传真实 CV", required: true }],
  });
  assert.equal(cv.fields.length, 1);
  assert.equal(cv.fields[0].id, "cv");

  const embedded = extractInputRequest(
    '好的，我需要更多信息：\n{"type":"input.requested","reason":"缺少申请季","fields":[{"id":"season","label":"申请季"}]}\n谢谢。',
  );
  assert.equal(embedded.reason, "缺少申请季");
  assert.equal(embedded.fields[0].id, "season");

  // Unknown field ids are not silently written into the project.
  assert.equal(
    parseInputRequest({ type: "input.requested", fields: [{ id: "apiKey" }] }),
    null,
  );
  assert.equal(extractInputRequest("普通的一句话"), null);
});

test("provider noise is classified by stream and level, not shown as progress", () => {
  assert.equal(classifyProviderLine("codex", "正在检索导师主页", "stdout"), "progress");
  assert.equal(
    classifyProviderLine("codex", "ignoring interface.icon_small", "stderr"),
    "diagnostic",
  );
  assert.equal(
    classifyProviderLine("codex", "state db discrepancy detected", "stderr"),
    "diagnostic",
  );
  assert.equal(
    classifyProviderLine("codex", "MCP initialize failed: timeout", "stderr"),
    "connection_retry",
  );
  assert.equal(classifyProviderLine("codex", "HTTP 502 Bad Gateway", "stderr"), "connection_retry");
  // An unknown provider's unknown stderr line still stays out of the main log.
  assert.equal(classifyProviderLine("newprovider", "something odd", "stderr"), "diagnostic");
});
