# Advisor Atlas shared data contract

Use project-input `schema_version: 3`; status and researched-output records
remain version 2. Store structured state in the application project, not inside
a skill folder.

## Project files

| Path | Purpose |
| --- | --- |
| `project.json` | User inputs, selected sections, selected advisor-program IDs, and community-source consent |
| `status.json` | Current pipeline phase and real progress counters |
| `outputs/candidates.json` | Compact rows for the Web candidate table |
| `outputs/advisor_records.json` | Advisor facts, fit, selected-section results, and advisor-specific sources |
| `outputs/program_records.json` | Deduplicated school/program/application facts |
| `outputs/evidence.json` | Field-level evidence and community leads |

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

Persist exact values in `project.json`:

```json
{
  "shortlist_target": 10,
  "investigation": {
    "selected_advisor_program_ids": [],
    "selected_sections": [],
    "community_sources": {
      "consented": false,
      "refresh_requested": false,
      "consented_at": null
    }
  }
}
```

Validate IDs against `advisor_records.json` and `program_records.json` before
starting a run. Passing only a count is invalid.

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
