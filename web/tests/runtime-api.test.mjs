import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(testDirectory, "..", "local-runtime", "server.mjs");

async function startRuntime(envOverrides = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-runtime-"));
  // The runtime copies the repo's skills into each project it creates.
  await mkdir(resolve(root, "skills", "advisor-pipeline"), { recursive: true });
  await writeFile(resolve(root, "skills", "advisor-pipeline", "SKILL.md"), "# stub\n");

  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ADVISOR_ATLAS_PROJECT_ROOT: root,
      ADVISOR_ATLAS_RUNTIME_PORT: "0",
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = await new Promise((resolveUrl, rejectUrl) => {
    let buffered = "";
    const timer = setTimeout(
      () => rejectUrl(new Error(`runtime did not start: ${buffered}`)),
      20_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      const match = buffered.match(/http:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[0]);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      buffered += chunk;
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`runtime exited with ${code}: ${buffered}`));
    });
  });

  return {
    baseUrl,
    root,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((done) => child.on("exit", done));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Custom API reports a missing Codex runtime before claiming it is connected", async (t) => {
  const runtime = await startRuntime({
    ADVISOR_ATLAS_CODEX_BIN: resolve(
      tmpdir(),
      "advisor-atlas-definitely-missing-codex",
    ),
  });
  t.after(() => runtime.stop());

  const health = await json(await fetch(`${runtime.baseUrl}/api/health`));
  assert.equal(health.status, 200);
  assert.equal(health.body.providers.custom.installed, false);
  assert.equal(health.body.providers.custom.loggedIn, false);
  assert.match(health.body.providers.custom.authDetail, /npm install/);

  const connection = await json(
    await fetch(`${runtime.baseUrl}/api/custom-provider/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://example.invalid",
        apiKey: "test-key-never-sent",
        model: "test-model",
      }),
    }),
  );
  assert.equal(connection.status, 422);
  assert.equal(connection.body.runtimeMissing, true);
  assert.match(connection.body.error, /npm install/);
});

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test("local runtime API enforces the run and project contracts", async (t) => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());

  const created = await json(
    await fetch(`${runtime.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "API 测试项目", slug: "api-test-project" }),
    }),
  );
  assert.equal(created.status, 201);
  const projectId = created.body.project.id;
  assert.equal(created.body.project.readiness.modes.finder.ready, false);

  await t.test("concurrent PATCH requests keep every field", async () => {
    const [first, second] = await Promise.all([
      fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "US HCI programs" }),
      }),
      fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ degree: "PhD" }),
      }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const reread = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}`),
    );
    assert.equal(reread.body.project.target, "US HCI programs");
    assert.equal(reread.body.project.degree, "PhD");
  });

  await t.test("CV uploads are validated by type and content", async () => {
    const rejected = await json(
      await fetch(`${runtime.baseUrl}/api/files`, {
        method: "POST",
        headers: {
          "x-file-name": encodeURIComponent("payload.exe"),
          "x-file-type": "application/octet-stream",
          "x-project-id": projectId,
        },
        body: "MZ binary",
      }),
    );
    assert.equal(rejected.status, 415);

    const accepted = await json(
      await fetch(`${runtime.baseUrl}/api/files`, {
        method: "POST",
        headers: {
          "x-file-name": encodeURIComponent("cv.pdf"),
          "x-file-type": "application/pdf",
          "x-project-id": projectId,
        },
        body: "%PDF-1.4 real bytes",
      }),
    );
    assert.equal(accepted.status, 201);
    assert.match(accepted.body.path, /^inputs\//);
    assert.equal(accepted.body.readiness.modes.finder.ready, true);
  });

  await t.test("each mode is gated by its own preconditions", async () => {
    const unknownMode = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "everything",
          prompt: "go",
        }),
      }),
    );
    assert.equal(unknownMode.status, 400);

    const ranking = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "ranking",
          prompt: "rank them",
        }),
      }),
    );
    assert.equal(ranking.status, 422);
    assert.match(ranking.body.error, /背调/);
    assert.equal(ranking.body.mode, "ranking");

    const detective = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "detective",
          prompt: "investigate",
        }),
      }),
    );
    assert.equal(detective.status, 422);
    assert.match(detective.body.error, /候选导师|最终确认/);
  });

  await t.test("confirmation refuses a stale draft revision", async () => {
    // A confirmation is only meaningful against real Finder output.
    await writeFile(
      resolve(runtime.root, "projects", projectId, "outputs", "candidates.json"),
      JSON.stringify([{ advisorProgramId: "ap-1", name: "Real Advisor" }]),
    );
    await fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        investigation: {
          draft: {
            selectedAdvisorProgramIds: ["ap-1"],
            selectedSections: ["identity_current_role"],
          },
        },
      }),
    });
    const stale = await json(
      await fetch(
        `${runtime.baseUrl}/api/projects/${projectId}/investigation/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftRevision: 99 }),
        },
      ),
    );
    assert.equal(stale.status, 409);

    const current = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}`),
    );
    const revision = current.body.project.investigation.draft.revision;
    const confirmed = await json(
      await fetch(
        `${runtime.baseUrl}/api/projects/${projectId}/investigation/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftRevision: revision }),
        },
      ),
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.project.investigation.confirmed.revision, revision);
    // Detective becomes runnable only once a current confirmation exists.
    assert.equal(confirmed.body.project.readiness.modes.detective.ready, true);

    const staleRun = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "detective",
          confirmedRevision: revision - 1,
          prompt: "investigate",
        }),
      }),
    );
    assert.equal(staleRun.status, 409);
    assert.match(staleRun.body.error, /调查配置已更新/);
  });

  await t.test("application materials reuse the existing CV with exact confirmation", async () => {
    await writeFile(
      resolve(runtime.root, "projects", projectId, "outputs", "ranking.json"),
      JSON.stringify({
        rankings: [
          { advisorProgramId: "ap-1", rank: 1, name: "Real Advisor", totalScore: 8.5 },
        ],
      }),
    );
    const saved = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationMaterials: {
            advisorProgramId: "ap-1",
            materials: ["research_proposal", "outreach_email"],
            order: ["research_proposal", "outreach_email"],
          },
        }),
      }),
    );
    assert.equal(saved.status, 200);
    const revision = saved.body.project.applicationMaterials.draft.revision;
    const stale = await json(
      await fetch(
        `${runtime.baseUrl}/api/projects/${projectId}/application-materials/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftRevision: revision + 1 }),
        },
      ),
    );
    assert.equal(stale.status, 409);

    const confirmed = await json(
      await fetch(
        `${runtime.baseUrl}/api/projects/${projectId}/application-materials/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftRevision: revision }),
        },
      ),
    );
    assert.equal(confirmed.status, 200);
    assert.equal(
      confirmed.body.project.applicationMaterials.confirmed.advisorProgramId,
      "ap-1",
    );
    assert.equal(confirmed.body.project.readiness.modes.research_proposal.ready, false);
    assert.match(
      confirmed.body.project.readiness.modes.research_proposal.missing.join(" "),
      /真实姓名/,
    );

    const missingNameRun = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "research_proposal",
          confirmedRevision: revision,
          prompt: "write proposal",
        }),
      }),
    );
    assert.equal(missingNameRun.status, 422);
    assert.match(missingNameRun.body.error, /真实姓名/);

    const identified = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicantName: "Ada Lovelace" }),
      }),
    );
    assert.equal(identified.status, 200);
    assert.equal(identified.body.project.readiness.modes.research_proposal.ready, true);
    assert.equal(identified.body.project.cv.valid, true);
    assert.doesNotMatch(
      identified.body.project.readiness.modes.research_proposal.missing.join(" "),
      /CV|简历/i,
    );
    assert.equal(identified.body.project.readiness.modes.outreach_email.ready, false);

    const unboundRun = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "research_proposal",
          prompt: "write proposal",
        }),
      }),
    );
    assert.equal(unboundRun.status, 409);
    assert.match(unboundRun.body.error, /必须绑定当前确认版本/);

    const staleRun = await json(
      await fetch(`${runtime.baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider: "codex",
          mode: "research_proposal",
          confirmedRevision: revision - 1,
          prompt: "write proposal",
        }),
      }),
    );
    assert.equal(staleRun.status, 409);
    assert.match(staleRun.body.error, /申请材料配置已更新/);
  });

  await t.test("community refresh needs a current, community-scoped confirmation", async () => {
    // Confirmed, but no community-relevant dimension was selected.
    const irrelevant = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}/community-cache`, {
        method: "POST",
      }),
    );
    assert.equal(irrelevant.status, 403);
    assert.match(irrelevant.body.error, /不需要社区资料/);

    const withCommunity = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investigation: {
            draft: {
              selectedAdvisorProgramIds: ["ap-1"],
              selectedSections: ["identity_current_role", "guidance_group_ecology"],
              communitySources: { requested: true },
            },
          },
        }),
      }),
    );
    await fetch(
      `${runtime.baseUrl}/api/projects/${projectId}/investigation/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftRevision: withCommunity.body.project.investigation.draft.revision,
        }),
      },
    );

    // Editing the draft afterwards invalidates the authorization immediately.
    await fetch(`${runtime.baseUrl}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        investigation: {
          draft: {
            selectedAdvisorProgramIds: ["ap-1"],
            selectedSections: ["identity_current_role"],
            communitySources: { requested: false },
          },
        },
      }),
    });
    const stale = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${projectId}/community-cache`, {
        method: "POST",
      }),
    );
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /发生变化/);
  });

  await t.test("run listing and stream attach report honest state", async () => {
    const listed = await json(
      await fetch(
        `${runtime.baseUrl}/api/runs?projectId=${encodeURIComponent(projectId)}`,
      ),
    );
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.active, []);
    assert.ok(Array.isArray(listed.body.recent));

    const missingStream = await fetch(
      `${runtime.baseUrl}/api/runs/00000000-0000-0000-0000-000000000000/stream`,
    );
    assert.equal(missingStream.status, 404);
    await missingStream.json();
  });

  await t.test("permanent deletion requires the exact project name", async () => {
    const protectedProject = await json(
      await fetch(`${runtime.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Delete API Project", slug: "delete-api-project" }),
      }),
    );
    const id = protectedProject.body.project.id;

    const refused = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: "wrong name" }),
      }),
    );
    assert.equal(refused.status, 422);
    assert.equal((await fetch(`${runtime.baseUrl}/api/projects/${id}`)).status, 200);

    const deleted = await json(
      await fetch(`${runtime.baseUrl}/api/projects/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: "Delete API Project" }),
      }),
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted.id, id);
    assert.equal((await fetch(`${runtime.baseUrl}/api/projects/${id}`)).status, 500);
  });
});
