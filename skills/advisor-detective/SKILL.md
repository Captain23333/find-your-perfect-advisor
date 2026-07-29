---
name: advisor-detective
description: >
  Perform evidence-backed background research on user-selected academic
  advisors after Advisor Finder. Use when the user asks to investigate, compare,
  or backcheck specific advisors. Research only explicitly selected information
  sections, preserve exact advisor-program identities, optionally consult
  consented local community sources, and report supported findings, conflicts,
  risks, and information gaps without treating anonymous claims as facts.
---

# Advisor Detective

Investigate whether a shortlisted advisor is suitable for the user. Do not
repeat objective program research already completed by Advisor Finder.

## Required inputs

Read:

- `outputs/advisor_records.json`
- `outputs/program_records.json`
- `outputs/evidence.json`
- `project.json`

If the full skill set is present, read
`../advisor-pipeline/references/data-contract.md`. Always read
`references/investigation-sections.md`. Read
`references/community-sources.md` only when
`guidance_group_ecology` or another reputation-related section is selected.

Require exact `selected_advisor_program_ids` and `selected_sections`. Validate
each ID against the Finder output. A count without exact IDs is invalid.

## Confirmation gate

Before any network research or community-cache refresh, show:

- Exact selected advisors and programs.
- Exact selected sections.
- A qualitative cost warning based on advisor count and sections.
- Whether local community sources are requested.

Proceed only after the selection is persisted. Community snapshots additionally
require `community_sources.consented: true`. If consent is false, continue other
selected research without downloading them.

## Research workflow

For each selected advisor:

1. Read current Finder facts and evidence.
2. Skip unselected sections and write `用户未选择复核`.
3. Reuse current sources and query only missing, stale, or conflicting evidence.
4. Separate official facts, identified firsthand accounts, anonymous leads, and
   same-source copies.
5. Record short excerpts, URL, access date, identity status, and which finding
   the source supports.
6. Preserve rebuttals, corrections, dates, and conflicting accounts.
7. Write selected-section results back to `advisor_records.json` and evidence
   rows to `outputs/evidence.json`.

If a new official application fact appears incidentally, update the shared
program or advisor record. Do not restart a complete application search.

## Community knowledge

When a reputation-related section is selected and consent is true:

1. Inspect `references/community-knowledge-metadata.json`.
2. Refresh only when missing, explicitly requested, or stale under the current
   policy.
3. Require `search_ready: true` before interpreting the PDF source as searched.
4. Search local text by advisor full name, Chinese name, institution, and lab.
5. Open relevant original links when accessible.
6. Continue with relevant public sources such as X/Twitter, 小红书, Reddit, Rate
   My Professors, institutional records, or identified public accounts.

Use the script path relative to this skill:

```bash
python3 scripts/sync_community_knowledge.py
```

If no PDF extractor exists, explain the project-local dependency option and
wait for user consent before installing anything. A non-searchable source must
be reported as `未完成检索`, never `未发现记录`.

## Evidence and privacy

- Anonymous material is an `anonymous_lead`, not a verified fact.
- Mirrors and reposts are `same_source_copy`, not extra corroboration.
- Do not automatically change a score because an advisor appears on a list.
- Do not expose student names, contact details, health information, private
  family information, or details that facilitate doxxing.
- Severe claims require a primary record, an identified firsthand account, or
  multiple genuinely independent sources before becoming a supported risk.
- When evidence remains weak, write a neutral lead and a concrete verification
  step.

## Output

Maintain a compact `DETECTIVE_STATE.md` summary containing:

- Selected advisor-program IDs.
- Selected sections.
- Community consent and cache search status.
- Per-advisor completion and evidence count.
- Access limitations and unresolved conflicts.

Generate `advisor_detective_YYYYMMDD.xlsx` with a deterministic builder. Include
only the selected-section result columns plus an explicit configuration and
evidence sheet. Mark unselected sections as `用户未选择复核`.

## Completion

Complete only when every selected advisor has:

- A result or explicit access/information gap for every selected section.
- Field-level evidence links.
- Conflict and privacy checks.
- No conclusion derived from a failed or skipped source.
