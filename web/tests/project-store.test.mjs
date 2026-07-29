import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_FINDER_SECTIONS,
  createProjectStore,
} from "../local-runtime/project-store.mjs";

test("project store persists exact investigation configuration", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-atlas-store-"));
  try {
    const skillReferences = resolve(
      root,
      "skills",
      "advisor-detective",
      "references",
    );
    await mkdir(skillReferences, { recursive: true });
    await writeFile(
      resolve(skillReferences, "community-blacklist-current.pdf"),
      "must-not-copy",
    );
    await writeFile(resolve(skillReferences, "community-sources.md"), "copy");

    const store = createProjectStore(root);
    const project = await store.createProject({ name: "Test", slug: "test-project" });
    assert.deepEqual(project.investigation.finderSections, DEFAULT_FINDER_SECTIONS);
    assert.deepEqual(project.investigation.selectedAdvisorProgramIds, []);
    assert.equal(project.status.schemaVersion, 2);

    const updated = await store.updateProject("test-project", {
      investigation: {
        finderSections: ["recent_research"],
        selectedAdvisorProgramIds: ["advisor-program-1"],
        selectedSections: ["guidance_group_ecology"],
        communitySources: { consented: true, refreshRequested: true },
      },
    });
    assert.deepEqual(updated.investigation.selectedAdvisorProgramIds, [
      "advisor-program-1",
    ]);
    assert.deepEqual(updated.investigation.selectedSections, [
      "guidance_group_ecology",
    ]);
    assert.equal(updated.investigation.communitySources.consented, true);

    await assert.rejects(
      readFile(
        resolve(
          project.path,
          ".agents",
          "skills",
          "advisor-detective",
          "references",
          "community-blacklist-current.pdf",
        ),
      ),
    );
    assert.equal(
      await readFile(
        resolve(
          project.path,
          ".agents",
          "skills",
          "advisor-detective",
          "references",
          "community-sources.md",
        ),
        "utf8",
      ),
      "copy",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
