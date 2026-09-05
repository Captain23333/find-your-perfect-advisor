---
name: advisor-finder
description: >
  Find and shortlist real academic advisors from an applicant CV and target
  scope for PhD, MPhil, MS, Postdoc, or RA applications. Score research fit,
  map shortlisted advisors to programs, verify objective application facts,
  and produce source-backed candidate records and a workbook.
---

# Advisor Finder

Discover broadly, shortlist by research fit, then complete objective application
facts only for the shortlist. Never repeat a page lookup when a current,
field-level source record already supports the needed fact.

## Inputs

Require to start Phase 1:

- Target schools, regions, departments, or ranking scope.
- A real, readable CV for the actual applicant. A research-interest list alone
  is not a substitute because fit, transferability, and competitiveness are
  applicant-relative judgments.

First resolve an existing project CV from `project.json.cv`, `inputs/`, or an
explicit path already supplied by the user. Reuse it without asking for another
upload. Request a CV only when no usable current-applicant CV can be found, or
request a replacement when the stored file is unreadable, clearly a sample, or
belongs to someone else.

Target degree and intake may be added after discovery, but require them before
the objective application-feasibility pass. Research-interest weights are
optional. If interests exist without weights, use equal weights; if partial
weights are supplied, normalize them transparently.

Accept optional hard constraints such as full funding, maximum tuition, ranking
cutoff, location, or excluded institutions. Accept a user-selected
`shortlistTarget` from 5 to 50, defaulting to 10. Preserve hard constraints
separately.

Also read the project's `portfolioStrategy`: `balanced`, `conservative`, or
`ambitious`. Treat this as a desired application-portfolio shape, not as an
admission probability. When it is absent, use `balanced`.

If the complete Advisor Atlas skill set is present, read
`../advisor-pipeline/references/core-data-contract.md` before structured writes.
Read `references/matching-strategy.md` before classifying, filtering, or ranking
candidates.
Read `references/application-facts.md` only when the shortlist is ready for the
objective feasibility pass.

## Output state

Write structured records to:

- `outputs/advisor_records.json`
- `outputs/program_records.json`
- `outputs/evidence.json`
- `outputs/candidates.json`

Maintain `ADVISOR_STATE.md` only as a compact, human-readable progress summary.
Structured JSON is the source of truth.

## Workflow

### 1. Intake and normalize

1. Parse education, skills, publications, projects, awards, and research
   interests from the real CV.
2. Combine CV-derived signals with any user-entered research interests. Do not
   require the user to repeat interests already clear from the CV.
3. If no existing CV can be resolved, or it is unreadable, clearly a sample, or
   belongs to a different person than the user identifies, stop before
   discovery and request a real CV. Do not ask again when the project's current
   CV has already passed these checks.
4. Confirm the target scope and `shortlistTarget`.
5. Record degree, intake, and hard constraints when present. If degree or intake
   is missing, discovery may continue but the objective screen must pause.

### 2. Broad discovery

Size the roster to the user's actual scope:

- For one explicitly named school, department, institute, or lab, cover the
  complete plausible official roster without padding it to an arbitrary
  minimum. Aim for roughly `shortlistTarget * 2` when that many relevant,
  currently eligible advisors exist.
- For broad multi-school or regional searches, aim for roughly
  `shortlistTarget * 3`, capped at 60.

Use official faculty pages,
targeted search, Scholar, dblp, OpenReview, or field directories. Record only:

- Name, institution, department, current role, homepage, and stable `advisor_id`.
- High-level recent research, two or three representative recent works, initial
  relevance, and an official recruiting signal when readily available.
- Facts encountered incidentally, with sources.

These are fixed low-cost Finder facts, not user-selectable Detective sections.
Do not perform full application research, community-opinion research, group
ecology research, or broad social investigation at this stage.

### 3. Research profile and fit

Prioritize up to `MAX_ADVISORS` for profiling.

Use current personal/lab pages plus recent publication records. A stale homepage
does not imply an inactive researcher; use Scholar, dblp, publication pages, or
OpenReview for recent work.

For each selected or CV-derived research interest, score 0–10 with short
supporting evidence:

- 9–10: current core focus with strong recent evidence.
- 6–8: active secondary direction.
- 4–5: adjacent transferable work.
- 2–3: occasional involvement.
- 0–1: no meaningful connection.

