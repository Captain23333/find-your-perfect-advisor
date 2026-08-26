---
name: advisor-pipeline
description: >
  Orchestrate the complete Advisor Atlas workflow from a real CV to a
  source-backed shortlist, objective application-feasibility screen,
  user-selected advisor background research, an application-ready final
  workbook, and optional target-specific outreach or Research Proposal
  materials. Use when the user asks to find advisors, run the full advisor
  matching process, resume an application project, or coordinate Finder,
  Detective, Evaluator, and post-evaluation application materials.
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
  -> user selects exact advisor-program target and material purpose
  -> Research Proposal and/or advisor outreach, in requirement-driven order
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
2. Resolve the project's existing CV first: prefer the file referenced by
   `project.json.cv`, then inspect `inputs/` and any explicit CV path already
   supplied in the conversation. Read that CV and any existing application
   notes.
3. Treat CV intake as project-scoped and idempotent. Once a readable CV for the
   current applicant exists, reuse that same file silently in every later
   phase; never ask the user to upload, attach, or paste it again merely because
   another Skill or phase is starting. Only request a replacement when no
   readable CV exists, the stored path is broken, the file is clearly a sample
   or for another applicant, or the user asks to update it. If one material
   needs a fact that the CV does not contain, ask only for that fact rather than
   requesting the whole CV again. Research-interest text alone does not unlock
   matching when no real CV exists.
4. Collect only the missing Phase 1 inputs; do not make the user repeat facts
   already present in those files.
5. Validate again with the initializer's `--check` option before research.

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

Require a target scope plus a real, readable CV. Research interests and weights
are optional supplements, not replacements for the CV. Persist the user-selected `shortlistTarget` (default 10)
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

1. Render the menu with the deterministic script, never by hand:

   ```bash
   node .agents/skills/advisor-pipeline/scripts/render_investigation_menu.mjs --root "$PWD"
   ```

   It prints the candidate table (including the stable `advisorProgramId`
   column), all 11 ordered sections with their defaults, and the current work
   unit / cost level. Show its output verbatim. You may explain it, but you must
   not reorder, rename, drop, or summarize away any column or row — a
   free-form menu has already shipped without `advisorProgramId`.
2. **Read scope while selecting**: only `project.json`,
   `outputs/candidates.json`, and the dimension catalog. Do not read
   `outputs/advisor_records.json`, `outputs/evidence.json`, previous detective
   results, or the community cache, and make no network requests until the
   user has confirmed.
3. Ask the user to choose exact advisor-program rows by number or stable ID.
   Do not infer the choice from ranking, Top N, or a count.
4. Let the user keep the defaults, add sections, remove sections, select all,
   or select none. If a default section is removed, warn that the background
   check may be incomplete or stale before accepting the removal.
5. The script already prints the Web-equivalent cost level, calculated as
   selected advisor-program rows multiplied by selected sections: `<= 8` is
   low, `9-24` is medium, and `> 24` is high.
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

## Post-evaluation application materials

Read [references/application-materials-contract.md](references/application-materials-contract.md)
before offering, confirming, researching, downloading, or generating these
materials.

After Evaluator, offer—not silently start—two target-specific Skills:

- `advisor-research-proposal` for an RP, concept note, literature review,
  methods plan, adaptation, or proposal audit.
- `advisor-outreach` for a first email, advertised-position response, follow-up,
  or reply.

Before offering generation as ready, validate the already stored project CV and
applicant name. This is a state check, not a new intake step: when
`project.json.cv` still resolves to the readable CV supplied earlier in the
pipeline, both application-material Skills must reuse it without asking the
user for another upload. If the CV or name is missing, invalid, conflicting,
ambiguous, or looks like a placeholder, pause and ask only for the exact input
needed to repair that condition.
Do not start literature downloads, create applicant-facing files, or substitute
an example identity. An official anonymity rule may keep the name out of an RP,
but does not waive the identity/CV preflight.

Require the user to choose one exact `advisorProgramId`, the material purpose,
and generation order. Do not infer the target from rank 1 or generate a mail merge. Read the
current official advisor/program contact and RP requirements before choosing
the order:

- When a draft RP or concept note is required or useful for first contact, run
  Research Proposal first and let Outreach decide whether to attach it.
- When the first contact is only an availability/route inquiry, draft Outreach
  first and do not manufacture a full RP attachment.
- For an advertised project, follow its document list and selection criteria.

Write post-evaluation artifacts under
`outputs/application-materials/<advisorProgramId>/`. Ranking remains the end of
the three analysis phases, but the Web and CLI expose these as separately
confirmed, artifact-verified continuations. A draft without both literature
classes, advisor/team relationship evidence, locally verified public PDFs,
manifest hashes, and citation-audit IDs
is partial. Never send email or submit the RP.

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
7. If post-evaluation materials exist, resume only the chosen target and
   material; do not regenerate ranking or other targets unless requested.

Never restart the whole workflow merely because an output workbook is missing;
regenerate the workbook from structured state.

## Safety

- Do not send email, submit applications, commit, push, or publish.
- Keep CVs, project state, downloaded community snapshots, and generated outputs
  local and Git-ignored.
- Do not treat public accessibility as redistribution permission.
- Do not bundle or commit third-party community snapshot contents.
- Stop and state the missing input instead of inventing application facts.
