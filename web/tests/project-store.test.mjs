import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_DETECTIVE_SECTIONS,
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
    assert.deepEqual(
      project.investigation.selectedSections,
      DEFAULT_DETECTIVE_SECTIONS,
    );
    assert.deepEqual(project.investigation.selectedAdvisorProgramIds, []);
    assert.equal(project.schemaVersion, 3);
    assert.equal(project.readiness.phase1Ready, false);

    const updated = await store.updateProject("test-project", {
      target: "US HCI programs",
      shortlistTarget: 15,
      interests: [{ name: "Human-AI Interaction", weight: 0 }],
      investigation: {
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
    assert.equal(updated.shortlistTarget, 15);
    assert.equal(updated.interests[0].weight, 100);
    assert.equal(updated.readiness.phase1Ready, true);
    assert.equal(updated.readiness.objectiveReady, false);

    await writeFile(
      resolve(project.path, "outputs", "detective-results.json"),
      JSON.stringify({
        selectedSections: ["recent_research"],
        results: [
          {
            advisorProgramId: "advisor-program-1",
            name: "Test Advisor",
            sections: {
              recent_research: {
                summary: "Verified recent work",
                sourceIds: ["source-1"],
              },
            },
            evidenceCount: 1,
          },
        ],
        evidenceCount: 1,
        evidenceCoverage: 100,
      }),
    );
    await writeFile(
      resolve(project.path, "outputs", "ranking.json"),
      JSON.stringify({
        rankings: [
          {
            advisorProgramId: "advisor-program-1",
            rank: 1,
            name: "Test Advisor",
            totalScore: 8.5,
            evidenceGaps: ["Recruiting status"],
          },
        ],
      }),
    );
    const withResults = await store.getProject("test-project");
    assert.equal(withResults.detectiveResults.results[0].name, "Test Advisor");
    assert.equal(withResults.rankings[0].totalScore, 8.5);
    assert.deepEqual(withResults.rankings[0].evidenceGaps, ["Recruiting status"]);

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
