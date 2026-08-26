import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  confirmApplicationMaterialsDraft,
  isApplicationMaterialsConfirmationCurrent,
  normalizeApplicationMaterials,
  updateApplicationMaterialsDraft,
  validateApplicationMaterialsDraft,
} from "../../skills/advisor-pipeline/scripts/project-contract.mjs";
import { verifyApplicationMaterialArtifacts } from "../../skills/advisor-pipeline/scripts/application-materials-artifacts.mjs";
import { downloadPdf, fetchOpenLiterature } from "../../skills/advisor-pipeline/scripts/fetch_open_literature.mjs";
import { createProjectStore } from "../local-runtime/project-store.mjs";
import { verifyRunArtifacts } from "../local-runtime/run-artifacts.mjs";

test("application materials require an exact ranked target and revision-bound confirmation", () => {
  const start = normalizeApplicationMaterials(null, "2026-01-01T00:00:00.000Z");
  assert.equal(start.draft.advisorProgramId, "");
  assert.deepEqual(start.draft.materials, []);

  const draft = updateApplicationMaterialsDraft(
    start,
    {
      advisorProgramId: "advisor__program",
      materials: ["research_proposal", "outreach_email"],
      order: ["research_proposal", "outreach_email"],
    },
    "2026-01-02T00:00:00.000Z",
  );
  assert.equal(draft.draft.revision, 1);
  assert.equal(
    validateApplicationMaterialsDraft(draft, [
      { advisorProgramId: "advisor__program" },
    ]).valid,
    true,
  );
  assert.equal(validateApplicationMaterialsDraft(draft, []).valid, false);
  const unsafeDraft = updateApplicationMaterialsDraft(start, {
    advisorProgramId: "../../outside",
    materials: ["research_proposal"],
    order: ["research_proposal"],
  });
  assert.equal(
    validateApplicationMaterialsDraft(unsafeDraft, [
      { advisorProgramId: "../../outside" },
    ]).valid,
    false,
  );

  const confirmed = confirmApplicationMaterialsDraft(draft, {
    expectedRevision: 1,
    now: "2026-01-03T00:00:00.000Z",
  });
  assert.equal(isApplicationMaterialsConfirmationCurrent(confirmed), true);
  const changed = updateApplicationMaterialsDraft(confirmed, {
    advisorProgramId: "advisor__program",
    materials: ["outreach_email"],
    order: ["outreach_email"],
  });
  assert.equal(isApplicationMaterialsConfirmationCurrent(changed), false);
  assert.throws(
    () => confirmApplicationMaterialsDraft(changed, { expectedRevision: 1 }),
    (error) => error.code === "STALE_DRAFT",
  );
});

