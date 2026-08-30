import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApplicationMaterialTaskPrompt,
  buildInvestigationTaskPrompt,
  buildPhaseOneTaskPrompt,
  buildRankingTaskPrompt,
} from "../app/run-task-prompts.mjs";
import { buildRunPrompt, MODE_SKILLS } from "../local-runtime/run-prompt.mjs";

const project = {
  path: "/tmp/advisor-project",
  shortlistTarget: 10,
  investigation: {
    confirmed: {
      selectedAdvisorProgramIds: ["ap-1"],
      selectedSections: ["recent_research"],
      communitySources: { consented: false },
      revision: 2,
      fingerprint: "detective-fingerprint",
    },
  },
  applicationMaterials: {
    confirmed: {
      advisorProgramId: "ap-1",
      materials: ["research_proposal", "outreach_email"],
      order: ["research_proposal", "outreach_email"],
      revision: 4,
      fingerprint: "material-fingerprint",
    },
  },
};

function prompt(mode, provider = "codex") {
  return buildRunPrompt({
    userPrompt: `run ${mode}`,
    project,
    runDirectory: "/tmp/advisor-project/runs/run-1",
    provider,
    mode,
    confirmedMaterialRanking: { advisorProgramId: "ap-1", name: "Real Advisor" },
  });
}

test("each run loads the exact phase skill instead of the full pipeline", () => {
  for (const [mode, skill] of Object.entries(MODE_SKILLS)) {
    const value = prompt(mode);
    assert.match(value, new RegExp(`\\.agents/skills/${skill}/SKILL\\.md`));
    assert.doesNotMatch(value, /skills\/advisor-pipeline\/SKILL\.md/);
  }
  assert.match(prompt("detective", "claude"), /\.claude\/skills\/advisor-detective\/SKILL\.md/);
});

test("the real Web Phase 1 prompt does not re-introduce the pipeline skill", () => {
  const userPrompt = buildPhaseOneTaskPrompt({ project });
  const effectivePrompt = buildRunPrompt({
    userPrompt,
    project,
    runDirectory: "/tmp/advisor-project/runs/run-1",
    provider: "codex",
    mode: "finder",
  });
  assert.match(effectivePrompt, /\.agents\/skills\/advisor-finder\/SKILL\.md/);
  assert.doesNotMatch(effectivePrompt, /skills\/advisor-pipeline\/SKILL\.md/);
  assert.match(effectivePrompt, /从 Phase 1 开始导师匹配/);
});

test("every real Web task prompt leaves Skill routing to the runtime", () => {
  const userPrompts = {
    finder: buildPhaseOneTaskPrompt({ project }),
    detective: buildInvestigationTaskPrompt(),
    ranking: buildRankingTaskPrompt(),
    research_proposal: buildApplicationMaterialTaskPrompt("research_proposal"),
    outreach_email: buildApplicationMaterialTaskPrompt("outreach_email"),
  };

  for (const [mode, userPrompt] of Object.entries(userPrompts)) {
    assert.doesNotMatch(userPrompt, /SKILL\.md|skills\//);
    const value = buildRunPrompt({
      userPrompt,
      project,
      runDirectory: "/tmp/advisor-project/runs/run-1",
      provider: "codex",
      mode,
      confirmedMaterialRanking: { advisorProgramId: "ap-1", name: "Real Advisor" },
    });
    assert.match(value, new RegExp(`\\.agents/skills/${MODE_SKILLS[mode]}/SKILL\\.md`));
    assert.doesNotMatch(value, /skills\/advisor-pipeline\/SKILL\.md/);
    assert.ok(value.length < 4_000, `${mode} Web prompt grew to ${value.length} characters`);
  }
});

test("finder receives discovery constraints but no later-phase payloads", () => {
  const value = prompt("finder");
  assert.match(value, /真实 CV/);
  assert.match(value, /shortlist 数量为 10/);
  assert.match(value, /candidates\.json/);
  assert.match(value, /input\.requested/);
  assert.match(value, /字段 cv/);
  assert.doesNotMatch(value, /detective-fingerprint|material-fingerprint/);
  assert.doesNotMatch(value, /proposal-build\.json|outreach-email\.txt/);
});

test("detective receives only its confirmation and evidence boundary", () => {
  const value = prompt("detective");
  assert.match(value, /detective-fingerprint/);
  assert.match(value, /selectedAdvisorProgramIds/);
  assert.match(value, /anonymous_lead/);
  assert.doesNotMatch(value, /material-fingerprint|proposal-build\.json/);
  assert.doesNotMatch(value, /shortlist 数量/);
});

test("ranking avoids discovery and application-material instructions", () => {
  const value = prompt("ranking");
  assert.match(value, /研究匹配、客观可行性和导师适合度/);
  assert.match(value, /outputs\/ranking\.json/);
  assert.doesNotMatch(value, /detective-fingerprint|material-fingerprint/);
  assert.doesNotMatch(value, /candidates 每行|outreach-email\.txt/);
});

test("material prompts share the exact target but keep mode-only delivery rules", () => {
  const proposal = prompt("research_proposal");
  const outreach = prompt("outreach_email");
  for (const value of [proposal, outreach]) {
    assert.match(value, /material-fingerprint/);
    assert.match(value, /Real Advisor/);
    assert.match(value, /advisor_work/);
    assert.doesNotMatch(value, /detective-fingerprint|shortlist 数量/);
  }
  assert.match(proposal, /proposal-build\.json/);
  assert.doesNotMatch(proposal, /outreach-email\.txt/);
  assert.match(outreach, /outreach-email\.txt/);
  assert.doesNotMatch(outreach, /proposal-build\.json/);
});

test("mode prompts remain compact while preserving the user request", () => {
  for (const mode of Object.keys(MODE_SKILLS)) {
    const value = prompt(mode);
    assert.ok(value.startsWith(`run ${mode}`));
    assert.ok(value.length < 4_000, `${mode} prompt grew to ${value.length} characters`);
  }
});
