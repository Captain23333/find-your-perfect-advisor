# Advisor Atlas shared data contract

Use project-input `schemaVersion: 4`; status and researched-output records
remain version 2. Store structured state in the application project, not inside
a skill folder.

`project.json` uses camelCase because it is shared with the Web project store.
Do not write snake_case aliases for the same project fields. Researched entity
records in `advisor_records.json`, `program_records.json`, and `evidence.json`
continue to use the snake_case field names shown below.

## Project files

| Path | Purpose |
| --- | --- |
| `project.json` | User inputs, selected sections, selected advisor-program IDs, and community-source consent |
| `status.json` | Current pipeline phase and real progress counters |
| `outputs/candidates.json` | Compact rows for the Web candidate table |
| `outputs/advisor_records.json` | Advisor facts, fit, selected-section results, and advisor-specific sources |
| `outputs/program_records.json` | Deduplicated school/program/application facts |
| `outputs/evidence.json` | Field-level evidence and community leads |

## Direct CLI bootstrap

If a user invokes the Skills in a normal local folder rather than a Web-created
project, run the bundled deterministic initializer before research:

```bash
node .agents/skills/advisor-pipeline/scripts/init_project.mjs --root "$PWD"
node .agents/skills/advisor-pipeline/scripts/init_project.mjs --root "$PWD" --check
```

Use the equivalent `.claude/skills/` path in Claude Code. Do not hand-compose a
second version of this contract. The initializer preserves existing output
files byte-for-byte, creates only missing outputs, and makes timestamped backups
before safely normalizing an existing project or status file.

```json
{
  "schemaVersion": 4,
  "id": "stable-local-project-id",
  "slug": "stable-local-project-id",
  "name": "User-facing project name",
  "season": "",
  "degree": "",
  "target": "",
  "interests": [],
  "shortlistTarget": 10,
  "cv": null,
  "investigation": {
    "draft": {
      "selectedAdvisorProgramIds": [],
      "selectedSections": [
        "identity_current_role",
        "recent_research",
        "current_projects_recruiting"
      ],
      "communitySources": {"requested": false},
      "revision": 0,
      "updatedAt": "ISO-8601"
    },
    "confirmed": null
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Also create `status.json` with the Pipeline status schema and initialize the
four structured output files as empty JSON arrays. Derive IDs from the local
project folder without renaming the user's folder. Do not add sample records.
Do not infer `target`, `degree`, `season`, or interests from unrelated output
fields. Leave unknown values blank and ask for them at the normal workflow gate.

## Stable IDs

- `advisor_id`: normalized institution plus advisor name; do not use array
  position.
- `program_id`: institution plus official program name, degree, and intake.
- `advisor_program_id`: `advisor_id` plus `program_id`.
- Preserve the displayed name separately from the stable ID.

## Field states

Every nontrivial researched field must distinguish:

- `verified`: a current source supports the value.
- `not_found`: the named sources were checked and did not expose the value.
- `not_checked`: the field was outside the selected scope or has not been
  researched.
- `conflict`: current sources disagree; preserve each claim.
- `stale`: a prior value exists but must be refreshed for the current intake.

Never convert `not_checked` or a failed extraction into `not_found`.

## Sources

Use field-level evidence rows:

```json
{
  "evidence_id": "ev_...",
  "entity_id": "program_or_advisor_id",
  "fields_supported": ["deadline"],
  "source_type": "official_program",
  "url": "https://...",
  "title": "Official admissions page",
  "accessed_at": "ISO-8601",
  "excerpt": "Short exact supporting text",
  "evidence_strength": "official",
  "status": "verified"
}
```

Allowed human-readable evidence strengths:

- `official`: university, program, funder, publication, or verified advisor/lab
  page.
- `identified_firsthand`: a public account whose identity and relationship are
  reasonably confirmed.
- `anonymous_lead`: an anonymous or identity-unconfirmed report that requires
  corroboration.
- `same_source_copy`: a mirror, repost, or quotation of an existing source; it
  is not independent corroboration.

## Program records

Store school/program facts once and join them to multiple advisors:

```json
{
  "program_id": "university-program-degree-intake",
  "school_name": "",
  "qs_overall": {"value": null, "edition": "", "status": "not_checked"},
  "program_name_zh": "",
  "program_name_en": "",
  "degree": "",
  "intake": "",
  "program_url": "",
  "deadline": {"value": "", "status": "not_checked"},
  "tuition": {"value": null, "currency": "", "period": "", "status": "not_checked"},
  "scholarships": {"value": "", "status": "not_checked"},
  "application_materials": {"value": "", "status": "not_checked"},
  "rp_requirement": {"value": "", "status": "not_checked"},
  "last_verified_at": null,
  "source_ids": [],
  "missing_fields": []
}
```

Keep variable requirements as multiline text. Do not invent Boolean columns
such as `requires_test` or `requires_paper`.

## Advisor records

Keep advisor-specific facts separate from program facts:

```json
{
  "advisor_id": "institution-advisor",
  "name": "",
  "school": "",
  "department": "",
  "title": "",
  "homepage": "",
  "scholar_url": "",
  "email": "",
  "research_directions": [],
  "recent_papers": [],
  "fit_scores": {},
  "weighted_fit": null,
  "recruiting_status": "open|closed|unknown",
  "advisor_contact_requirements": {"value": "", "status": "not_checked"},
  "selected_section_results": {},
  "risk_flags": [],
  "source_ids": []
}
```

## Investigation configuration

Draft selections and final authorization are separate. Checkbox/menu changes
modify only `investigation.draft`. Detective and community-cache operations may
read only a current `investigation.confirmed` snapshot:

```json
{
  "shortlistTarget": 10,
  "investigation": {
    "draft": {
      "selectedAdvisorProgramIds": [],
      "selectedSections": [],
      "communitySources": {"requested": false},
      "revision": 1,
      "updatedAt": "ISO-8601"
    },
    "confirmed": {
      "selectedAdvisorProgramIds": [],
      "selectedSections": [],
      "communitySources": {"consented": false, "consentedAt": null},
      "revision": 1,
      "confirmedAt": "ISO-8601",
      "fingerprint": "sha256",
      "source": "user_confirmed"
    }
  }
}
```

After showing the exact final summary and receiving explicit user confirmation,
direct CLI use must run the bundled confirmation script with every exact ID and
section, for example:

```bash
node .agents/skills/advisor-pipeline/scripts/confirm_investigation.mjs \
  --root "$PWD" --confirmed-by-user \
  --advisor-id advisor-program-id \
  --section identity_current_role --community no
