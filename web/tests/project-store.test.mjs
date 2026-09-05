import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_DETECTIVE_SECTIONS,
  createProjectStore,
} from "../local-runtime/project-store.mjs";
import {
  communityRefreshEligibility,
  isInvestigationConfirmationCurrent,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";

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
      project.investigation.draft.selectedSections,
      DEFAULT_DETECTIVE_SECTIONS,
    );
    assert.deepEqual(project.investigation.draft.selectedAdvisorProgramIds, []);
    assert.equal(project.investigation.confirmed, null);
    assert.equal(project.schemaVersion, 8);
    assert.equal(project.portfolioStrategy, "balanced");
    assert.equal(project.readiness.phase1Ready, false);

    await writeFile(
      resolve(project.path, "outputs", "candidates.json"),
      JSON.stringify([
        {
          advisorProgramId: "advisor-program-1",
          name: "Test Advisor",
          program: "PhD in HCI",
          profileMatch: null,
          overallMatch: 12,
        },
      ]),
    );

    const cvPath = resolve(project.path, "inputs", "cv.pdf");
    await writeFile(cvPath, "%PDF-1.4 real CV");
    await store.setProjectCv("test-project", {
      name: "cv.pdf",
      path: cvPath,
      size: 16,
      type: "application/pdf",
    });
    const updated = await store.updateProject("test-project", {
      target: "US HCI programs",
      portfolioStrategy: "conservative",
      shortlistTarget: 15,
      interests: [{ name: "Human-AI Interaction", weight: 0 }],
      investigation: {
        draft: {
          selectedAdvisorProgramIds: ["advisor-program-1"],
          selectedSections: ["guidance_group_ecology"],
          communitySources: { requested: true },
        },
      },
    });
    assert.deepEqual(updated.investigation.draft.selectedAdvisorProgramIds, [
      "advisor-program-1",
    ]);
    assert.deepEqual(updated.investigation.draft.selectedSections, [
      "guidance_group_ecology",
    ]);
    assert.equal(updated.investigation.draft.communitySources.requested, true);
    assert.equal(updated.investigation.confirmed, null);
    assert.equal(communityRefreshEligibility(updated.investigation).allowed, false);
    assert.equal(updated.shortlistTarget, 15);
    assert.equal(updated.portfolioStrategy, "conservative");
    assert.equal(updated.candidates[0].profileMatch, null);
    assert.equal(updated.candidates[0].overallMatch, 10);
    assert.equal(updated.interests[0].weight, 100);
    assert.equal(updated.readiness.phase1Ready, true);
    assert.equal(updated.readiness.objectiveReady, false);

    const confirmed = await store.confirmInvestigation("test-project", {
      draftRevision: updated.investigation.draft.revision,
    });
    assert.deepEqual(confirmed.investigation.confirmed.selectedAdvisorProgramIds, [
      "advisor-program-1",
    ]);
    assert.equal(confirmed.investigation.confirmed.communitySources.consented, true);
    assert.equal(isInvestigationConfirmationCurrent(confirmed.investigation), true);
    assert.equal(communityRefreshEligibility(confirmed.investigation).allowed, true);
    await assert.rejects(
      store.confirmInvestigation("test-project", {}),
      /缺少有效的调查草稿版本/,
    );

    const dirty = await store.updateProject("test-project", {
      investigation: {
        draft: {
          selectedSections: ["recent_research"],
        },
      },
    });
    assert.deepEqual(dirty.investigation.confirmed.selectedSections, [
      "guidance_group_ecology",
    ]);
    assert.equal(isInvestigationConfirmationCurrent(dirty.investigation), false);
    assert.equal(communityRefreshEligibility(dirty.investigation).allowed, false);
    await assert.rejects(
      store.confirmInvestigation("test-project", {
        draftRevision: confirmed.investigation.draft.revision,
      }),
      /草稿已发生变化/,
    );

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

