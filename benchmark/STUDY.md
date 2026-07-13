# A conformance & reliability study of public MCP servers

Protocol for running `mcp-probe` as an empirical measurement study across the
public Model Context Protocol (MCP) server ecosystem. The output is a citable
dataset + preprint; see the brand's `academic-citations.md` for why this is the
highest-leverage citation move. This file makes the study reproducible so results
hold up to scrutiny and can be re-run as the ecosystem and the spec evolve.

## Research questions
- **RQ1 (conformance).** What fraction of public MCP servers initialize
  successfully and advertise spec-valid tool `inputSchema` definitions?
- **RQ2 (drift).** Which schema/spec deviations are most common, and do they
  cluster by language, SDK version, or authoring pattern?
- **RQ3 (reliability).** What is the latency distribution of protocol operations,
  and how do servers behave on malformed or edge-case requests?

## Sample frame (reproducible)
- **Reference set:** every server in `modelcontextprotocol/servers` at a pinned
  commit SHA (record the SHA in the released dataset).
- **Community set:** public servers discoverable via a pinned snapshot of a public
  MCP registry / a GitHub topic search (`topic:mcp-server`), filtered to those that
  declare a runnable launch command. Record the exact query, date, and result count.
- Record inclusion/exclusion counts and reasons (e.g., requires paid credentials,
  no stdio transport) so the frame is auditable. Log every dropped server — no
  silent truncation.

## Metrics (all machine-collected by `mcp-probe --json`)
| Metric | Source |
|---|---|
| initializes (bool) | handshake result |
| declared protocol version | `initialize` response |
| tool count | `tools/list` |
| tools with valid inputSchema (count / %) | schema linter |
| deviation types (enumerated) | schema linter |
| p50 / p95 latency (ms) | latency timer |
| malformed-request behavior (error vs hang vs crash) | safe round-trip probe |

## Procedure
1. Pin versions: Node runtime, `mcp-probe` release tag, reference-set commit SHA.
2. For each server: install per its README in an isolated sandbox, run
   `mcp-probe --json --call`, capture stdout + exit code + wall-clock time.
3. Store one JSON record per server, plus a run-level manifest (dates, versions,
   host). Never send credentials; only probe servers runnable without secrets, and
   note the ones excluded for needing them.
4. Aggregate into `results/summary.csv` + keep raw per-server JSON in `results/raw/`.

## Threats to validity (state honestly in the paper)
- Sample is GitHub-visible servers only; not representative of private/internal ones.
- Latency depends on host and network for servers that reach external services.
- The spec is a moving target; results are tagged to a spec version and a date.

## Outputs (the citable objects)
- **Dataset:** `results/` archived to Zenodo with a versioned DOI.
- **Preprint:** an arXiv paper (cs.SE / cs.AI) reporting RQ1-RQ3, citing the tool
  paper and the dataset DOI. This is the object other researchers cite.
- Re-run each MCP spec release to produce a longitudinal series (v0 baseline, then
  deltas) — longitudinal datasets accrue citations over time.

## Ethics / guardrails
Public servers only. Read-only / explicitly-safe calls only — never trigger
side-effecting tools. No credentials, no rate-limit abuse (throttle, identify the
probe in the handshake where possible). Report findings in aggregate; do not
name-and-shame individual authors — frame as ecosystem health, not a leaderboard of
failures.
