---
name: advisor-finder
description: >
  Find and shortlist academic advisors for PhD, MPhil, MS, Postdoc, or RA
  applications. Use when a user asks to find professors, supervisors, mentors,
  or suitable programs from a CV and research interests. Discover real
  candidates, score research fit, map advisors to application programs, collect
  official objective application facts for the shortlist, and produce a
  source-backed candidate workbook.
---

# Advisor Finder

Discover broadly, shortlist by research fit, then complete objective application
facts only for the shortlist. Never repeat a page lookup when a current,
field-level source record already supports the needed fact.

## Inputs

Require:

- CV or candidate profile.
- Target degree and intake.
- Target schools, regions, departments, or ranking scope.
- Research interests and weights.

Accept optional hard constraints such as full funding, maximum tuition, ranking
cutoff, location, or excluded institutions. Normalize research weights to 1.0
and preserve hard constraints separately.

If the complete Advisor Atlas skill set is present, read
`../advisor-pipeline/references/data-contract.md`. Read
`references/application-facts.md` before the objective feasibility pass.

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
2. Confirm degree, intake, target scope, and hard constraints.
3. Record the user-selected Finder sections. Default to:
   `identity_current_role`, `recent_research`, and
   `current_projects_recruiting`.
4. If the user deselects a default, warn that the shortlist may be incomplete or
   stale; record the choice rather than silently re-enabling it.

### 2. Broad discovery

Build a roster of roughly 30–60 candidates using official faculty pages,
targeted search, Scholar, dblp, OpenReview, or field directories. Record only:

- Name, institution, department, homepage, and stable `advisor_id`.
- Initial relevance note.
- Facts encountered incidentally, with sources.

Do not perform full application research or deep social investigation at this
stage.

### 3. Research profile and fit

Prioritize up to `MAX_ADVISORS` for profiling.

Use current personal/lab pages plus recent publication records. A stale homepage
does not imply an inactive researcher; use Scholar, dblp, publication pages, or
OpenReview for recent work.

For each selected research interest, score 0–10 with short supporting evidence:

- 9–10: current core focus with strong recent evidence.
- 6–8: active secondary direction.
- 4–5: adjacent transferable work.
- 2–3: occasional involvement.
- 0–1: no meaningful connection.

Compute the weighted fit score transparently. Keep QS rank, tuition,
scholarships, deadlines, and community opinions out of this score.

### 4. Shortlist

Select the most research-relevant advisors for objective feasibility research.
Preserve excluded candidates and reasons. Do not deep-profile all discovery
rows merely to fill an output.

### 5. Program mapping and objective facts

For every shortlisted advisor:

1. Identify each real school, program, degree, and intake through which the user
   could apply.
2. Reuse application facts already encountered.
3. Search only missing or stale fields from official sources.
4. Store school/program facts once in `program_records.json`; join them to all
   relevant advisors.
5. Store variable application materials and advisor contact requirements as
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
  "status": "Open or needs confirmation",
  "statusTone": "open|caution|closed|unknown",
  "feasibility": "eligible|ineligible|needs_confirmation",
  "feasibilityReasons": [],
  "directions": [],
  "evidence": 0
}
```

Generate the shortlist workbook with `scripts/build_advisor_excel.mjs`. Do not
draft outreach content until advisor-specific contact requirements have been
checked.

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