test("literature downloads reject unsafe targets and re-check redirects", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-material-fetch-"));
  try {
    const sourceFile = resolve(root, "sources.json");
    await writeFile(sourceFile, JSON.stringify({ sources: [] }));
    await assert.rejects(
      fetchOpenLiterature({
        root,
        advisorProgramId: "../../outside",
        sourceFile: "sources.json",
        confirmedRevision: 1,
        confirmedFingerprint: "fp",
      }),
      /安全的 advisorProgramId/,
    );

    let calls = 0;
    await assert.rejects(
      downloadPdf("https://example.org/public.pdf", async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private.pdf" },
        });
      }),
      /不允许指向本机、私网或裸 IP/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      downloadPdf("http://[::1]/private.pdf", async () => {
        throw new Error("private URL must fail before fetch");
      }),
      /不允许指向本机、私网或裸 IP/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a material artifact is complete only with both literature classes and verified local PDFs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-material-artifact-"));
  const advisorProgramId = "advisor__program";
  const target = resolve(root, "outputs", "application-materials", advisorProgramId);
  const literature = resolve(target, "literature");
  try {
    await mkdir(resolve(literature, "advisor-work"), { recursive: true });
    await mkdir(resolve(literature, "field-work"), { recursive: true });
    const advisorPdf = Buffer.from("%PDF-1.4\nadvisor paper\n%%EOF");
    const fieldPdf = Buffer.from("%PDF-1.4\nfield paper\n%%EOF");
    await writeFile(resolve(literature, "advisor-work", "LIT-A01.pdf"), advisorPdf);
    await writeFile(resolve(literature, "field-work", "LIT-F01.pdf"), fieldPdf);
    const source = (literatureId, category, bytes, localPath) => ({
      literatureId,
      category,
      title: `${literatureId} title`,
      authors: category === "advisor_work" ? ["Advisor Name"] : ["Independent Author"],
      year: 2025,
      canonicalUrl: `https://example.org/${literatureId}`,
      downloadUrl: `https://example.org/${literatureId}.pdf`,
      accessBasis: "author_public_copy",
      accessStatus: "downloaded_open_access",
      mediaType: "application/pdf",
      localPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      inspectionLevel: "full_text",
      ...(category === "advisor_work"
        ? {
            advisorRelationship: {
              type: "advisor_author",
              advisorName: "Advisor Name",
              matchedAuthors: ["Advisor Name"],
              evidenceUrl: `https://example.org/${literatureId}`,
              note: "The selected advisor appears in the author list.",
            },
          }
        : {
            independenceNote: "The selected advisor is not in the author list.",
          }),
      usedIn: ["research_proposal", "outreach_email"],
    });
    await writeFile(
      resolve(literature, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        advisorProgramId,
        confirmedRevision: 2,
        confirmedFingerprint: "fp",
        targetAdvisorName: "Advisor Name",
        generatedAt: "2026-01-03T00:00:00.000Z",
        sources: [
          source("LIT-A01", "advisor_work", advisorPdf, "literature/advisor-work/LIT-A01.pdf"),
          source("LIT-F01", "field_work", fieldPdf, "literature/field-work/LIT-F01.pdf"),
        ],
      }),
    );
    const proposalTex = String.raw`\documentclass{article}
\begin{document}
Advisor evidence \cite{LIT-A01}; field evidence \cite{LIT-F01}.
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`;
    const referencesBib = `@article{LIT-A01, title={Advisor paper}, author={Advisor Name}}\n@article{LIT-F01, title={Field paper}, author={Independent Author}}\n`;
    const proposalPdf = Buffer.from("%PDF-1.4\nproposal\n%%EOF");
    await writeFile(resolve(target, "research-proposal.tex"), proposalTex);
    await writeFile(resolve(target, "references.bib"), referencesBib);
    await writeFile(resolve(target, "research-proposal.pdf"), proposalPdf);
    await writeFile(
      resolve(target, "proposal-build.json"),
      JSON.stringify({
        schemaVersion: 1,
        advisorProgramId,
        confirmedRevision: 2,
        confirmedFingerprint: "fp",
        builtAt: "2026-01-03T00:00:00.000Z",
        engine: "latexmk-pdf-bibtex",
        texSha256: createHash("sha256").update(Buffer.from(proposalTex)).digest("hex"),
        bibSha256: createHash("sha256").update(Buffer.from(referencesBib)).digest("hex"),
        pdfSha256: createHash("sha256").update(proposalPdf).digest("hex"),
        pdfBytes: proposalPdf.length,
      }),
    );
    await writeFile(resolve(target, "proposal-evidence.md"), "LIT-A01\nLIT-F01\n");
    await writeFile(resolve(target, "proposal-review.md"), "# Review\n");

    const missingApplicant = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
    });
    assert.equal(missingApplicant.complete, false);
    assert.match(missingApplicant.missing.join(" "), /真实 CV/);
    assert.match(missingApplicant.missing.join(" "), /申请者真实姓名/);

    const complete = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
      applicantName: "Ada Lovelace",
      cvValid: true,
      startedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(complete.complete, true, complete.missing.join("\n"));
    assert.equal(complete.literature.length, 2);

    const completedRun = await verifyRunArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
      applicantName: "Ada Lovelace",
      cvValid: true,
      startedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(completedRun.complete, true, completedRun.missing.join("\n"));

    const unsafeTarget = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId: "../../outside",
      applicantName: "Ada Lovelace",
      cvValid: true,
    });
    assert.equal(unsafeTarget.complete, false);
    assert.match(unsafeTarget.missing.join(" "), /不安全的路径字符/);

    await writeFile(
      resolve(target, "outreach-email.txt"),
      "Subject: Research fit\n\nDear Professor,\n...\n\nBest,\nSample Name\n",
    );
    await writeFile(resolve(target, "outreach-audit.md"), "LIT-A01\nLIT-F01\n");
    const wrongSignature = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "outreach_email",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
      applicantName: "Ada Lovelace",
      cvValid: true,
    });
    assert.equal(wrongSignature.complete, false);
    assert.match(wrongSignature.missing.join(" "), /真实姓名签名/);
    await writeFile(
      resolve(target, "outreach-email.txt"),
      "Subject: Research fit\n\nDear Professor,\n...\n\nBest,\nAda Lovelace\n",
    );
    const signedOutreach = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "outreach_email",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
      applicantName: "Ada Lovelace",
      cvValid: true,
    });
    assert.equal(signedOutreach.complete, true, signedOutreach.missing.join("\n"));

    await writeFile(
      resolve(target, "research-proposal.tex"),
      `${proposalTex}\n% DO NOT SUBMIT\n`,
    );
    const unprofessional = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
      applicantName: "Ada Lovelace",
      cvValid: true,
    });
    assert.equal(unprofessional.complete, false);
    assert.ok(unprofessional.missing.some((item) => item.includes("内部 QA/禁用标记")));
    await writeFile(resolve(target, "research-proposal.tex"), proposalTex);

    const brokenManifest = JSON.parse(
      await readFile(resolve(literature, "manifest.json"), "utf8"),
    );
    brokenManifest.sources[0].advisorRelationship.advisorName = "Different Advisor";
    await writeFile(resolve(literature, "manifest.json"), JSON.stringify(brokenManifest));
    const mismatchedAdvisor = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      expectedAdvisorName: "Advisor Name",
      applicantName: "Ada Lovelace",
      cvValid: true,
    });
    assert.equal(mismatchedAdvisor.complete, false);
    assert.ok(
      mismatchedAdvisor.missing.some((item) => item.includes("未绑定当前目标导师")),
    );

    brokenManifest.sources[0].advisorRelationship.advisorName = "Advisor Name";
    brokenManifest.sources = brokenManifest.sources.filter(
      (item) => item.category !== "field_work",
    );
    await writeFile(resolve(literature, "manifest.json"), JSON.stringify(brokenManifest));
    const partial = await verifyApplicationMaterialArtifacts({
      projectPath: root,
      mode: "research_proposal",
      advisorProgramId,
      confirmedRevision: 2,
      confirmedFingerprint: "fp",
      applicantName: "Ada Lovelace",
      cvValid: true,
    });
    assert.equal(partial.complete, false);
    assert.ok(partial.missing.some((item) => item.includes("领域文献")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Web project store reuses one project CV across later material stages", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "advisor-material-store-"));
  await mkdir(resolve(root, "skills"), { recursive: true });
  const store = createProjectStore(root);
  try {
    const project = await store.createProject({ name: "T", slug: "materials-project" });
    await writeFile(
      resolve(project.path, "outputs", "ranking.json"),
      JSON.stringify({ rankings: [{ advisorProgramId: "advisor__program", rank: 1 }] }),
    );
    const saved = await store.updateProject("materials-project", {
      applicationMaterials: {
        advisorProgramId: "advisor__program",
        materials: ["research_proposal", "outreach_email"],
        order: ["research_proposal", "outreach_email"],
      },
    });
    assert.equal(saved.applicationMaterials.confirmed, null);
    assert.equal(saved.readiness.modes.research_proposal.ready, false);
    const confirmed = await store.confirmApplicationMaterials("materials-project", {
      draftRevision: saved.applicationMaterials.draft.revision,
    });
    assert.equal(confirmed.applicationMaterials.confirmed.advisorProgramId, "advisor__program");
    assert.equal(confirmed.readiness.modes.research_proposal.ready, false);
    assert.match(confirmed.readiness.modes.research_proposal.missing.join(" "), /真实 CV/);
    assert.match(confirmed.readiness.modes.research_proposal.missing.join(" "), /真实姓名/);

    const placeholder = await store.updateProject("materials-project", {
      applicantName: "Your Name",
    });
    assert.match(placeholder.readiness.modes.research_proposal.missing.join(" "), /真实姓名/);
    await store.updateProject("materials-project", { applicantName: "Ada Lovelace" });
    const cvPath = resolve(project.path, "inputs", "cv.pdf");
    await writeFile(cvPath, "%PDF-1.4 real CV");
    await store.setProjectCv("materials-project", {
      name: "cv.pdf",
      path: cvPath,
      size: 16,
      type: "application/pdf",
    });
    const unlocked = await store.getProject("materials-project");
    assert.equal(unlocked.readiness.modes.research_proposal.ready, true);
    assert.equal(unlocked.cv.valid, true);
    const persistedCvPath = unlocked.cv.path;

    // Later project reads and application-material stages reuse the single CV
    // uploaded at intake; no second upload or phase-specific CV is required.
    const resumed = await store.getProject("materials-project");
    assert.equal(resumed.cv.path, persistedCvPath);
    assert.equal(resumed.cv.valid, true);
    assert.equal(resumed.readiness.modes.research_proposal.ready, true);
    assert.doesNotMatch(
      resumed.readiness.modes.research_proposal.missing.join(" "),
      /CV|简历/i,
    );
    assert.equal(unlocked.readiness.modes.outreach_email.ready, false);
    assert.match(unlocked.readiness.modes.outreach_email.missing.join(" "), /research_proposal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
