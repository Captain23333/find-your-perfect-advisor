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

### Direct CLI project bootstrap

Web-created projects already contain the shared files. When this Skill is used
directly from Codex CLI, Codex Desktop, or Claude Code in a user-created folder,
initialize the same contract before starting if it is missing:

1. Run `node .agents/skills/advisor-pipeline/scripts/init_project.mjs --root "$PWD"`
   (or the equivalent `.claude/skills/` path). This deterministic initializer
   creates or safely migrates the shared files, writes a timestamped backup
   before normalizing an existing file, and never overwrites existing outputs.
2. Read the real CV and any existing application notes.
3. Collect only the missing Phase 1 inputs; do not make the user repeat facts
   already present in those files.
4. Validate again with the initializer's `--check` option before research.

Do not hand-compose `project.json`. The initializer leaves unknown user inputs
blank rather than guessing them from unrelated Finder output fields. Empty
structured output arrays are created only when the corresponding file is
missing; demonstration advisors and progress counts are never inserted.

Direct CLI use and Web use are two interfaces over the same project state, not
two different workflows.

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
Weights are optional. Persist the user-selected `shortlistTarget` (default 10)
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

This is a mandatory interactive gate in both Web and direct CLI use. Finishing
Finder does not authorize Detective research.

For direct CLI users, perform the following steps in order:

1. Read `outputs/candidates.json` and display a numbered shortlist. Each row
   must show advisor name, institution, official program, research-fit score,
   objective feasibility, and the stable `advisorProgramId`. Keep ineligible
   rows visible with their reasons.
2. Ask the user to choose exact advisor-program rows by number or stable ID.
   Do not infer the choice from ranking, Top N, or a count.
3. Read `../advisor-detective/references/investigation-sections.md` and display
   all 11 sections in its canonical order. Mark the first three as selected by
   default and the other eight as optional.
4. Let the user keep the defaults, add sections, remove sections, select all,
   or select none. If a default section is removed, warn that the background
   check may be incomplete or stale before accepting the removal.
5. Show the same qualitative cost used by the Web UI, calculated as selected
   advisor-program rows multiplied by selected sections: `<= 8` is low,
   `9-24` is medium, and `> 24` is high.
6. If a community-relevant section listed in the canonical section reference
   is selected, ask separately whether the user consents to downloading and
   parsing third-party community material in this local project. Default to no.
7. Show a final confirmation summary with exact advisor names/programs, exact
   section labels, cost, and community consent. Wait for an explicit confirm or
   modification request.
8. Menu changes are draft-only. After the user explicitly confirms the exact
   summary, run `scripts/confirm_investigation.mjs --confirmed-by-user` with
   every selected advisor-program ID, section ID, and `--community yes|no`.
   This produces a revision-bound `investigation.confirmed` snapshot. Only then
   invoke Advisor Detective.

Use a compact reply format such as:

```text
Advisors: 1,3
Sections: keep defaults + 5,6,10
Community sources: no
```

Do not start Detective while either the advisor selection or section selection
is empty. Never infer selected advisors from Top N when exact user selections
exist.

## Phase 2: Advisor Detective

Invoke Advisor Detective only for exact confirmed IDs and selected sections.

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
3. If the objective screen is complete but selection is absent, resume at the
   interactive selection gate; do not repeat Finder or choose Top N.
4. If a non-empty `investigation.confirmed` snapshot exists and still matches
   the current draft revision/fingerprint, show its compact summary and resume
   the first incomplete research stage unless the user asks to modify it.
   Draft-only or changed selections must return to the final confirmation gate.
5. Reuse current sources.
6. Query only missing, stale, or conflicting fields.

Never restart the whole workflow merely because an output workbook is missing;
regenerate the workbook from structured state.

## Safety

- Do not send email, submit applications, commit, push, or publish.
- Keep CVs, project state, downloaded community snapshots, and generated outputs
  local and Git-ignored.
- Do not treat public accessibility as redistribution permission.
- Do not bundle or commit third-party community snapshot contents.
- Stop and state the missing input instead of inventing application facts.
