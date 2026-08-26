# RP literature-review workflow

An application RP normally needs a focused, critical mini-review, not a claim
of exhaustive systematic coverage. Its job is to show what is known, what is
contested or bounded, where the proposed question enters, and why the proposed
method is a credible way to learn something new.

## 1. Search plan

Record before searching:

- question anchor and 2–4 concept families;
- synonyms, abbreviations, related constructs, and exclusion terms;
- suitable scholarly databases or field indexes;
- date/language/document-type boundary and rationale;
- seminal seed works and recent review/benchmark works when available;
- inclusion and exclusion criteria proportional to the RP.

Search recent work and trace backward from central papers and forward through
citing work. Record the actual queries and search date. Use a representative
review by default. If the user claims completeness, change to a systematic
protocol; a long reference list is not proof of completeness.

## 2. Evidence ledger

For every source used, capture:

| ID | Citation/DOI/URL | Inspection | Question | Method/sample/context | Supported finding | Limitation | Module | Proposed-study use |
|---|---|---|---|---|---|---|---|---|

Allowed inspection labels:

- `full_text_inspected`
- `abstract_inspected`
- `metadata_only`
- `unavailable`

Metadata-only sources may establish identity, year, venue, or retrieval leads;
they may not support detailed findings or limitations. Abstract-only evidence
must be described at abstract strength. Verify title, authors, year, venue, and
DOI/URL before final citation.

## 3. Analytical modules

Create 3–5 modules around different sub-questions, mechanisms, actors, stages,
contexts, outcomes, or method families. Each module should have an inclusion
boundary and should advance the main question. Avoid "Paper A says... Paper B
says..." organization and generic sections such as background/status/problems.

For each module, write:

1. the claim or sub-question;
2. strongest consensus and its evidence boundary;
3. meaningful disagreement or missing observation;
4. implications for the proposed question/design.

## 4. Contradiction map

When studies differ, compare the exact claim across:

- population/object and sample selection;
- operational definition or outcome measure;
- method and analysis;
- time window and context;
- theoretical assumptions;
- data quality and access.

Do not write only "the literature is mixed." State whether the conflict may be
a real boundary condition, a measurement difference, a method limitation, or
still unexplained. Mark explanations as inference unless directly tested.

## 5. Gap test

A defensible gap answers all four:

1. What has prior work established?
2. Where exactly does explanation, observation, or validity stop?
3. What specific opening will the proposal enter?
4. Why would that opening change understanding or practice?

Use theory, method, data, context/boundary, contradiction, or integration gaps
only when evidence supports the label. "Few studies" and "no one has studied"
are not sufficient. The applicant's failure to find a paper is not a field gap.

## 6. Stop rule

Stop expanding the ordinary RP review when the central claims, closest work,
main contradiction/boundary, and method precedent are sufficiently stable to
justify the proposal within its word budget. Record thin or inaccessible areas
instead of hiding them. Continue when a central novelty claim still rests on an
unverified absence or only one search route.

## Research basis

- Aston University describes the proposal review as a brief critical review of
  key contemporary literature that develops the rationale and theoretical
  basis of the research questions:
  https://www.aston.ac.uk/postgraduate-research/phd/propose-your-own-research/how-to-write-a-research-proposal
- Sussex links questions, critical engagement, original contribution,
  methodology, ethics, timeline, and bibliography:
  https://www.sussex.ac.uk/study/phd/apply/tips-research-degrees/research-proposal
- The open `literature-review-skills` package routes from question refinement to
  modules, method comparison, contradiction mapping, and a four-question gap
  test; this skill adopts that staged logic without copying its fixed output:
  https://github.com/xingtaxueshu/literature-review-skills
- The open SkillMedev literature-review skill distinguishes a thematic argument
  from an annotated bibliography and routes exhaustive claims to a systematic
  review protocol:
  https://github.com/SkillMedev/academic-researcher/blob/main/skills/literature-review/SKILL.md
- A login-read Xiaohongshu RP breakdown usefully emphasizes the same internal
  loops: the review supports the gap, methods answer questions, expected results
  are not actual findings, and discussion returns to the review context:
  https://www.xiaohongshu.com/explore/6a29637c000000001702bef5
- A second Xiaohongshu post offers a one-day sequence from title to questions,
  review, gap, and methods. Use the sequence only; its time claim is anecdotal
  and cannot replace source verification, ethics, access, or feasibility work:
  https://www.xiaohongshu.com/explore/68b091fe000000001d037fe5
