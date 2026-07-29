# Local advisor community sources

Use these third-party sources only when a reputation-related investigation
section is selected and the user explicitly consents to local download.

## Sources

| Source | Link | Current access note | Evidence role |
| --- | --- | --- | --- |
| User-provided blacklist PDF | https://drive.google.com/file/d/1DMpkLQMIvk7-bO8lux1cU1YNth6s0J3h/view | Public view/download observed on 2026-07-28 | Anonymous lead |
| User-provided Advisor Red Flags document | https://docs.google.com/document/d/1-AtKUh-xE1CPRRDVlfPx1d42Trhr7F8qQIw69hP85Ds/edit | Public view/text export observed on 2026-07-28 | Anonymous lead |
| Advisor Ledger mirror/history | https://github.com/the-hidden-fish/advisor-ledger/ | Useful for change history; not independent corroboration | Same-source copy |
| Append Advisor Reviews | https://append.page/p/advisors | Anonymous review platform | Anonymous lead |

Public accessibility does not establish ownership, licensing, or redistribution
permission. Keep only links, access notes, sync code, and evidence/privacy rules
in the public repository. Never commit downloaded contents.

## Local files

The direct Skill sync script writes beside this reference:

- `community-blacklist-current.pdf`
- `community-blacklist-current.txt`
- `community-red-flags-current.txt`
- `community-knowledge-metadata.json`
- `community-links.json`

The Web console stores the equivalent files in the current application
project's `community-cache/` directory. Both locations are Git-ignored.

## Consent and refresh

1. Persist the exact selected advisors and sections first.
2. Explain that the files are third-party community material saved locally.
3. Require explicit consent.
4. Refresh only when the cache is missing, the user requests refresh, or the
   current investigation requires a newer snapshot.
5. Offer a clear-cache action.

Do not refresh merely because a Pipeline run started or because a fixed number
of hours elapsed.

## Search

Require metadata `search_ready` or `searchReady` to be true. Search the
extracted text with full English name, Chinese name, institution, and lab name.
Read surrounding context and preserve rebuttals, corrections, dispute labels,
and dates.

If PDF extraction failed, report `未完成检索`. Never convert it to “未发现该导师”.

## Evidence and privacy

- Label anonymous and identity-unconfirmed content `anonymous_lead`.
- Label mirrors and reposts `same_source_copy`; they do not add corroboration.
- Open relevant original links when possible.
- Continue checking other relevant sources such as X/Twitter, 小红书, Reddit,
  Rate My Professors, institutional records, papers, retractions, or identified
  firsthand accounts.
- Do not lower a score merely because an advisor appears on a list.
- Do not omit counterclaims or later corrections.
- Do not output student names, contact details, health information, private
  family information, or doxxing-enabling details.
- Report unresolved claims neutrally and state how the user could verify them.
