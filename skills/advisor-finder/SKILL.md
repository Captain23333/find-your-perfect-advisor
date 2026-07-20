---
name: advisor-finder
description: >
  Use this skill whenever the user wants to find, research, or shortlist academic
  advisors, supervisors, or mentors for PhD, MPhil, MS, Postdoc, or RA applications.
  Triggers include: "find advisors", "find professors", "shortlist supervisors",
  "help me find a PhD supervisor", "导师", "套磁", "寻找导师", "筛选导师", or any
  request involving matching a CV/resume to faculty at specific schools, countries,
  or research areas. The skill parses the user's CV, discovers candidate advisors
  via web search and faculty pages, profiles each advisor, scores fit using weighted
  research interests, filters by recruiting status, and produces a complete multi-sheet
  Excel workbook ready for outreach. ALWAYS invoke this skill when the user mentions
  finding professors, advisors, or supervisors for graduate applications — even if
  they don't say "advisor-finder" explicitly.
---

# Advisor Finder

End-to-end pipeline: CV → weighted fit scores → recruitable advisor shortlist → Excel workbook with outreach angles.

## Inputs (collect before starting)

Ask the user to supply these. Items marked * are required; others have sensible defaults.

| Parameter | Description | Example |
|---|---|---|
| `CV` * | Resume file (PDF/MD/txt) | cv.pdf |
| `TARGET` * | Scope: country / specific schools / department / field ranking | "HKUST(GZ) Information Hub" / "US top-20 CS" / "Global LLM agent researchers" |
| `INTERESTS` * | Research areas + weights (will be auto-normalized to sum=1) | agent 0.4, reasoning 0.3, multimodal 0.2, medical 0.1 |
| `DEGREE` * | Target degree — drives recruiting filter logic | PhD / MPhil / MS / Postdoc / RA |
| `MAX_ADVISORS` | Cap on how many advisors to deeply profile (controls depth vs. breadth) | 25 (default) |
| `RECENCY_YEAR` | Threshold for "recent" papers (inclusive) | Current year − 2 (default) |
| `OUTPUT_LANG` | Language of the Excel output | 中文 / English / 双语 (default: match user's language) |
| `CONSTRAINTS` | Optional hard filters | "需全奖", "2026 Fall only", "exclude X university" |

If the user provides a CV file, read it first before asking questions.

---

## Pipeline Overview

```
Phase 0  Intake & Normalize    — Parse CV → candidate profile; normalize weights; lock degree + constraints
Phase 1  Roster Discovery      — Enumerate candidate advisors (name + homepage URL + initial relevance)
Phase 2  Per-Advisor Profile   — Deep-dive each advisor: directions, papers, recruiting, contact
Phase 3  Fit Scoring           — Score each interest dimension 0–10; compute weighted total
Phase 4  Recruiting Filter     — Tag ✅ / ❓ / ❌ per target degree; move ❌ to filtered block
Phase 5  Outreach Prep         — Rank top advisors; write angle, email subject, entry papers
Phase 6  Build Excel           — Multi-sheet workbook with formula-based totals + color coding
Phase 7  Verify                — Deduplicate, fill gaps, cite sources, confirm zero formula errors
```

Work through phases in order. Persist progress in `ADVISOR_STATE.md` so context compression doesn't lose work.

---

## Phase 0 — Intake & Normalize

1. **Parse CV** — extract: degrees/GPA, skills, publications (venue + status), projects, awards, stated research interests. Summarize as a **Candidate Profile** block.
2. **Normalize weights** — divide each weight by their sum so they total exactly 1.0. Show the normalized weights to the user before proceeding.
3. **Clarify scope** if `TARGET` is ambiguous (e.g., "top schools" — which country? which rank cutoff?).
4. **Confirm** degree and constraints. Hard constraints (funding, campus, entry term) will filter the candidate list, not just lower scores.
5. **Write `ADVISOR_STATE.md`** in the working directory with the candidate profile, normalized weights, and confirmed inputs.

---

## Phase 1 — Roster Discovery

Goal: produce a list of 30–60 candidate names with homepage URLs and an initial relevance note. You'll cull this to `MAX_ADVISORS` in Phase 2.

**Discovery strategy (try in priority order):**

1. **Official faculty / department pages** — search for the department's people/faculty page. *Warning: many are SPAs (JavaScript-rendered).* If `web_fetch` returns an empty shell or navigation only, fall through to the next strategy.
2. **Targeted web search** — query patterns like `"[school] [department] [area] assistant professor"`, `"[school] [area] faculty 2024"`. Enumerate names this way.
3. **CSRankings** (`csrankings.org`) — filter by school and research area; lists faculty with publication counts.
4. **Google Scholar labels / OpenReview / dblp** — search by keyword + institution.
5. **Claude in Chrome (if available)** — use to render SPA faculty pages that `web_fetch` can't handle.

Output format (add to `ADVISOR_STATE.md`):
```
| # | Name | School / Dept | Homepage URL | Initial relevance note |
```

Tell the user how many candidates were found and ask if they want to add or exclude anyone before proceeding to deep profiling.

---

## Phase 2 — Per-Advisor Profile

For each advisor in the roster (up to `MAX_ADVISORS`, prioritized by initial relevance):

**Fetch:**
- Personal homepage + lab page: research directions, lab name, group size, email, prospective student page.
- Google Scholar profile (sort by date): last-3-year publications (title, venue, year, role: 1st/corresponding/co-author).
- Any "Openings / Join us / Prospective Students" page.

**Recency rule (critical):**  
Check when the homepage was last updated. If it's not current year, **do not rely on it for paper info** — switch to Google Scholar sorted by date. A stale homepage ≠ inactive researcher.

**Per-advisor data to collect:**
```
Name | School | Dept | Title/Seniority
Research directions (bullet list)
Last-3-year papers: [Year] Venue – Title (role)
Recruiting status for [DEGREE]: [exact quote or "not found"]
Lab / group name
Email
Homepage URL | Scholar URL
Homepage last-updated | Recency source used (homepage / Scholar / dblp)
```

Save each profile to `ADVISOR_STATE.md` under a clearly labeled section.

---

## Phase 3 — Fit Scoring

For each advisor, score every interest dimension **0–10**:

| Score | Meaning |
|---|---|
| 9–10 | Core focus — primary/flagship research direction, recent 1st/corresponding-author papers at top venues |
| 6–8 | Active secondary direction — clear work in this area in the last 2 years |
| 4–5 | Adjacent / transferable — methodological overlap, not the main focus |
| 2–3 | Occasional mention — a paper or two, not sustained |
| 0–1 | No meaningful connection |

**Recency boost:** if the advisor has a 1st/corresponding-author paper in the area from the current year or last year, add 0.5–1 point. Rooted in why this matters: recent work signals active students and live collaborations — important for a new PhD student joining.

**Weighted total** = Σ(normalized_weight × dimension_score). This formula will be reproduced in Excel.

**Also write** a 1-sentence qualitative fit note per advisor: what specifically connects the candidate's background to this advisor's work.

---

## Phase 4 — Recruiting Filter

Determine recruiting status **specifically for the target degree** (`DEGREE`).

Three states:

- **✅ Recruitable** — explicit statement that they accept the target degree, or general "looking for students" with no exclusion of target degree.
- **❓ Confirm** — no explicit statement found (common for senior professors), or statement is ambiguous. Note what needs confirming.
- **❌ Filtered** — explicit statement ruling out the target degree (e.g., "I cannot recruit MPhil", "RA positions closed"). Move to a "Filtered Advisors" section in the state file with the exact quote and source URL.

**Do not omit filtered advisors** — keep them in the filtered block so the user can see why they were excluded.

Senior/endowed professors: flag them as high-competition / PhD-preferred rather than filtering, unless they explicitly exclude.

---

## Phase 5 — Outreach Prep

For the top ~15 advisors (ranked by weighted score, ✅ or ❓ only):

Per advisor, write:
1. **One-liner rationale** — why this advisor × this candidate is a strong match (one sentence).
2. **Outreach angle** — cite 1 specific recent paper by name + propose a concrete research direction that connects it to the candidate's background. Be specific: don't say "I'm interested in your work on agents" — say something like "Your 2025 ICLR paper on X showed Y; I wonder if combining it with my experience in Z could address W."
3. **Email subject** — follow any format the advisor's page specifies; otherwise use a clean format like `[PhD Inquiry] [Area] – [Candidate Name]`.
4. **3–5 entry papers** — papers the candidate should read before emailing: title, venue/year, one-sentence Chinese/English summary (match `OUTPUT_LANG`), reason it's relevant for the candidate.

---

## Phase 6 — Build Excel

Install openpyxl if needed: `pip install openpyxl --break-system-packages`

Then run `scripts/build_advisor_excel.py` to generate the workbook. If the script doesn't exist yet, create it from the template in `scripts/build_advisor_excel.py` in this skill directory.

**Sheet structure:**

| Sheet | Contents |
|---|---|
| `1_加权评分排序` | Rank · Advisor · School/Dept/Title · Homepage updated · Sub-scores (one col per interest, labeled with weight) · **Weighted total (Excel SUMPRODUCT formula)** · Recruiting ✅/❓/❌ · Priority · One-liner |
| `2_详情对照` | Advisor · School/Title · Recruiting status · Research directions · Last-3-yr papers · Fit note · Homepage URL · Email |
| `3_套磁优先级` | Rank · Advisor · Recruiting status · Outreach angle · Suggested email subject |
| `4_邮件模板` | Chinese template · English template · Per-advisor personalization checklist |
| `5_说明·权重·来源` | Weight methodology · Scoring rubric · Recency check log (which advisors used Scholar vs homepage) · Source URLs · Disclaimer |
| `6_入手论文` | Per top-advisor: 5 entry papers with title / venue / summary / why-fit |

**Formatting rules:**
- Weighted total column: use an Excel SUMPRODUCT formula referencing the sub-score columns and a weights row — so the user can adjust weights and the totals recalculate.
- Color rows by priority: green = ✅ top 5, yellow = ✅/❓ next tier, grey = ❓ confirm needed.
- Freeze header rows; enable AutoFilter on Sheet 1.
- After writing, run `python -c "import openpyxl; wb=openpyxl.load_workbook('FILE.xlsx'); wb.save('FILE.xlsx')"` to verify zero load errors.

---

## Phase 7 — Verify

Before handing off the Excel file:

- [ ] No duplicate advisors across sheets
- [ ] Every advisor has a source URL cited in Sheet 5
- [ ] All ❌-filtered advisors appear in Sheet 5 with the exact exclusion quote
- [ ] Weighted total formula recalculates correctly (change one sub-score, check total updates)
- [ ] Recency log in Sheet 5 notes which advisors needed Scholar fallback
- [ ] No cells show `#REF!`, `#NAME?`, or other formula errors
- [ ] Uncertain fields marked "需确认" / "to verify"

---

## Key Rules (read before starting)

**Homepage staleness is the #1 data quality risk.** Always check last-updated. If not current year, use Google Scholar (sort by date) as the primary paper source. A professor with a 2019-vintage homepage may have a stellar 2024–2025 publication record.

**Recruiting must be verified per degree.** "I'm looking for students" ≠ accepts MPhil. "Funded positions available" ≠ accepts RA. Read the exact words; if ambiguous, tag ❓.

**Personal homepage > official roster page** for actual information. Roster pages are often SPAs and rarely have research details.

**Scope discipline.** Don't try to profile 60 advisors deeply — you'll run out of context and lose quality. Pick the most relevant 20–25 from the roster, profile them well, and note others for expansion if the user wants.

**Co-advising and cross-campus routes are real options.** If a top candidate is senior/endowed/over-subscribed, mention that RA-first → PhD or co-supervision paths exist.

**Be honest about confidence.** Mark cells "to verify" rather than guessing. Users are about to send cold emails — wrong info hurts them.

**Cite everything.** Every advisor profile must have homepage URL and Scholar URL (if used). Sheet 5 must list all sources.

---

## State File: ADVISOR_STATE.md

Maintain this file throughout. Structure:

```markdown
# Advisor Finder State

## Candidate Profile
[extracted from CV]

## Normalized Weights
[area: weight pairs]

## Confirmed Inputs
TARGET: ...  DEGREE: ...  MAX_ADVISORS: ...

## Roster (Phase 1)
| # | Name | School/Dept | URL | Initial relevance |

## Advisor Profiles (Phase 2)
### [Name]
...

## Scores (Phase 3)
| Name | [dim1] | [dim2] | ... | Weighted Total | Fit note |

## Recruiting Filter (Phase 4)
| Name | Status | Quote | Source |

## Filtered ❌
| Name | Reason | Quote |

## Outreach Prep (Phase 5)
### [Name]
...
```

Update after each phase so the work survives context compression.

---

## Disclaimer (include in Sheet 5)

Recruiting status, titles, and publications change. Verify all information on each advisor's homepage and the school's graduate admissions site before sending any email. This table is a research aid, not a guarantee of admission or availability.