```

Use repeated `--advisor-id` and `--section` flags or comma-separated values.
The script validates IDs against `outputs/candidates.json`, creates a backup,
and writes one revision-bound fingerprinted snapshot. Passing only a count is
invalid. Never set `confirmed` by hand or before the explicit final answer.

For schemaVersion 3 migration, non-empty selections without a real
`detective-results.json` become draft-only and require confirmation. A legacy
project with a real non-empty Detective artifact may be restored as a
`source: legacy_artifact` historical snapshot.

## `outputs/detective-results.json`

A Detective round is only complete when this file exists and belongs to the
confirmation it was launched against. The web runtime verifies it before it
reports the phase as finished, so the shape is required, not advisory:

```json
{
  "confirmedRevision": 3,
  "confirmedFingerprint": "sha256 of the confirmed snapshot",
  "generatedAt": "ISO-8601",
  "selectedSections": ["identity_current_role"],
  "communitySources": {"consented": false},
  "results": [
    {
      "advisorProgramId": "advisor-program-id",
      "name": "Real Name",
      "sections": {
        "identity_current_role": {"status": "completed", "summary": "…", "sourceIds": []},
        "work_style_pressure": {"status": "not_completed", "summary": "为什么没做完"}
      },
      "evidenceCount": 0
    }
  ],
  "evidenceCount": 0,
  "evidenceCoverage": 0
}
```

Rules:

- Every confirmed `advisorProgramId` needs an entry.
- Every selected section needs either a real conclusion or an explicit
  `{"status": "not_completed", "summary": "…"}`. A missing key counts as an
  unfinished round, not a finished one.
- `confirmedRevision` and `confirmedFingerprint` must be copied from
  `investigation.confirmed`. Results carrying an older revision do not count as
  this round finishing.

## Cache and freshness

- Reuse a URL and extracted evidence when it is current and supports the needed
  fields.
- Query only `missing_fields`, `stale` fields, or conflicts.
- Verify advisor recruiting status and advisor contact requirements on each
  application run.
- Verify deadline, tuition, scholarship, and application materials for the
  named intake.
- Record the QS edition; refresh when the requested edition changes.
- Never duplicate program-level browsing for advisors in the same program.
