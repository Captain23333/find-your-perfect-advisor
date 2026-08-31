# Excel runtime compatibility

## Problem

The three shipped workbook builders imported `@oai/artifact-tool` statically.
That package is available in selected Codex spreadsheet runtimes but is not a
normal public dependency installed by this repository. A regular Web or direct
CLI user could therefore complete the structured research but fail while
creating the `.xlsx` file.

An Agent could then attempt to write a temporary OpenXML builder under `runs/`.
That fallback was nondeterministic, consumed extra context and tool calls, and
could loop on `apply_patch verification failed` when the temporary file no
longer matched the patch context. The Web completion gate compounded the issue
by accepting JSON alone and reporting the phase complete while its documented
workbook was missing.

## Options considered

| Option | Benefit | Main risk | Decision |
| --- | --- | --- | --- |
| Require the private spreadsheet runtime | Highest feature parity | Ordinary Windows/Web/CLI users cannot install it | Rejected |
| Add a public Excel npm package | Mature workbook API | Adds network installation, supply-chain surface and a new direct-CLI setup step | Rejected |
| Let each Agent generate a fallback script | No repository code change | Nondeterministic, token-heavy and already failed in a real run | Rejected |
| Ship a narrow OOXML fallback and keep Artifact Tool as the preferred engine | No user install; deterministic and cross-platform | The fallback must be kept within a deliberately small supported feature set | Selected |

## Implemented design

- `workbook-runtime.mjs` first loads `@oai/artifact-tool` dynamically.
- If the package is unavailable or fails on an incompatible host, it writes a
  standards-based XLSX package using Node built-ins only. The fallback supports
  the features used by Advisor Atlas:
  multiple sheets, typed cells, formulas, number/date formats, wrapped headers,
  widths, frozen panes, filters, tables and status conditional formatting.
- All three builders use the same declarative workbook specification, so the
  preferred and portable engines receive identical rows, formulas and columns.
- The Agent is instructed to run the shipped builder and never install a
  spreadsheet package or patch a temporary replacement executable.
- Finder, Detective and Ranking now require both their structured JSON and the
  corresponding complete XLSX before a Web run becomes `completed`.
- Cross-platform tests exercise the portable engine on Ubuntu, macOS and
  Windows, including a working directory containing spaces and non-ASCII
  characters and a simulated present-but-incompatible optional runtime.

## Residual risks and controls

- **OOXML compatibility:** the fallback intentionally implements only the
  workbook features used here. Its outputs are package-checked in every CI run
  and imported, inspected and rendered with the Codex Spreadsheet Runtime during
  release verification.
- **Feature drift:** future workbook features must be added to the shared
  declarative runtime rather than embedded in one builder. CI executes all
  three sample builders to catch divergence.
- **Stale or corrupt workbooks:** the Web verifier rejects missing, pre-run,
  truncated or non-ZIP `.xlsx` files and reports `partial` rather than silently
  advancing.
- **Lower-fidelity preview outside Codex:** portable generation does not promise
  local PNG rendering when the Spreadsheet Runtime is absent. The XLSX remains
  the authoritative deliverable and is verified in the release environment.
