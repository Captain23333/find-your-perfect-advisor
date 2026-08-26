# LaTeX and PDF delivery

The target program's official specification is the format contract. A common
academic layout is only a fallback when no official template, page limit, word
limit, or citation style is available.

## Format decision

Record the decision in `proposal-review.md` before authoring:

1. Official document type: RP, research statement, Statement of Purpose,
   project response, concept note, or not requested.
2. Required file type/template, page or word limit, font, spacing, margins,
   headings, citation style, anonymisation, and filename.
3. Source URL, page title, retrieval date, exact instruction, and unresolved
   ambiguity.
4. Delivery choice and reason. If an RP is not requested but the user wants a
   discussion document, label it `Research Concept Note` in the document and
   keep the application mismatch in the review file and chat handoff.

Never claim that one structure is internationally universal. In the absence of
official instructions, use a readable 10.5--12 pt professional layout, roughly
25--32 mm margins, restrained headings, page numbers, and the relevant subset
of:

- title and concise abstract/summary;
- problem, significance, and research question;
- critical related work and bounded gap;
- aims or hypotheses;
- study design, data/participants, methods, and analysis;
- ethics, limitations, risks, and fallback;
- feasibility, resources, and timeline;
- expected contribution and target fit;
- references.

The section logic matters more than reproducing every heading.

## Citation contract

- Store references in `references.bib`.
- Use each manifest `literatureId` as its BibTeX key, for example
  `\citep{LIT-A01}`.
- Verify title, authors, year, venue, DOI, canonical URL, and entry type against
  the inspected paper's own reference block or front matter. Do not use the
  repository upload year as the publication year, and do not copy a DOI from a
  search result without matching it to the downloaded paper.
- Every source whose `usedIn` includes `research_proposal` must appear in the
  bibliography and be cited in the `.tex`; do not create uncited bibliography
  padding.
- The PDF reference list must render human-readable entries, not raw keys or
  unresolved `?` markers.

## Build and visual QA

After writing the `.tex`, `.bib`, evidence, and review files, run:

```bash
node .agents/skills/advisor-pipeline/scripts/build_research_proposal.mjs \
  --root "$PWD" \
  --advisor-id exact-advisor-program-id \
  --confirmed-revision 1 \
  --confirmed-fingerprint sha256
```

The script compiles with `latexmk`, writes `research-proposal.pdf`, and records
source/PDF hashes in `proposal-build.json`. A successful exit is not visual QA.
Render all pages with Poppler, inspect the PNGs, and fix:

- clipped, overlapping, orphaned, or nearly empty pages;
- overfull lines, broken URLs, unresolved citations, and missing glyphs;
- inconsistent heading hierarchy, spacing, tables, captions, or page numbers;
- references split or compressed into an unreadable block.

Also extract text from the final PDF and confirm the title, every section,
citation text, bibliography, and final page are present. Keep compiler files in
`build/`; deliver the `.tex`, `.bib`, PDF, and audit files from the target root.
