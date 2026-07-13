# mcp-probe

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Lint and health-check any [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server, over stdio, in one command.

```
npx mcp-probe -- node ./my-server.js
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
npx mcp-probe -- node ./server.js
npx mcp-probe -- python server.py
npx mcp-probe --call -- node ./server.js
npx mcp-probe --json -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

Everything after `--` is treated as the server launch command. Requires Node 18
or newer.

## Example output

Run against the bundled example server:

```bash
node bin/mcp-probe.js -- node examples/echo-server.js
```

```
mcp-probe v0.1.0
target: node examples/echo-server.js

Handshake
  ✓ initialized in 41.5ms
  • server: echo-server v1.0.0
  • protocol: 2025-06-18
  • capabilities: tools

Tools (3)
  ✓ echo
  ✓ add
  ✓ ping
  tools/list in 0.1ms

Summary: healthy (3 tools, 0 errors, 0 warnings)
```

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
| `--timeout <ms>` | per-request timeout in milliseconds (default `10000`)              |
| `-h`, `--help`   | show help                                                          |
| `-v`, `--version`| show version                                                       |

The `--json` output is the same structured object the human report is rendered
from, suitable for CI. The process exits non-zero on any hard failure (handshake
failure or an invalid tool schema), so you can gate a build on it:

```bash
npx mcp-probe --json -- node ./server.js || echo "MCP server is unhealthy"
```

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

If you use mcp-probe in academic work, please cite it. Machine-readable metadata
lives in [`CITATION.cff`](./CITATION.cff) (GitHub renders a "Cite this repository"
button from it). A tool paper is drafted under [`paper/`](./paper/paper.md), and a
reproducible conformance-study protocol lives in
[`benchmark/STUDY.md`](./benchmark/STUDY.md). A versioned DOI is minted per release
via Zenodo; the DOI will be added here once the first release is archived.

## License

MIT, Haseeb Mohammed Afsar. See [LICENSE](./LICENSE).
