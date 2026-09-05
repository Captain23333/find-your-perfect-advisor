# Applicant-advisor matching strategy

Read this reference when creating, filtering, or ranking Finder candidates. The
contract is pathway-first and evidence-bounded; it does not estimate admission
probability.

## Required order

1. Classify the official application pathway.
2. Apply explicit user hard constraints.
3. Score research fit from recent work.
4. Assess applicant-relative profile match from the real CV.
5. Record current opportunity evidence.
6. Label competitiveness and compute an explainable overall match.
7. Run the deterministic portfolio selector.
8. Route the next action by application pathway.

Do not let a later score override an earlier hard failure.
After exclusions, resolve an unknown pathway first, then unknown hard
constraints, then unresolved objective eligibility, before recommending an
application or contact action.

## Application pathway

Use one value per advisor-program row:

- `supervisor_led`: the official process expects or materially depends on a
  supervisor's agreement. Recommended action: `contact_supervisor`.
- `committee_led`: the program admits through a committee and direct faculty
  contact is not required or not decisive. Recommended action: `apply_program`.
- `advertised_position`: recruitment is tied to a specific funded vacancy or
  project. Use `apply_vacancy` only with a current opening; otherwise `monitor`.
- `structured_program`: a cohort or doctoral-school route assigns or develops
  supervision through the program. Recommended action: `apply_program`.
- `unknown`: official evidence is insufficient. Recommended action:
  `verify_pathway`.

Do not interpret a missing reply as rejection for committee-led or structured
programs. Do not send generic supervisor outreach for a vacancy that specifies
another application route.

## Hard constraints and opportunity evidence

`hardConstraintStatus` is `pass`, `fail`, or `unknown`, with a list of exact
reasons and evidence IDs. Unknown never means pass.
When the project has no explicit additional hard constraints, the deterministic
selector normalizes this gate to `pass`; it must not invent a condition to
verify.

`opportunityStatus` is:

- `verified_open`: a current official opening or explicit recruiting statement.
- `signal_only`: recent funding, project, or lab-growth evidence that warrants
  checking but does not prove an opening.
- `unknown`: no current decisive evidence.
- `verified_closed`: a current official statement that the relevant route is
  closed or the vacancy has ended.

School prestige, rank, advisor nationality or ethnicity, alumni identity,
title, age, and “young professor” are not opportunity evidence. A title may
trigger further checking of lab stage, funding, and official rules, but cannot
raise a candidate by itself.

## Scores and labels

- `fit`: 0–10 research-topic/method fit, supported by current work.
- `profileMatch`: 0–10 match between the applicant's evidenced methods,
  publications, projects, prerequisites, and transferable skills and the
  target opportunity.
- `overallMatch`: deterministic `0.60 * fit + 0.40 * profileMatch`, rounded to
  one decimal. Hard constraints, eligibility, pathway, and opportunity remain
  separate gates or evidence and are never hidden inside this number. It is not
  a probability.
- `competitiveness`: `reach`, `match`, `safer`, or `unknown`, relative to the
  applicant and route. These labels plan a portfolio; they do not promise an
  offer.

Keep missing component scores as `null`; if either component is missing,
`overallMatch` is also `null`. Never coerce unknown to zero or preserve a
model-supplied total in place of the deterministic result.

## Deterministic portfolio selection

After writing the full eligible candidate pool to `outputs/candidates.json`,
run:

```bash
node .agents/skills/advisor-finder/scripts/apply_matching_strategy.mjs --project-root "$PWD"
```

Use the equivalent `.claude/skills/` path in Claude Code. The script applies
hard exclusions, stable ordering, shortlist size, and the selected reach cap;
it writes selected rows back to `outputs/candidates.json`, non-selected and
excluded rows to `outputs/candidates-excluded.json`, and an auditable summary
to `outputs/matching-audit.json`.

Do not hand-edit the selected portfolio after this step. If the real pool
cannot satisfy the requested mix, preserve the real candidates and the audit's
deviation instead of inventing safer options.

The script is idempotent: rerunning its already selected output merges the
previous `candidates-excluded.json` before recalculating, so hard exclusions
and audit counts are preserved. A newly written unscreened pool does not carry
old exclusions forward.
