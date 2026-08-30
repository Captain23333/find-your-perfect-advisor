---
name: advisor-research-proposal
description: >
  Plan, research, draft, adapt, or audit a Research Proposal or concept note for
  one exact advisor-program target. Follow official requirements, ground gaps
  and citations in inspected literature, align questions with feasible methods,
  and separate evidence from hypotheses. Excludes a full systematic review
  unless explicitly required.
---

# Advisor Research Proposal

Produce a proposal that demonstrates a worthwhile question, command of the
relevant scholarly conversation, a defensible opening, and a feasible plan. A
proposal is not a prediction that all methods, results, or contributions will
survive unchanged during the degree.

Load only what the current mode needs:

- Read [references/literature-review.md](references/literature-review.md) before
  searching, synthesizing, or making/reviewing a gap claim.
- Read [references/proposal-gates.md](references/proposal-gates.md) before a
  final-form draft or final audit. A narrow early question-refinement turn does
  not need all six gates yet.
- Read [references/latex-delivery.md](references/latex-delivery.md) only before
  creating, compiling, or visually checking applicant-facing files.
- Read [../advisor-pipeline/references/application-materials-contract.md](../advisor-pipeline/references/application-materials-contract.md)
  inside Advisor Atlas before literature download or artifact generation.

## Required target and requirement gate

### Applicant identity and CV preflight

Before official-format research, literature search, or drafting, require:

- a real, readable CV for the applicant represented by the proposal; and
- the applicant's confirmed real or preferred professional name.

This preflight is idempotent project-state validation, not a repeated intake
question. In Advisor Atlas, resolve and reuse the CV already referenced by
`project.json.cv` under `inputs/`; in direct use, inspect the current project
state, `inputs/`, and any explicit CV path already supplied before asking the
user. If a usable current-applicant CV is present, do not ask the user to
upload, attach, paste, or restate it. If the proposal needs one fact absent from
the CV, ask for that fact specifically instead of requesting the CV again.

Read the CV and use it as the only default source for applicant education,
projects, publications, methods, skills, awards, and prior results. If the CV is
missing, unreadable, clearly a sample, belongs to another person, omits a name,
or conflicts with the supplied name, pause and ask for the exact missing input.
Do not create `.tex`, `.bib`, PDF, or applicant-facing draft files while this
gate is unresolved. Never insert `Your Name`, `Alex Chen`, or another example
identity. If the official template requires anonymous review, keep the name out
of the PDF while retaining the confirmed identity and CV as the grounding
source.

Use an exact `advisorProgramId`. Do not infer the target from rank alone. Read:

- `outputs/ranking.json` or `outputs/candidates.json`;
- the selected advisor and program entries in `outputs/advisor_records.json`
  and `outputs/program_records.json`;
- `outputs/evidence.json` and relevant Detective results;
- the user's CV, existing research notes, and prior work;
- the official RP/application instructions for the named degree and intake.

Before substantive drafting, record:

- purpose: application RP, pre-contact concept note, advertised-project response,
  funding proposal, or revision;
- official length, sections, language, file format, citation style, and deadline;
- whether the topic is applicant-proposed or constrained by an advertised project;
- advisor/lab fit evidence and any required facilities, datasets, or methods;
- known access, ethics, cost, time, skill, and supervision constraints.

Official instructions override this skill. First determine whether the target
actually requests an RP, a research statement, a Statement of Purpose, an
advertised-project response, or no research document. Do not relabel one as
another. If the user still wants an RP for discussion when the application does
not request one, produce a polished `research concept note` and record that use
case only in the separate review/audit, not as a warning banner in the document.

If no official template or limit can be found, use the professional fallback in
the LaTeX delivery reference. Call it a fallback, never an international rule.

## Modes

- `develop`: move from a broad interest to an evidence-grounded proposal.
- `adapt`: tailor a defensible core project to one advisor/program without
  changing the research identity merely to flatter the target.
- `review`: audit an existing RP and propose bounded repairs before rewriting.
- `concept_note`: create a short discussion document when a full RP is premature.

## Workflow

### 1. Define the question anchor

Turn the topic into one main question that specifies the phenomenon or
relationship, relevant context/population/system, and the uncertainty to be
resolved. Generate alternatives and test their scope before selecting one.
Derive a small set of aims/objectives that answer parts of the main question;
do not create parallel projects disguised as objectives.

### 2. Build the mini-review

Follow the literature-review reference. In brief:

1. Define query families, databases/sources, date range, and inclusion boundary.
2. Combine seminal/field-defining work with recent frontier work.
3. Inspect sources and record evidence level; do not make substantive claims
   from metadata alone.