Compute the weighted or equal-weight research-fit score transparently. Keep QS
rank, tuition, scholarships, deadlines, and community opinions out of this
score. Separately assess applicant-relative profile match from CV evidence
(methods, publications, projects, prerequisites, and transferable skills).
Never infer low or high admission probability from prestige alone.

### 4. Shortlist

Classify the official application pathway before scoring. Apply explicit hard
constraints before shortlist scores, keeping unsupported conditions `unknown`.
Then select up to `shortlistTarget` research-relevant advisors for objective
feasibility research and label each advisor-program `reach`, `match`, `safer`,
or `unknown` relative to the applicant's evidenced profile. Follow the
deterministic portfolio rule in `references/matching-strategy.md`; preserve
excluded candidates and reasons. Do not deep-profile all discovery rows merely
to fill an output.

### 5. Program mapping and objective facts

For every shortlisted advisor:

1. Confirm that target degree and intake are present. If either is missing,
   preserve the shortlist and pause for only those fields.
2. Identify each real school, program, degree, and intake through which the user
   could apply.
3. Reuse application facts already encountered.
4. Search only missing or stale fields from official sources.
5. Store school/program facts once in `program_records.json`; join them to all
   relevant advisors.
6. Store variable application materials and advisor contact requirements as
   multiline text, not invented Boolean fields.

### 6. Objective feasibility gate

Return one state per advisor-program combination:

- `eligible`
- `ineligible`
- `needs_confirmation`

Include exact reasons and source IDs. Apply only explicit hard conditions as
automatic failures. Treat missing recruiting, funding, or RP information as a
warning, not proof of absence.

Ask the user which eligible or unresolved advisor-program combinations should
continue to Advisor Detective.

### 7. Candidate output

Write compact Web rows to `outputs/candidates.json`. Each row must include a
stable `advisorProgramId`, not only a name:

```json
{
  "advisorProgramId": "stable-id",
  "rank": 1,
  "initials": "AB",
  "name": "Real name",
  "school": "Real institution",
  "program": "Official program",
  "fit": 0.0,
  "profileMatch": 0.0,
  "competitiveness": "reach|match|safer|unknown",
  "overallMatch": 0.0,
  "matchReasons": [],
  "hardConstraintStatus": "pass|fail|unknown",
  "hardConstraintReasons": [],
  "applicationPathway": "supervisor_led|committee_led|advertised_position|structured_program|unknown",
  "opportunityStatus": "verified_open|signal_only|unknown|verified_closed",
  "recommendedAction": "apply_vacancy|contact_supervisor|apply_program|monitor|exclude|verify_constraints|verify_eligibility|verify_pathway",
  "status": "Open or needs confirmation",
  "statusTone": "open|caution|closed|unknown",
  "feasibility": "eligible|ineligible|needs_confirmation",
  "feasibilityReasons": [],
  "directions": [],
  "evidence": 0
}
```

`fit` remains research-only. The deterministic selector recalculates
`overallMatch` as `0.60 * fit + 0.40 * profileMatch`; hard constraints,
feasibility, pathway, and opportunity remain separate gates/evidence, while
portfolio shape controls selection rather than the score. Unknown values
remain `null` or `unknown`, never zero. School rank, prestige, title, age,
nationality, ethnicity, or alumni identity cannot substitute for applicant fit
or current opportunity evidence.

Keep the component scores visible. After writing the candidate pool, run
`scripts/apply_matching_strategy.mjs --project-root "$PWD"`. Its selected
`candidates.json`, excluded-candidate file, and matching audit are required
Finder outputs and must not be overridden manually.

Generate `advisor_shortlist_YYYYMMDD.xlsx` with
`scripts/build_advisor_excel.mjs`. The shipped builder automatically uses the
Codex spreadsheet runtime when available and its bundled portable OOXML engine
otherwise. Do not install spreadsheet packages, create a replacement builder,
or patch an ad-hoc executable in `runs/`. Prepare only the builder's JSON input,
run the shipped script once, and report a clear partial result if it still
fails. Do not draft outreach content until advisor-specific contact
requirements have been checked.

## Quality rules

- Cite every material claim.
- Use `verified`, `not_found`, `not_checked`, `conflict`, and `stale`
  consistently.
- Never turn access failure, skipped research, or failed PDF extraction into
  “no requirement” or “no record”.
- Verify recruiting for the target degree.
- Preserve filtered candidates and exact exclusion evidence.
- Stop and report missing real input instead of inventing CV details, advisors,
  programs, or application facts.
