---
name: advisor-pipeline
description: >
  Orchestrate the complete Advisor Atlas workflow from a real CV to a
  source-backed shortlist, objective application-feasibility screen,
  user-selected advisor background research, and an application-ready final
  workbook. Use when the user asks to find advisors, run the full advisor
  matching process, resume an application project, or coordinate Finder,
  Detective, and Evaluator.
---

# Advisor Pipeline

Run one progressive, resumable workflow:

```text
Intake
  -> Finder broad discovery
  -> Finder research-fit shortlist
  -> Finder objective application feasibility
  -> user selects advisor-program rows and investigation sections
  -> Detective selected-section research
  -> Evaluator and application-ready workbook
```

Do not create a late, independent application-requirements scrape. Capture facts
when encountered and fill only shortlist gaps before Detective.

## Shared contract

Read `references/data-contract.md` before writing project state.

Use:

- `project.json`
- `status.json`
- `outputs/candidates.json`
- `outputs/advisor_records.json`
- `outputs/program_records.json`
- `outputs/evidence.json`

The JSON files are authoritative. Markdown state files are resumable human
summaries only.

## Status

Use:

```json
{
  "schemaVersion": 2,
  "phase": "intake|finder|detective|evaluator|completed",
  "stage": "intake|discovery|research_fit|objective_screen|selection|investigation|ranking|completed",
  "candidateCount": 0,
  "shortlistCount": 0,
  "objectiveReadyCount": 0,
  "selectedCount": 0,
  "evidenceCount": 0,
  "evidenceCoverage": 0,
  "rankingCount": 0,
  "updatedAt": "ISO-8601"
}
```

Write real counts from artifacts. Do not populate demonstration values.

## Phase 1: Advisor Finder

Require a target scope plus either a real CV or at least one research interest.
Weights are optional. Persist the user-selected `shortlist_target` (default 10)
and invoke Advisor Finder without duplicating its instructions.

Finder performs a fixed low-cost scan for identity/current role, high-level
recent research, representative work, and official recruiting signals. These
facts may later be reused by Detective, but Finder must not pre-run community
reputation, group ecology, work-style, or other selected deep-research sections.

Degree and intake can be supplied after discovery. Require them before Finder
starts the objective application-feasibility pass, then query only missing
official application facts for the shortlist.

Completion requires:

- Real advisor and program records.
- Research-fit shortlist.
- Objective feasibility for shortlisted advisor-program combinations.
- `outputs/candidates.json` for the Web UI.

Pause for user selection after the objective screen.

## Selection gate

Persist after the objective screen:

- Exact `selected_advisor_program_ids`.
- Exact `selected_sections`.
- Community-source consent.

Default-select the three Detective starting sections:
`identity_current_role`, `recent_research`, and
`current_projects_recruiting`. Let the user deselect them after a completeness
warning. Show a qualitative cost warning based on selected advisor count and
Detective sections.

Never infer selected advisors from Top N when exact user selections exist.

## Phase 2: Advisor Detective

Invoke Advisor Detective only for exact selected IDs and selected sections.

If a reputation-related section is selected:

- Ask separately for community-source consent.
- Refresh local snapshots only after consent and only when needed.
- Continue other public-source research even when community access is declined
  or unavailable.

Completion requires a result or explicit gap for every selected
advisor-section pair.

## Phase 3: Advisor Evaluator

Invoke Advisor Evaluator using shared structured records. Do not pass a
shallow/medium/high level.

Completion requires:

- Separate research fit, objective feasibility, and advisor-suitability
  conclusions.
- An application-ready workbook.
- Source, freshness, missing-field, and risk checks.

## Resume behavior

At startup:

1. Read status and structured outputs.
2. Validate schema versions and stable IDs.
3. Resume the first incomplete stage.
4. Reuse current sources.
5. Query only missing, stale, or conflicting fields.

Never restart the whole workflow merely because an output workbook is missing;
regenerate the workbook from structured state.

## Safety

- Do not send email, submit applications, commit, push, or publish.
- Keep CVs, project state, downloaded community snapshots, and generated outputs
  local and Git-ignored.
- Do not treat public accessibility as redistribution permission.
- Do not bundle or commit third-party community snapshot contents.
- Stop and state the missing input instead of inventing application facts.
