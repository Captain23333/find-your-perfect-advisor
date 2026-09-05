import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeProjectDirectory } from "../../skills/advisor-pipeline/scripts/init_project.mjs";
import { confirmInvestigationInProject } from "../../skills/advisor-pipeline/scripts/confirm_investigation.mjs";
import {
  normalizeProjectMetadata,
  validateProjectMetadata,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";

test("shared contract migrates string interests without inventing a target", () => {
  const migrated = normalizeProjectMetadata(
    {
      schemaVersion: 3,
      name: "CLI project",
      interests: ["Human-AI interaction", "AI for medicine"],
      shortlist_target: 12,
    },
    { fallbackId: "cli-project", now: "2026-08-17T00:00:00.000Z" },
  );

  assert.equal(migrated.id, "cli-project");
  assert.equal(migrated.slug, "cli-project");
  assert.equal(migrated.target, "");
  assert.equal(migrated.shortlistTarget, 12);
  assert.equal(migrated.hardConstraints, "");
  assert.equal(migrated.portfolioStrategy, "balanced");
  assert.deepEqual(
    migrated.interests.map(({ name }) => name),
    ["Human-AI interaction", "AI for medicine"],
  );
  assert.equal(
    migrated.interests.reduce((sum, interest) => sum + interest.weight, 0),
    100,
  );
  assert.equal(validateProjectMetadata(migrated).valid, true);
});

test("shared contract never truncates valid advisor-program selections", () => {
  const selectedAdvisorProgramIds = Array.from(
    { length: 50 },
    (_, index) => `advisor-program-${index + 1}`,
  );
  const migrated = normalizeProjectMetadata(
    {
      investigation: { selectedAdvisorProgramIds },
    },
    { fallbackId: "large-project", now: "2026-08-17T00:00:00.000Z" },
  );
  assert.deepEqual(
    migrated.investigation.draft.selectedAdvisorProgramIds,
    selectedAdvisorProgramIds,
  );
});

test("direct CLI bootstrap preserves Finder outputs and creates Web-compatible state", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-cli-bootstrap-"));
  try {
    const outputs = resolve(root, "outputs");
    await mkdir(outputs, { recursive: true });
    const candidates = '[{"advisorProgramId":"a-p-1","name":"Real Advisor"}]\n';
    await writeFile(resolve(outputs, "candidates.json"), candidates);

    const result = await initializeProjectDirectory(root, {
      now: "2026-08-17T00:00:00.000Z",
    });
    assert.equal(result.valid, true);
    assert.equal(await readFile(resolve(outputs, "candidates.json"), "utf8"), candidates);

    const project = JSON.parse(await readFile(resolve(root, "project.json"), "utf8"));
    const status = JSON.parse(await readFile(resolve(root, "status.json"), "utf8"));
    assert.equal(project.schemaVersion, 8);
    assert.equal(project.target, "");
    assert.deepEqual(project.interests, []);
    assert.ok(project.createdAt);
    assert.ok(project.updatedAt);
    assert.equal(status.schemaVersion, 2);
    assert.deepEqual(
      JSON.parse(await readFile(resolve(outputs, "advisor_records.json"), "utf8")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--check reports incomplete structure and is strictly read-only", async () => {
  const parent = await mkdtemp(resolve(tmpdir(), "advisor-cli-check-"));
  const missingRoot = resolve(parent, "does-not-exist");
  try {
    const checked = await initializeProjectDirectory(missingRoot, {
      checkOnly: true,
      now: "2026-08-17T00:00:00.000Z",
    });
    assert.equal(checked.requiresMigration, true);
    assert.equal(checked.missingOutputs.length, 4);
    await assert.rejects(access(missingRoot));

    const script = fileURLToPath(
      new URL(
        "../../skills/advisor-pipeline/scripts/init_project.mjs",
        import.meta.url,
      ),
    );
    const processResult = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, [script, "--root", missingRoot, "--check"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => resolveExit({ code, stdout, stderr }));
    });
    assert.equal(processResult.code, 1);
    assert.equal(processResult.stderr, "");
    assert.equal(JSON.parse(processResult.stdout).root, missingRoot);
    await assert.rejects(access(missingRoot));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the CLI still executes when its script path is a symlink", async () => {
  const parent = await mkdtemp(resolve(tmpdir(), "advisor-cli-symlink-"));
  const projectRoot = resolve(parent, "project");
  const script = fileURLToPath(
    new URL(
      "../../skills/advisor-pipeline/scripts/init_project.mjs",
      import.meta.url,
    ),
  );
  const linkedScript = resolve(parent, "init-project.mjs");
  try {
    await symlink(script, linkedScript);
    const processResult = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, [linkedScript, "--root", projectRoot], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => resolveExit({ code, stdout, stderr }));
    });
    assert.equal(processResult.code, 0);
    assert.equal(processResult.stderr, "");
    assert.equal(JSON.parse(processResult.stdout).root, projectRoot);
    await access(resolve(projectRoot, "project.json"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("--check rejects wrong path types and malformed structured outputs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-cli-invalid-structure-"));
  try {
    await initializeProjectDirectory(root, {
      now: "2026-08-17T00:00:00.000Z",
    });
    await rm(resolve(root, "inputs"), { recursive: true, force: true });
    await writeFile(resolve(root, "inputs"), "not-a-directory");
    await writeFile(resolve(root, "outputs", "candidates.json"), "{broken");

    const checked = await initializeProjectDirectory(root, {
      checkOnly: true,
      now: "2026-08-17T00:00:00.000Z",
    });
    assert.equal(checked.valid, false);
    assert.equal(checked.requiresMigration, true);
    assert.ok(checked.structureErrors.some((error) => error.includes("必须是目录")));
    assert.ok(checked.structureErrors.some((error) => error.includes("不是合法 JSON")));

    await assert.rejects(
      initializeProjectDirectory(root, {
        now: "2026-08-17T00:00:00.000Z",
      }),
      /项目结构无效/,
    );
    assert.equal(await readFile(resolve(root, "inputs"), "utf8"), "not-a-directory");
    assert.equal(
      await readFile(resolve(root, "outputs", "candidates.json"), "utf8"),
      "{broken",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--check accepts a complete initialized project", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-cli-valid-check-"));
  try {
    await initializeProjectDirectory(root, {
      now: "2026-08-17T00:00:00.000Z",
    });
    const checked = await initializeProjectDirectory(root, {
      checkOnly: true,
      now: "2026-08-17T00:00:00.000Z",
    });
    assert.equal(checked.valid, true);
    assert.equal(checked.requiresMigration, false);
    assert.deepEqual(checked.structureErrors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap safely backs up and repairs the malformed direct-Detective shape", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-cli-repair-"));
  try {
    await writeFile(
      resolve(root, "project.json"),
      JSON.stringify({
        schemaVersion: 3,
        name: "Broken CLI project",
        target: "Human-AI interaction",
        interests: ["Human-AI interaction"],
      }),
    );
    const result = await initializeProjectDirectory(root, {
      now: "2026-08-17T01:02:03.000Z",
    });
    assert.equal(result.backups.length, 1);
    assert.equal(result.originalErrors.includes("interests 必须是数组"), false);
    assert.ok(result.originalErrors.includes("每个 interest 必须包含 name 和数值 weight"));

    const project = JSON.parse(await readFile(resolve(root, "project.json"), "utf8"));
    assert.deepEqual(project.interests, [
      { name: "Human-AI interaction", weight: 100 },
    ]);
    assert.ok(project.id);
    assert.ok(project.createdAt);
    assert.equal(validateProjectMetadata(project).valid, true);
    assert.equal(
      await readFile(result.backups[0], "utf8"),
      JSON.stringify({
        schemaVersion: 3,
        name: "Broken CLI project",
        target: "Human-AI interaction",
        interests: ["Human-AI interaction"],
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct CLI confirmation validates exact candidates and writes one confirmed snapshot", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-cli-confirm-"));
  try {
    await initializeProjectDirectory(root, {
      now: "2026-08-17T00:00:00.000Z",
    });
    await writeFile(
      resolve(root, "outputs", "candidates.json"),
      JSON.stringify([
        { advisorProgramId: "advisor-program-1", name: "Real Advisor" },
      ]),
    );
    const result = await confirmInvestigationInProject(
      root,
      {
        advisorProgramIds: ["advisor-program-1"],
        selectedSections: ["guidance_group_ecology"],
        communityRequested: true,
        now: "2026-08-17T03:00:00.000Z",
      },
    );
    assert.deepEqual(
      result.project.investigation.confirmed.selectedAdvisorProgramIds,
      ["advisor-program-1"],
    );
    assert.equal(
      result.project.investigation.confirmed.communitySources.consented,
      true,
    );
    assert.ok(result.project.investigation.confirmed.fingerprint);
    assert.ok(result.backup);

    await assert.rejects(
      confirmInvestigationInProject(root, {
        advisorProgramIds: ["missing-advisor-program"],
        selectedSections: ["recent_research"],
        communityRequested: false,
        now: "2026-08-17T04:00:00.000Z",
      }),
      /已不存在/,
    );
    const unchanged = JSON.parse(await readFile(resolve(root, "project.json"), "utf8"));
    assert.deepEqual(
      unchanged.investigation.confirmed.selectedAdvisorProgramIds,
      ["advisor-program-1"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
