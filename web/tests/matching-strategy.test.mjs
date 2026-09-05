import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioShortlist,
  deterministicOverallMatch,
  mergePriorSelectionForRerun,
  normalizeMatchingCandidate,
} from "../../skills/advisor-finder/scripts/apply_matching_strategy.mjs";

function candidate(id, overrides = {}) {
  return {
    advisorProgramId: id,
    name: id,
    fit: 8,
    profileMatch: 8,
    overallMatch: 8,
    competitiveness: "match",
    hardConstraintStatus: "pass",
    applicationPathway: "committee_led",
    opportunityStatus: "signal_only",
    feasibility: "eligible",
    ...overrides,
  };
}

test("matching strategy derives pathway-specific actions without inventing missing scores", () => {
  const legacy = normalizeMatchingCandidate({ advisorProgramId: "legacy" });
  assert.equal(legacy.profileMatch, null);
  assert.equal(legacy.overallMatch, null);
  assert.equal(legacy.applicationPathway, "unknown");
  assert.equal(legacy.opportunityStatus, "unknown");
  assert.equal(legacy.recommendedAction, "verify_pathway");

  assert.equal(
    normalizeMatchingCandidate(candidate("supervisor", { applicationPathway: "supervisor_led" }))
      .recommendedAction,
    "contact_supervisor",
  );
  assert.equal(
    normalizeMatchingCandidate(candidate("vacancy", {
      applicationPathway: "advertised_position",
      opportunityStatus: "verified_open",
    })).recommendedAction,
    "apply_vacancy",
  );
  assert.equal(
    normalizeMatchingCandidate(candidate("closed", { opportunityStatus: "verified_closed" }))
      .recommendedAction,
    "exclude",
  );
  assert.equal(
    normalizeMatchingCandidate(candidate("constraint", { hardConstraintStatus: "unknown" }))
      .recommendedAction,
    "verify_constraints",
  );
  assert.equal(
    normalizeMatchingCandidate(candidate("eligibility", { feasibility: "needs_confirmation" }))
      .recommendedAction,
    "verify_eligibility",
  );
});

test("overall match is deterministic and stays unknown when a component is missing", () => {
  assert.equal(deterministicOverallMatch(9, 7), 8.2);
  assert.equal(deterministicOverallMatch(9, null), null);
  const overwritten = normalizeMatchingCandidate(candidate("formula", {
    fit: 9,
    profileMatch: 7,
    overallMatch: 10,
  }));
  assert.equal(overwritten.overallMatch, 8.2);
});

test("balanced shortlist enforces hard exclusions, requested size, and a reach cap", () => {
  const input = [
    candidate("reach-1", { competitiveness: "reach", overallMatch: 10 }),
    candidate("reach-2", { competitiveness: "reach", overallMatch: 9.8 }),
    candidate("reach-3", { competitiveness: "reach", overallMatch: 9.6 }),
    candidate("match-1", { overallMatch: 9.2 }),
    candidate("match-2", { overallMatch: 9 }),
    candidate("safe-1", { competitiveness: "safer", overallMatch: 8.8 }),
    candidate("safe-2", { competitiveness: "safer", overallMatch: 8.6 }),
    candidate("outside", { hardConstraintStatus: "fail", overallMatch: 10 }),
  ];
  const result = buildPortfolioShortlist(input, {
    shortlistTarget: 5,
    portfolioStrategy: "balanced",
  });
  assert.equal(result.selected.length, 5);
  assert.equal(result.audit.reachCap, 1);
  assert.equal(result.audit.reachCount, 1);
  assert.ok(!result.selected.some((row) => row.advisorProgramId === "outside"));
  assert.equal(
    result.excluded.find((row) => row.advisorProgramId === "outside")?.exclusionReason,
    "hard_constraint",
  );
});

test("a project with no explicit hard constraints does not invent a verification task", () => {
  const result = buildPortfolioShortlist(
    [candidate("no-extra-constraints", { hardConstraintStatus: "unknown" })],
    { shortlistTarget: 5, portfolioStrategy: "balanced", hardConstraints: "" },
  );
  assert.equal(result.selected[0].hardConstraintStatus, "pass");
  assert.equal(result.selected[0].recommendedAction, "apply_program");
});

test("portfolio audit reports when the real pool cannot satisfy the requested mix", () => {
  const result = buildPortfolioShortlist(
    Array.from({ length: 5 }, (_, index) =>
      candidate(`reach-${index}`, { competitiveness: "reach", overallMatch: 10 - index }),
    ),
    { shortlistTarget: 5, portfolioStrategy: "balanced" },
  );
  assert.equal(result.selected.length, 5);
  assert.equal(result.audit.reachCount, 5);
  assert.equal(result.audit.portfolioDeviation, "insufficient_non_reach_candidates");
});

test("matching strategy refuses ambiguous candidate identities", () => {
  assert.throws(
    () => buildPortfolioShortlist([candidate("same"), candidate("same")]),
    /advisorProgramId 有重复/,
  );
  assert.throws(
    () => buildPortfolioShortlist([candidate("")]),
    /缺少稳定的 advisorProgramId/,
  );
});

test("rerunning a selected portfolio preserves prior exclusions without mixing a fresh pool", () => {
  const initial = buildPortfolioShortlist(
    [candidate("selected"), candidate("hard-fail", { hardConstraintStatus: "fail" })],
    { shortlistTarget: 5, hardConstraints: "仅欧洲" },
  );
  const merged = mergePriorSelectionForRerun(initial.selected, initial.excluded);
  assert.equal(merged.length, 2);
  const rerun = buildPortfolioShortlist(merged, {
    shortlistTarget: 5,
    hardConstraints: "仅欧洲",
  });
  assert.equal(rerun.audit.inputCount, 2);
  assert.equal(rerun.excluded[0].advisorProgramId, "hard-fail");

  const fresh = [candidate("new-pool")];
  assert.deepEqual(mergePriorSelectionForRerun(fresh, initial.excluded), fresh);
});
