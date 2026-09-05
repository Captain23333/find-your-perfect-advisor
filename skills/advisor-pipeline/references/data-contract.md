# Advisor Atlas data-contract router

Advisor Atlas uses `project.json` schemaVersion 8; `status.json` and researched
output records remain version 2. Structured JSON is authoritative and Markdown
state files are compact resumable summaries.

Load only the contract needed by the active stage:

- Read [core-data-contract.md](core-data-contract.md) before bootstrap, Finder,
  Evaluator, or any write to shared advisor/program/evidence/status records.
- Read [investigation-contract.md](investigation-contract.md) only for the
  Detective selection gate, confirmation, execution, result validation, or
  migration of legacy Detective state.
- Read [application-materials-contract.md](application-materials-contract.md)
  only when offering, confirming, generating, resuming, or validating an RP or
  outreach email.

Cross-stage invariants:

- Join by stable IDs, never fuzzy names or array position.
- Reuse current field-level evidence; query only missing, stale, or conflicting
  fields. Never convert skipped work or extraction/access failure to
  `not_found`.
- Store program facts once and join them to advisor-program rows.
- Use the bundled initializer and confirmation scripts instead of hand-writing
  schema, fingerprints, revisions, or migration state.
- A valid project CV is project-scoped and reused across phases. Do not ask for
  another upload unless it is missing, unreadable, a sample, belongs to another
  applicant, or the user asks to replace it.
- Never insert demonstration records or infer unknown user inputs.
