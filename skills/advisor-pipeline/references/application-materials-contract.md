# Application materials and literature bundle contract

Use this contract only after `outputs/ranking.json` exists. Application-material
work is a separately confirmed continuation; ranking completion does not
authorize literature downloads or writing for any advisor.

## Applicant preflight

Before literature download or generation, require all of the following:

- `project.json.applicantName` contains the applicant's confirmed real or
  preferred professional name, not a placeholder;
- `project.json.cv` resolves to a current, readable file under `inputs/`; and
- the CV belongs to the named applicant and supports the applicant-side claims
  needed for the selected material.

Run this as an idempotent state check. The CV belongs to the project, not to an
individual phase: a file uploaded during intake and still valid at
`project.json.cv` must be reused by Finder, Detective, Evaluator, Research
Proposal, and Outreach without another upload request. Direct Skill use must
also inspect existing project state, `inputs/`, and previously supplied paths
before asking. Only request a replacement for a missing, unreadable, broken,
sample, or wrong-applicant file. When a particular claim lacks support, ask for
that fact rather than asking for the whole CV again.

If any check fails, pause and ask for the specific missing or conflicting input.
Do not create applicant-facing `.tex`, PDF, or email files and do not replace
missing identity with sample data. Anonymous-RP instructions control whether
the confirmed name is printed, not whether the preflight is required.

## Confirmation snapshot

`project.json` schemaVersion 6 contains:

```json
{
  "applicationMaterials": {
    "draft": {
      "advisorProgramId": "exact-ranked-id",
      "materials": ["research_proposal", "outreach_email"],
      "order": ["research_proposal", "outreach_email"],
      "literaturePolicy": {
        "advisorWorks": true,
        "fieldWorks": true,
        "downloadOpenAccess": true
      },
      "revision": 1,
      "updatedAt": "ISO-8601"
    },
    "confirmed": {
      "advisorProgramId": "exact-ranked-id",
      "materials": ["research_proposal", "outreach_email"],
      "order": ["research_proposal", "outreach_email"],
      "literaturePolicy": {
        "advisorWorks": true,
        "fieldWorks": true,
        "downloadOpenAccess": true
      },
      "revision": 1,
      "confirmedAt": "ISO-8601",
      "fingerprint": "sha256",
      "source": "user_confirmed"
    }
  }
}
```

Only one exact advisor-program target is confirmed at a time. The fixed
literature policy is a safety/completion invariant, not an optional checkbox.

For direct CLI use, first render the complete menu verbatim:

```bash
node .agents/skills/advisor-pipeline/scripts/render_application_materials_menu.mjs --root "$PWD"
```

After the user confirms the exact target, materials, and order, persist it with:

```bash
node .agents/skills/advisor-pipeline/scripts/confirm_application_materials.mjs \
  --root "$PWD" --confirmed-by-user \
  --advisor-id exact-advisor-program-id \
  --materials research_proposal,outreach_email \
  --order research_proposal,outreach_email
```

Do not hand-edit `confirmed`, infer rank 1, substitute the same professor's
other program, or start the second material before the confirmed first material
passes artifact verification.

## Literature categories and local bundle

Every material must use and audit both categories:

- `advisor_work`: work authored by the advisor or their research team that is
  genuinely relevant to the proposed connection.
- `field_work`: independent field-defining, methodological, contradictory, or
  frontier work needed to understand the area and test whether the claimed gap
  exists.

Prepare a project-local source JSON, then use the deterministic downloader:

```bash
node .agents/skills/advisor-pipeline/scripts/fetch_open_literature.mjs \
  --root "$PWD" \
  --advisor-id exact-advisor-program-id \
  --source-file inputs/literature-sources.json \
  --confirmed-revision 1 \
  --confirmed-fingerprint sha256
```

Each source entry supplied to the downloader must include:

- a top-level `targetAdvisorName` that matches the selected ranking row;

- stable `literatureId`, `category`, title, authors, year where known;
- `canonicalUrl` and a direct `downloadUrl`;
- one explicit `accessBasis`: `publisher_open_access`,
  `institutional_repository`, `disciplinary_repository`, or
  `author_public_copy`;
- access note/license when exposed by the source;
- `inspectionLevel`: `full_text`, `abstract`, or `metadata`;
- `relevance` and `usedIn` (`research_proposal`, `outreach_email`, or both).
- for `advisor_work`, an `advisorRelationship` with `type`, `advisorName`,
  `matchedAuthors`, `evidenceUrl`, and `note`. `advisor_author` must match the
  selected advisor directly in the paper author list; `team_author` must name
  the matched team author and link public evidence of that team relationship.
- for `field_work`, an `independenceNote`; a paper bearing the selected
  advisor's name cannot be counted as independent field evidence.

The script blocks local/private URLs, requires a real PDF, limits file size,
writes under the confirmed target, calculates SHA-256 and bytes, and creates:

```text
outputs/application-materials/<advisorProgramId>/literature/
  manifest.json
  advisor-work/<literatureId>.pdf
  field-work/<literatureId>.pdf
```

Never bypass a paywall, institutional login, robots/access control, or
redistribution restriction. If a cited work has no legal public PDF, find a
lawful repository/preprint/author copy or do not use it as a cited source.
Metadata-only entries may be recorded for leads, but a material cannot pass
completion if it cites them.

## Completion verification

For the active material, all sources whose `usedIn` contains that material must:

- include at least one `advisor_work` and one `field_work` source;
- bind `targetAdvisorName` to the selected ranking row and carry auditable
  advisor-author/team-author evidence for every `advisor_work` item;
- be downloaded as local PDFs from an allowed access basis;
- match the manifest's file path, SHA-256, and byte count;
- match the confirmed advisor, revision, and fingerprint;
- be named by `literatureId` in `proposal-evidence.md` or
  `outreach-audit.md`.

The Web runtime re-runs these checks. A fluent draft without the verified bundle
is `partial`, not complete.

The Web runtime also requires a current valid CV and confirmed applicant name.
For outreach, the copyable email must contain that confirmed name in the
signature. These are completion requirements, not post-delivery reminders.

An RP additionally requires `research-proposal.tex`, `references.bib`, a
compiled `research-proposal.pdf`, and `proposal-build.json`. BibTeX keys must
equal the manifest `literatureId` values; the build manifest binds the current
confirmation to hashes of the `.tex`, `.bib`, and PDF. The clean outreach body
is `outreach-email.txt`. Applicant-facing `.tex`, PDF, and email files must not
contain internal QA labels or submission-prohibition banners; put review
warnings in `proposal-review.md`, `outreach-audit.md`, and the chat handoff.
