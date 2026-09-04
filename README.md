# mcp-probe

[![CI](https://github.com/itguruhaseeb/mcp-probe/actions/workflows/ci.yml/badge.svg)](https://github.com/itguruhaseeb/mcp-probe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Lint and health-check any [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server, over stdio, in one command.

```
npx @hafsar/mcp-probe -- node ./my-server.js
```

## Why this exists

MCP is spreading fast, but the tooling around it is still immature. Most servers
are hand-written, their tool `inputSchema` definitions drift out of spec, and the
first time anyone notices is when an LLM constructs a malformed tool call in
production. `mcp-probe` gives you a fast, dependency-light way to point at a
server, run the handshake, and get a straight answer: does it initialize, are its
tools well-formed, and how fast does it respond. Think of it as `eslint` plus a
smoke test for MCP servers.

It talks the MCP wire protocol directly (newline-delimited JSON-RPC 2.0 over the
child process's stdin/stdout) rather than depending on the full MCP SDK, which
keeps the install light and the behavior transparent.

## Install and run

No install required. Point it at the command that launches your server, after a
`--` separator:

```bash
npx @hafsar/mcp-probe -- node ./server.js
npx @hafsar/mcp-probe -- python server.py
npx @hafsar/mcp-probe --call -- node ./server.js
npx @hafsar/mcp-probe --json -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

Everything after `--` is treated as the server launch command. Requires Node 18
or newer.

## Example output

Run against the bundled example server:

```bash
node bin/mcp-probe.js -- node examples/echo-server.js
```

```
mcp-probe v0.1.2
target: node examples/echo-server.js

Handshake
  ✓ initialized in 49.4ms
  • server: echo-server v1.0.0
  • protocol: 2025-06-18
  • capabilities: tools

Tools (3)
  ! echo: 1 warning
      ! tool declares no safety hints (readOnlyHint/destructiveHint/idempotentHint/openWorldHint)
  ! add: 1 warning
      ! tool declares no safety hints (readOnlyHint/destructiveHint/idempotentHint/openWorldHint)
  ! ping: 1 warning
      ! tool declares no safety hints (readOnlyHint/destructiveHint/idempotentHint/openWorldHint)
  tools/list in 0.4ms

Summary: healthy (3 tools, 0 errors, 3 warnings)
```

The bundled example server deliberately declares no safety annotations, so this
run doubles as a demonstration of that check. Warnings do not fail the run.

Against a server with schema problems, it points at the exact issue and exits
non-zero:

```
Tools (2)
  ✗ broken: 1 error, 2 warnings
      ! tool has no "description" (LLMs rely on it to choose the tool)
      ! tool has no "title" annotation
      ✗ inputSchema.required references "missing" which is not in properties
  ! notype: 2 warnings
      ! tool has no "title" annotation
      ! inputSchema has no "type" (expected "object")

Summary: unhealthy (2 tools, 1 error, 4 warnings)
```

## What it checks

**Handshake**

- Performs `initialize` with `clientInfo` of `mcp-probe` and sends
  `notifications/initialized`.
- Reports the server name, version, negotiated protocol version, and declared
  capabilities.
- Flags a mismatch between the protocol version the client offered and the one
  the server negotiated.

**Tools** (`tools/list`)

For every tool, it lints the `inputSchema` as a JSON Schema:

- `type` is present and is a valid JSON Schema type.
- `properties` is a well-formed object of schema objects.
- every entry in `required[]` actually exists in `properties`.
- `required[]` is an array with no duplicates and no non-string entries.
- warns on a missing `description`, a missing `title`, or an empty schema (a tool
  that declares no structured input).

**Resources and prompts**

- If the server declares `resources` or `prompts` capabilities, it calls
  `resources/list` and `prompts/list` and reports the counts.

**Latency**

- Times the handshake and each list call, so you can spot a slow server.

**Round-trips** (opt-in, `--call`)

- For each tool that has no required parameters, it performs a real `tools/call`
  with empty arguments and reports whether the server returns cleanly. Tools with
  required parameters are skipped; `mcp-probe` never fabricates argument values,
  so it will not accidentally trigger a destructive operation. Round-trips are
  off by default (list and lint only).

## Flags

| Flag             | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `--call`         | attempt a safe round-trip on tools with no required parameters     |
| `--json`         | emit machine-readable JSON instead of the human report             |
| `--sarif`        | emit SARIF 2.1.0 instead of the human report                       |
| `--sarif-artifact <path>` | file the SARIF findings are attributed to                 |
| `--timeout <ms>` | per-request timeout in milliseconds (default `10000`)              |
| `-h`, `--help`   | show help                                                          |
| `-v`, `--version`| show version                                                       |

`--json` and `--sarif` both write to stdout, so asking for both is a usage error
(exit `2`) rather than a file that is neither format.

The `--json` output is the same structured object the human report is rendered
from, suitable for CI. The process exits non-zero on any hard failure (handshake
failure or an invalid tool schema), so you can gate a build on it:

```bash
npx @hafsar/mcp-probe --json -- node ./server.js || echo "MCP server is unhealthy"
```

### Exit codes

`mcp-probe` exposes a stable exit-code contract for scripts and CI pipelines:

| Code | Meaning |
| --- | --- |
| `0` | The probe completed without hard failures (or help/version was requested). |
| `1` | The probe completed with a hard failure, such as a failed handshake or invalid tool schema. |
| `2` | The command was invoked incorrectly, or the probe stopped because of an unexpected internal error. |

Warnings do not change the exit code. Use `--json` when a pipeline also needs the
structured diagnostics behind the result.

### Rule ids

Every finding carries a stable `id` alongside its message, in both the human
report's underlying data and the `--json` output:

```json
{
  "id": "schema/required-not-in-properties",
  "severity": "fail",
  "message": "inputSchema.required references \"ghost\" which is not in properties"
}
```

Filter and count on the id, never on the message. Messages get reworded; ids do
not. Renaming one is a breaking change, the same as changing an exit code.

| Rule id | Severity | What it means |
| --- | --- | --- |
| `schema/empty-contract` | warning | object schema declares no properties |
| `schema/invalid-type` | error | type is not a valid JSON Schema type |
| `schema/missing` | error | inputSchema is absent |
| `schema/no-type` | warning | root schema declares no type |
| `schema/non-object-root` | warning | root schema type is not object |
| `schema/not-an-object` | error | inputSchema is not a JSON object |
| `schema/properties-not-an-object` | error | properties is not an object |
| `schema/property-not-a-schema` | error | a property value is not a schema object |
| `schema/required-duplicate` | warning | required lists the same key twice |
| `schema/required-non-string` | error | required contains a non-string entry |
| `schema/required-not-an-array` | error | required is not an array |
| `schema/required-not-in-properties` | error | required names a key absent from properties |
| `schema/required-without-properties` | error | required is set but properties is absent |
| `schema/type-not-a-string` | error | type is neither a string nor an array of strings |
| `tool/missing-description` | warning | tool has no description |
| `tool/missing-name` | error | tool has no name |
| `tool/missing-title` | warning | tool has no title |
| `tool/no-safety-hints` | warning | tool declares no safety annotations |

The registry lives in `RULES` in [`src/linter.js`](./src/linter.js) and is
asserted against a literal list in `test/rules.test.js`, so the set cannot change
without a visible diff.

### SARIF output

`--sarif` emits a SARIF 2.1.0 log, which is the format GitHub code scanning
ingests. Uploading it turns a conformance run into annotations on the pull
request instead of text in a job log.

```bash
npx @hafsar/mcp-probe --sarif -- node ./server.js > mcp-probe.sarif
```

In a workflow, with `security-events: write` permission:

```yaml
- name: Probe the MCP server
  run: npx @hafsar/mcp-probe --sarif -- node ./server.js > mcp-probe.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: mcp-probe.sarif
```

`continue-on-error` is there on purpose: without it a failing probe ends the job
before the findings are uploaded, so you lose the annotations that explain why.

The mapping is thin and mechanical:

| SARIF | Source |
| --- | --- |
| `tool.driver.rules` | the `RULES` registry in `src/linter.js`, every rule, always |
| `result.ruleId` | the finding's `id` |
| `result.level` | the finding's severity, `fail` to `error` and `warn` to `warning` |
| `result.message.text` | the tool name, then the finding's message |
| `partialFingerprints` | tool name plus rule id, so re-runs update an alert rather than duplicating it |
| `invocations[0].toolExecutionNotifications` | handshake failures, protocol mismatches and other run-level problems, which belong to no rule |

SARIF results are shaped around files, and `mcp-probe` inspects a live process.
Findings are attributed to the server's entry script when it can be identified
inside the working directory (`node ./server.js` attributes to `server.js`, not
to the node binary). When no such file exists, for instance when the server is a
global binary or runs in a container, the log falls back to a synthetic
`mcp-probe://` URI and says so on stderr: it uploads and validates, but the
alerts will not anchor to a line of code. Use `--sarif-artifact <path>` to point
them at the right file yourself.

Exit codes are unchanged under `--sarif`.

## Roadmap

- Deeper JSON Schema validation (nested `$ref`, `oneOf` / `anyOf`, format checks).
- Optional transport backends (HTTP and SSE) alongside stdio, likely by adopting
  the official MCP SDK transports.
- A `--fixture` mode that generates valid sample arguments from a schema so tools
  with required parameters can be round-tripped safely.
- Resource read and prompt get smoke tests under `--call`.
- A GitHub Action wrapper for one-line CI integration.

## Development

```bash
node --test                                  # run the linter test suite
node bin/mcp-probe.js -- node examples/echo-server.js
```

## Citing mcp-probe

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21347997.svg)](https://doi.org/10.5281/zenodo.21347997)

If you use mcp-probe in academic or technical work, please cite it. Every release
is archived on Zenodo with a permanent DOI:

- **Cite this DOI** (always resolves to the latest version): [`10.5281/zenodo.21347997`](https://doi.org/10.5281/zenodo.21347997)
- **Version-specific DOIs** are listed on the [Zenodo record](https://doi.org/10.5281/zenodo.21347997). The v0.1.0 archive is [`10.5281/zenodo.21347998`](https://doi.org/10.5281/zenodo.21347998).

BibTeX:

```bibtex
@software{afsar_mcp_probe_2026,
  author  = {Afsar, Haseeb Mohammed},
  title   = {mcp-probe: a conformance and safety-annotation probe for Model Context Protocol servers},
  year    = {2026},
  publisher = {Zenodo},
  doi     = {10.5281/zenodo.21347997},
  url     = {https://doi.org/10.5281/zenodo.21347997}
}
```

Machine-readable metadata lives in [`CITATION.cff`](./CITATION.cff) (GitHub renders
a "Cite this repository" button from it). A tool paper is drafted under
[`paper/`](./paper/paper.md), and a reproducible conformance-study protocol lives in
[`benchmark/STUDY.md`](./benchmark/STUDY.md).

### Ecosystem census

`benchmark/harvest.mjs` sweeps the entire official MCP registry and measures the
published population without executing any server code. The latest snapshot
([`benchmark/results/CENSUS.md`](./benchmark/results/CENSUS.md)) covers **16,548
unique servers**: ~50% ship as installable packages and ~43% are hosted remotes;
npm (36%) and PyPI (16%) dominate the package ecosystems; and while most servers
track the current schema revision, a measurable tail still pins older ones. The
npm/stdio, credential-free subset it emits is the sampling frame for the behavioral
conformance probe. Regenerate with `node benchmark/harvest.mjs`.

## License

MIT, Haseeb Mohammed Afsar. See [LICENSE](./LICENSE).
