---
name: advisor-outreach
description: >
  Draft or audit a personalized, evidence-grounded email for one exact academic
  advisor-program target: first inquiry, advertised-position response,
  follow-up, or reply. Verify contact rules, connect CV evidence to specific
  advisor work, and produce a clean draft plus audit. Never send the email.
---

# Advisor Outreach

Create a low-friction, truthful reason for a specific advisor to reply. A reply
cannot be guaranteed: admissions model, capacity, funding, timing, and inbox
load can dominate even when the email is strong.

Read [references/drafting-guide.md](references/drafting-guide.md) before
drafting. Read the target program and advisor's current official contact
instructions before deciding the email purpose, length, attachments, or call to
action.

When used inside Advisor Atlas, also read
[../advisor-pipeline/references/application-materials-contract.md](../advisor-pipeline/references/application-materials-contract.md)
before literature search or drafting. The email body need not contain academic
citation markers, but every paper-derived personalization must map to a verified
`literatureId` in the audit.

## Required target and inputs

Before checking contact strategy, searching papers, or drafting, require a real,
readable CV and the applicant's confirmed real or preferred professional name.
This is an idempotent validation of project state, not a request to repeat
intake. In Advisor Atlas, reuse the readable file already referenced by
`project.json.cv` under `inputs/`; in direct use, inspect the current project
state, `inputs/`, and any explicit CV path already supplied before asking. Never
ask the user to upload, attach, paste, or restate a CV that is already valid for
the current applicant. If one email claim needs information absent from the CV,
ask only for that information.
The CV is the grounding source for every applicant achievement, skill, project,
publication, method, and prior result. If the CV is missing, unreadable, clearly
a sample, belongs to another person, omits a name, or conflicts with the supplied
name, pause and ask for the missing input. Do not create the copyable email or
substitute a sample identity. The final signature must use the confirmed name.

Work on exact `advisorProgramId` rows, not a professor name or rank alone. If
one advisor maps to multiple programs, require the user to choose the program.
Do not silently choose rank 1 or generate a mail merge.

Use the smallest relevant evidence set:

- `outputs/ranking.json` or `outputs/candidates.json` for the selected row.
- `outputs/advisor_records.json`, `outputs/program_records.json`, and
  `outputs/evidence.json` for verified facts and source freshness.
- The user's real CV and application notes for applicant claims.
- `project.json` for degree, intake, and target context.
- An existing RP only when the user wants to mention or attach it.

If these files are unavailable in direct use, ask only for the missing target
advisor, program, degree/intake, real CV, confirmed applicant name, email
purpose, or official instructions after checking the current project and prior
user-supplied paths. A free-form factual profile is not a substitute for
the CV when generating applicant-facing outreach. Never invent missing achievements, publications, skills,
funding, recruiting status, or a connection to the advisor's work.

## Workflow

### 1. Resolve the outreach mode

Choose one mode from the user's intent and official instructions:

- `availability_inquiry`: ask whether the advisor expects to supervise for the
  named intake or which route to follow.
- `fit_inquiry`: show a real research connection and ask whether the direction
  is worth discussing or applying under.
- `advertised_position`: answer the advert's requested materials and selection
  criteria.
- `follow_up`: reply in the same thread with one concise update or reminder.
- `reply`: answer the advisor's actual questions before adding new requests.

Contacting a PI is not equally useful in every admissions system. Check whether
the program is committee-led, rotation-based, direct-supervisor, or requires
prior supervisor agreement. If official guidance says not to contact faculty,
do not draft a workaround; explain the correct channel.

### 2. Build the evidence bridge

Create a private drafting table with four columns:

| Advisor fact | Applicant evidence | Defensible connection | Email use |
|---|---|---|---|

The advisor fact must be supported by an inspected source. The applicant side
must come from the CV or user. The connection must name a shared question,
method, dataset, population, or problem—not merely say that the work
"resonates." If no strong bridge exists, say so and draft a narrower factual
inquiry rather than manufacturing fit.

Prefer one recent, genuinely understood paper/project over a list of titles.
Do not describe a paper's result from metadata alone. Preserve evidence levels
such as full text inspected, abstract inspected, or metadata only.

### 3. Decide attachments and request

Official advisor/program instructions override defaults.

- A concise academic CV is normally the first useful attachment when allowed.
- Attach an RP, transcript, writing sample, or portfolio only when requested,
  expected in that system, or clearly useful to the chosen mode.
- Use clear filenames and avoid oversized or unnecessary attachments.
- Ask one easy-to-answer primary question. Make a meeting optional unless the
  advisor or program invites pre-application meetings.
- Do not lead with a broad request for mentoring, free proposal review, or
  information already published on the official site.

### 4. Draft in the applicant's voice

Unless an official format requires otherwise, use an informative subject and
roughly 120–200 words in three or four short paragraphs:

1. Purpose, degree/intake, and why this exact advisor.
2. One evidence-backed connection between prior work and the advisor's work.
3. The proposed question/direction at the level the evidence supports.
4. One clear request, thanks, and a simple signature.

This is a default, not a word-count law. Prefer plain, field-appropriate
language. Remove ornamental praise, inflated adjectives, generic AI phrases,
and claims that the advisor's work is "perfectly aligned." Do not make the
student sound more senior, fluent, or certain than they are.

### 5. Audit before delivery

Check every proper noun, title, program, degree, intake, paper, method,
achievement, and attachment against its source. Then run the quality checklist
in the drafting guide.

If the user asks to send the message, stop at a final reviewed draft and ask
them to send it themselves. Do not open a mail client, send, or schedule mail.

## Output

In an Advisor Atlas project, write:

- `outputs/application-materials/<advisorProgramId>/outreach-email.txt`
- `outputs/application-materials/<advisorProgramId>/outreach-audit.md`
- `outputs/application-materials/<advisorProgramId>/literature/manifest.json`
- downloaded, hashed public PDFs under `literature/advisor-work/` and
  `literature/field-work/`

The email file is a clean copy-and-paste deliverable containing the recommended
subject, plain-text email, and attachment list. Put optional subject alternatives
in the audit unless the user explicitly wants them in the copyable file. Never
put `TEST`, `DRAFT`, `DO NOT SEND`, internal QA notes, or similar warnings in the
email file. Put every unresolved fact and user-check reminder in the audit and
final chat handoff. The audit contains:

- target advisor, exact program, mode, and intake;
- official contact-rule source and freshness;
- the evidence bridge with source IDs;
- claims removed or softened and unresolved facts;
- attachment rationale;
- one follow-up plan.

The audit must separate advisor/team literature from independent field
literature and list every source used in the draft by `literatureId`, canonical
URL, inspection level, supported wording, and the public advisor-author or
team-author relationship evidence. A paper title or `advisor_work` label alone is not an
evidence bridge.

For direct use outside a project, return the same two sections in chat or in
paths chosen by the user.

## Follow-up boundary

If no official rule exists, suggest at most one polite reply-in-thread after
roughly 7–14 days, adjusted for the deadline and local holidays. Add new value
only when real—such as an accepted paper, requested document, or clarified
question. No response is not evidence of rejection or dislike. After one
follow-up, stop unless the advisor replies or the user has a materially new
reason to contact them.
