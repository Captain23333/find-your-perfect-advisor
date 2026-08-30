# Core project and researched-record contract

Read this reference for project bootstrap, Finder, Evaluator, or writes to
shared advisor/program/evidence/status records. It intentionally excludes
Detective authorization and application-material schemas.

## Project files

| Path | Purpose |
| --- | --- |
| `project.json` | User inputs and workflow configuration |
| `status.json` | Current phase, stage, and real progress counters |
| `outputs/candidates.json` | Compact Finder rows for the Web candidate table |
| `outputs/advisor_records.json` | Advisor facts, fit, selected-section results, and source IDs |
| `outputs/program_records.json` | Deduplicated school/program/application facts |
| `outputs/evidence.json` | Field-level evidence and community leads |
| `outputs/ranking.json` | Evaluator ranking and allowed later targets |

`project.json` uses camelCase. Researched entity records use the snake_case
fields below. Do not write aliases for the same project field.

## Deterministic CLI bootstrap

For a normal local folder rather than a Web-created project, run:

```bash
node .agents/skills/advisor-pipeline/scripts/init_project.mjs --root "$PWD"
node .agents/skills/advisor-pipeline/scripts/init_project.mjs --root "$PWD" --check
```

Use the equivalent `.claude/skills/` path in Claude Code. The initializer
creates or migrates `project.json`/`status.json`, creates only missing empty
output arrays, preserves existing outputs byte-for-byte, and backs up a file
before normalization. Do not hand-compose another contract.

Core project fields are `schemaVersion`, stable `id`/`slug`, `name`,
`applicantName`, `season`, `degree`, `target`, normalized weighted `interests`,
`shortlistTarget`, `cv`, timestamps, and the workflow configuration objects.
Leave unknown target, degree, season, applicant name, and interests blank.

The applicant name must be the confirmed real or preferred professional name,
never a sample identity. Finder requires a readable current-applicant CV under
`inputs/`; research-interest text cannot replace it.

## Status

Preserve this shape and derive every count from artifacts:

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

## Stable IDs

- `advisor_id`: normalized institution plus advisor name; never array position.
- `program_id`: institution plus official program, degree, and intake.
- `advisor_program_id`: advisor ID plus program ID.
- Preserve display names separately from IDs.

## Field and source states

Every nontrivial researched field distinguishes:

- `verified`: a current source supports the value.
- `not_found`: named sources were checked and did not expose it.
- `not_checked`: outside scope or not researched.
- `conflict`: current sources disagree; preserve each claim.
- `stale`: a prior value needs refresh for the current intake.

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

Evidence strengths are `official`, `identified_firsthand`, `anonymous_lead`,
and `same_source_copy`. Mirrors/reposts are not independent corroboration.

## Program records

Store school/program facts once:

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

Keep variable requirements as multiline text; do not invent Boolean columns.

## Advisor records

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

## Cache and freshness

- Reuse a current URL/extraction that supports the needed field.
- Query only `missing_fields`, `stale` fields, and conflicts.
- Recheck recruiting/contact requirements per application run.
- Recheck deadline, tuition, scholarship, and materials for the named intake.
- Refresh QS only when the requested edition changes.
- Never repeat program-level browsing for advisors in the same program.