test("legacy selections become draft-only unless a real Detective artifact exists", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-atlas-legacy-"));
  try {
    await mkdir(resolve(root, "skills"), { recursive: true });
    const store = createProjectStore(root);
    const withoutArtifact = resolve(root, "projects", "legacy-draft");
    await mkdir(resolve(withoutArtifact, "outputs"), { recursive: true });
    await writeFile(
      resolve(withoutArtifact, "project.json"),
      JSON.stringify({
        schemaVersion: 3,
        id: "legacy-draft",
        slug: "legacy-draft",
        name: "Legacy Draft",
        investigation: {
          selectedAdvisorProgramIds: ["advisor-program-1"],
          selectedSections: ["recent_research"],
          communitySources: { consented: true },
        },
      }),
    );
    await writeFile(resolve(withoutArtifact, "outputs", "candidates.json"), "[]");
    const draftOnly = await store.getProject("legacy-draft");
    assert.deepEqual(draftOnly.investigation.draft.selectedAdvisorProgramIds, [
      "advisor-program-1",
    ]);
    assert.equal(draftOnly.investigation.confirmed, null);

    const withArtifact = resolve(root, "projects", "legacy-complete");
    await mkdir(resolve(withArtifact, "outputs"), { recursive: true });
    await writeFile(
      resolve(withArtifact, "project.json"),
      JSON.stringify({
        schemaVersion: 3,
        id: "legacy-complete",
        slug: "legacy-complete",
        name: "Legacy Complete",
        investigation: {
          selectedAdvisorProgramIds: ["advisor-program-1"],
          selectedSections: ["recent_research"],
          communitySources: { consented: false },
        },
      }),
    );
    await writeFile(resolve(withArtifact, "outputs", "candidates.json"), "[]");
    await writeFile(
      resolve(withArtifact, "outputs", "detective-results.json"),
      JSON.stringify({
        selectedSections: ["recent_research"],
        results: [{ advisorProgramId: "advisor-program-1" }],
      }),
    );
    const historical = await store.getProject("legacy-complete");
    assert.equal(historical.investigation.confirmed.source, "legacy_artifact");
    assert.deepEqual(historical.investigation.confirmed.selectedAdvisorProgramIds, [
      "advisor-program-1",
    ]);

    // A v3 consent checkbox was saved on click, so it cannot survive migration
    // as authorization. Only the artifact proves what the run actually used.
    const staleConsent = resolve(root, "projects", "legacy-stale-consent");
    await mkdir(resolve(staleConsent, "outputs"), { recursive: true });
    await writeFile(
      resolve(staleConsent, "project.json"),
      JSON.stringify({
        schemaVersion: 3,
        id: "legacy-stale-consent",
        slug: "legacy-stale-consent",
        name: "Legacy Stale Consent",
        investigation: {
          selectedAdvisorProgramIds: ["advisor-program-1"],
          selectedSections: ["guidance_group_ecology"],
          communitySources: { consented: true },
        },
      }),
    );
    await writeFile(resolve(staleConsent, "outputs", "candidates.json"), "[]");
    await writeFile(
      resolve(staleConsent, "outputs", "detective-results.json"),
      JSON.stringify({
        selectedSections: ["guidance_group_ecology"],
        communitySources: { consented: false },
        results: [{ advisorProgramId: "advisor-program-1" }],
      }),
    );
    const migratedStale = await store.getProject("legacy-stale-consent");
    assert.equal(migratedStale.investigation.confirmed.source, "legacy_artifact");
    assert.equal(
      migratedStale.investigation.confirmed.communitySources.consented,
      false,
    );
    assert.equal(
      communityRefreshEligibility(migratedStale.investigation).allowed,
      false,
    );

    // Consent recorded by the artifact itself is real and must be preserved.
    const realConsent = resolve(root, "projects", "legacy-real-consent");
    await mkdir(resolve(realConsent, "outputs"), { recursive: true });
    await writeFile(
      resolve(realConsent, "project.json"),
      JSON.stringify({
        schemaVersion: 3,
        id: "legacy-real-consent",
        slug: "legacy-real-consent",
        name: "Legacy Real Consent",
        investigation: {
          selectedAdvisorProgramIds: ["advisor-program-1"],
          selectedSections: ["guidance_group_ecology"],
          communitySources: { consented: false },
        },
      }),
    );
    await writeFile(resolve(realConsent, "outputs", "candidates.json"), "[]");
    await writeFile(
      resolve(realConsent, "outputs", "detective-results.json"),
      JSON.stringify({
        selectedSections: ["guidance_group_ecology"],
        communitySources: { consented: true },
        results: [{ advisorProgramId: "advisor-program-1" }],
      }),
    );
    const migratedReal = await store.getProject("legacy-real-consent");
    assert.equal(
      migratedReal.investigation.confirmed.communitySources.consented,
      true,
    );

    const invalidArtifact = resolve(root, "projects", "legacy-invalid-artifact");
    await mkdir(resolve(invalidArtifact, "outputs"), { recursive: true });
    await writeFile(
      resolve(invalidArtifact, "project.json"),
      JSON.stringify({
        schemaVersion: 3,
        id: "legacy-invalid-artifact",
        slug: "legacy-invalid-artifact",
        name: "Legacy Invalid Artifact",
        investigation: {
          selectedAdvisorProgramIds: ["advisor-program-1"],
          selectedSections: ["recent_research"],
        },
      }),
    );
    await writeFile(
      resolve(invalidArtifact, "outputs", "candidates.json"),
      JSON.stringify([{ advisorProgramId: "advisor-program-1", name: "Minimal" }]),
    );
    await writeFile(
      resolve(invalidArtifact, "outputs", "detective-results.json"),
      JSON.stringify({ selectedSections: ["recent_research"], results: [{}] }),
    );
    const invalidHistorical = await store.getProject("legacy-invalid-artifact");
    assert.equal(invalidHistorical.investigation.confirmed, null);
    assert.deepEqual(invalidHistorical.candidates[0].directions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