4. Extract comparable claims, method, sample/context, result, limitation, and
   relevance to the proposed question.
5. Organize evidence into 3–5 analytical modules, not one paragraph per paper.
6. Map consensus, exact contradictions, boundary conditions, and method/data gaps.
7. State the gap only when the reviewed evidence supports it. Otherwise label
   it `candidate_gap_needs_verification`.

Do not call an ordinary application mini-review systematic. If defensible
completeness, PRISMA, protocol registration, risk-of-bias appraisal, or a formal
systematic review is required, pause ordinary drafting and build the required
protocol and screening log first.

### 3. Convert the gap into a study

For each research question or objective, build a design matrix:

| RQ/objective | Construct or phenomenon | Data/source | Sampling/access | Method | Analysis | Validity/limitations | Ethics | Feasibility evidence |
|---|---|---|---|---|---|---|---|---|

The proposed method must answer the question and be supportable within the
degree's time and resources. Explain access and analysis, not only method labels.
When access, measurement, recruitment, equipment, compute, language, or ethics
is uncertain, state an assumption, verification action, and fallback. Do not
present an unavailable dataset, partnership, lab facility, or participant pool
as secured.

### 4. State contribution at the right evidence level

Separate:

- scholarly premise supported by inspected literature;
- applicant hypothesis or expected result;
- proposed methodological/design contribution;
- practical or policy relevance;
- fit with the advisor/lab/program.

Use `will investigate`, `aims to test`, or `could contribute` for proposed work.
Do not say the project will prove, solve, transform, or deliver an outcome that
has not been established.

### 5. Draft to the official structure and format

Use the official template, file type, headings, citation style, page/word limit,
font, spacing, and anonymisation rule when available. When none is specified,
use only the sections needed from this fallback spine:

1. Working title and concise project summary.
2. Context, problem, and significance.
3. Research question, aims, and objectives.
4. Critical literature synthesis and defensible gap.
5. Conceptual/theoretical framework where useful.
6. Research design, data, sampling/access, methods, and analysis.
7. Ethics, limitations, risks, and fallback routes.
8. Timeline, milestones, resources, and feasibility.
9. Expected contribution and advisor/program fit.
10. References and optional appendices.

Every section must serve the same question. Remove attractive but disconnected
background, methods, or claimed impacts.

### 6. Verify and red-team

Apply all proposal gates. Check citation identity and support, question–method
alignment, target fit, access, ethics, timeline, and word budget. Include the
strongest reviewer objection and either answer it with evidence or narrow the
claim. The applicant must approve the intellectual direction and be able to
defend every cited claim and design choice.

## Output

In an Advisor Atlas project, write:

- `outputs/application-materials/<advisorProgramId>/research-proposal.tex`
- `outputs/application-materials/<advisorProgramId>/references.bib`
- `outputs/application-materials/<advisorProgramId>/research-proposal.pdf`
- `outputs/application-materials/<advisorProgramId>/proposal-build.json`
- `outputs/application-materials/<advisorProgramId>/proposal-evidence.md`
- `outputs/application-materials/<advisorProgramId>/proposal-review.md`
- `outputs/application-materials/<advisorProgramId>/literature/manifest.json`
- downloaded, hashed public PDFs under `literature/advisor-work/` and
  `literature/field-work/`

`proposal-evidence.md` records search scope, source identity, inspection level,
claim extraction, contradiction/gap status, and citation verification.
`proposal-review.md` records official requirements, the design matrix, gate
results, unresolved assumptions, strongest objection, user decisions, and
whether the PDF is an application-required RP or a discussion concept note.

The `.tex` and PDF are applicant-facing, final-form documents. Do not put
`TEST`, `DRAFT`, `DO NOT SUBMIT`, `not submission-ready`, internal QA notes, or
similar warnings in them. Put every unresolved fact, compliance warning, and
request for user checking in `proposal-review.md` and the final chat handoff.
Professional presentation is not authorization to submit.

Every source actually used in the RP must name its `literatureId` in
`proposal-evidence.md`; both advisor/team and independent field literature are
required. For each advisor/team item, record whether the selected advisor is an
author or which matched author is a verified team member, with a public
relationship URL; do not treat a self-declared category as proof of fit. Use the shared deterministic downloader and never treat a title,
metadata page, or unverified DOI as proof that a paper exists or supports a
claim.

Use BibTeX/BibLaTeX keys identical to `literatureId`; every source marked as
used in the RP must appear in `references.bib` and be cited in the `.tex`.
Compile with the shared deterministic builder, then render every PDF page and
visually inspect typography, margins, page breaks, tables, references, and
overfull/underfull output before delivery. Do not submit the proposal.
