# Official application facts

Read this reference after the research-fit shortlist is available.

## Search scope

Collect application facts only for shortlisted advisor-program combinations.
Reuse facts already captured while reading advisor, lab, or prospective-student
pages. Query only missing or stale fields.

Use sources in this order:

1. Official graduate-school and program admissions pages.
2. Official university tuition and fee pages.
3. Official university, government, or funder scholarship pages.
4. Verified advisor or laboratory pages for advisor-specific recruiting and
   contact requirements.
5. Official QS pages for the named ranking edition.

Do not use community posts to assert deadlines, tuition, materials, or formal
eligibility.

## Required fields

- School name.
- Latest requested QS overall rank and edition.
- Program name in English and Chinese when an official translation exists.
- Degree, intake, and official program URL.
- Application deadline, including timezone when stated.
- Tuition with currency and charging period.
- Scholarships, coverage, eligibility, and application path.
- Application requirements and materials in one multiline field.
- Research proposal length or format; use `not_found` if the named official
  sources were checked and no requirement was stated.
- Advisor recruiting and contact requirements in one multiline field.
- Source URLs and last verified date.

Do not translate an unofficial program name as though it were official. Mark a
helpful translation as `assistant translation`.

## Objective feasibility

Keep objective feasibility separate from research fit.

Hard failure examples:

- The official deadline has passed for the target intake.
- The program or advisor explicitly excludes the target degree.
- A stated mandatory qualification is clearly absent from the candidate
  profile.
- A user-declared hard constraint is contradicted.

Warnings, not automatic failures:

- Recruiting or funding is unclear.
- The official page does not state an RP limit.
- A ranking or budget preference is missed unless the user made it a hard
  constraint.
- Sources conflict or appear stale.

Return `eligible`, `ineligible`, or `needs_confirmation`, plus exact reasons.
