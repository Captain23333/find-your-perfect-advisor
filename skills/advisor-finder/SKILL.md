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

Require to start Phase 1:

- Target schools, regions, departments, or ranking scope.
- Either a real CV/candidate profile or at least one research interest.

Target degree and intake may be added after discovery, but require them before
the objective application-feasibility pass. Research-interest weights are
optional. If interests exist without weights, use equal weights; if partial
weights are supplied, normalize them transparently.

Accept optional hard constraints such as full funding, maximum tuition, ranking
cutoff, location, or excluded institutions. Accept a user-selected
`shortlist_target` from 5 to 50, defaulting to 10. Preserve hard constraints
separately.

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
   interests from the real CV when provided.
2. Combine CV-derived signals with any user-entered research interests. Do not
   require the user to repeat interests already clear from the CV.
3. Confirm the target scope and `shortlist_target`.
4. Record degree, intake, and hard constraints when present. If degree or intake
   is missing, discovery may continue but the objective screen must pause.

### 2. Broad discovery

Build a roster of roughly `max(30, shortlist_target * 3)`, capped at 60, using official faculty pages,
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

Compute the weighted or equal-weight fit score transparently. Keep QS rank, tuition,
scholarships, deadlines, and community opinions out of this score.

### 4. Shortlist

Select up to `shortlist_target` research-relevant advisors for objective
feasibility research.
Preserve excluded candidates and reasons. Do not deep-profile all discovery
rows merely to fill an output.

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
