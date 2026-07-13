# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
