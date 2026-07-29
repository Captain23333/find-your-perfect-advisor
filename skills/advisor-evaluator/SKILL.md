---
name: advisor-evaluator
description: >
  Combine Advisor Finder objective application facts and research-fit results
  with user-selected Advisor Detective evidence. Use when the user wants a final
  comparison, ranking, risk review, or application-ready Excel workbook. Keep
  research fit, objective eligibility, and subjective background findings
  separate while producing one directly usable application table.
---

# Advisor Evaluator

Produce a decision aid and application-ready workbook without collapsing
objective application conditions and subjective advisor suitability into one
opaque score.

Read:

- `outputs/advisor_records.json`
- `outputs/program_records.json`
- `outputs/evidence.json`
- `project.json`

If present, read `../advisor-pipeline/references/data-contract.md`. Always read
`references/workbook-contract.md`.

## Alignment

Join records by stable `advisor_program_id`, not fuzzy advisor-name matching.
Preserve multiple programs for one advisor as separate application rows.

Check:

- Every row maps to a real advisor and official program.
- Objective facts are current for the requested intake.
- Detective results cover the same selected sections for compared advisors.
- `not_checked`, `not_found`, access failure, and conflicting evidence remain
  distinct.

## Decision model

Show three separate layers:

1. **Research fit**: numeric, formula-driven, and sourced from Finder.
2. **Objective feasibility**: `eligible`, `ineligible`, or
   `needs_confirmation`, with explicit reasons.
3. **Advisor suitability**: selected-section findings, supported risks, and
   confidence.

Ask for optional weights only for numeric selected dimensions. Normalize weights
over dimensions consistently selected for the compared advisors. Do not score
an unselected or merely unavailable section as zero.

Anonymous leads cannot directly change a score. Display a supported severe risk
separately even when an overall numeric result is high.

## Priority

Recommend application priority using transparent rules:

- Do not recommend an objectively ineligible row as a primary application.
- Keep unresolved feasibility visible instead of silently filtering it.
- Prefer strong research fit when eligibility is comparable.
- Surface verified severe risks before total scores.
- Explain the recommendation in plain language and list the next verification
  action.

## Workbook

Generate `advisor_application_ready_YYYYMMDD.xlsx` using the deterministic
builder. The primary sheet must be usable without manually joining other
sheets.

Include:

- School, QS edition, program, degree/intake, official link, deadline, tuition,
  scholarships, materials, and RP requirement.
- Advisor research/papers, email, homepage, and multiline recruiting/contact
  requirements.
- Research fit, objective feasibility, selected backcheck result, supported
  risks, gaps, official sources, and last verified date.

Use separate sheets for fit, evidence, sources/freshness, and configuration.

## Verification

- Scan for duplicate `advisor_program_id` rows.
- Verify typed numbers, dates, formulas, filters, frozen panes, wrapping, and
  conditional formatting.
- Scan formulas for `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, and `#N/A`.
- Confirm every material row contains official application sources and access
  dates.
- Stop rather than fabricate missing application facts.
