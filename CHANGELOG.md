# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-08-22

### Fixed
- The version string is now read from `package.json` in one place
  (`src/version.js`) instead of being hardcoded separately in the CLI, the
  report, and the MCP `clientInfo`. Those three copies had drifted: 0.1.1
  reported itself as 0.1.0 in `--version` output, in the `version` field of
  every `--json` report, and to every server it handshook with.
- README example output refreshed. It showed a clean run with 0 warnings, from
  before the safety-hints check existed.

### Added
- Exit code contract documented in the README and asserted in `test/cli.test.js`,
  so it cannot drift silently between releases. Thanks to @poweichen00.

## [0.1.1] - 2026-08-17

Never published. The version was bumped in the repository but no release was
cut, so npm continued to serve 0.1.0. The changes below shipped in 0.1.2.

### Added
- Linter check for MCP safety hints: warn when a tool declares none of
  `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`,
  the metadata a client needs to reason about side effects before calling.
- Raw probe output now records each tool's `annotations` object (or `null`),
  so downstream studies can measure annotation adoption directly.

## [0.1.0] - 2026-07-12

Initial release.

### Added

- stdio MCP client that speaks newline-delimited JSON-RPC 2.0 directly, with no
  runtime dependency on the official MCP SDK.
- `initialize` handshake with `notifications/initialized`, reporting the
  server name, version, negotiated protocol version, and declared capabilities.
- `tools/list` with per-tool JSON Schema linting: type validity, well-formed
  properties, required entries that must exist in properties, and warnings for
  missing description, title, or an empty schema.
- Latency reporting for the handshake and each list call.
- Optional `--call` flag for safe round-trips against tools that declare no
  required parameters. No arguments are ever fabricated.
- `resources/list` and `prompts/list` probing when the server declares those
  capabilities, with counts.
- Colorized human report and `--json` machine output. Non-zero exit on any hard
  failure (bad handshake or invalid tool schema).
- `--timeout` flag for per-request timeouts.
- Example stdio MCP server (`examples/echo-server.js`) and a unit test suite for
  the linter.
