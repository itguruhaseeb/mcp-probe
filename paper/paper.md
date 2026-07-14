---
title: 'mcp-probe: a conformance and reliability checker for Model Context Protocol servers'
tags:
  - Model Context Protocol
  - MCP
  - large language models
  - agent tooling
  - conformance testing
  - reliability
  - JSON Schema
authors:
  - name: Haseeb Mohammed Afsar
    orcid: 0009-0000-4038-1272
    affiliation: 1
affiliations:
  - name: Independent researcher
    index: 1
date: 13 July 2026
bibliography: paper.bib
---

# Summary

The Model Context Protocol (MCP) is an open standard that lets large language
model (LLM) applications discover and call external tools, resources, and prompts
through a uniform JSON-RPC 2.0 interface [@mcp2024]. As MCP adoption has grown,
the number of independently authored servers has grown with it, and so has the
variance in their quality: tool `inputSchema` definitions drift out of spec,
handshakes fail on edge cases, and malformed responses surface only when an LLM
constructs an invalid tool call at run time. There is currently no lightweight,
standard way to answer a basic question about a given server: does it conform to
the specification, and does it behave reliably?

`mcp-probe` is a dependency-light command-line tool that answers that question. It
launches any MCP server as a child process, speaks the MCP wire protocol directly
(newline-delimited JSON-RPC 2.0 over stdio), performs the `initialize` handshake,
enumerates the server's advertised tools via `tools/list`, validates each tool's
JSON Schema [@jsonschema] against the constraints the MCP specification places on
tool definitions, measures response latency, and optionally exercises safe
round-trips. It emits a human-readable report or machine-readable JSON. Because it
depends only on the language runtime rather than the full MCP SDK, its behavior is
transparent and its results are reproducible.

# Statement of need

Tooling for the MCP ecosystem remains immature relative to its adoption. Server
authors have no cheap, uniform way to smoke-test conformance before publishing,
and consumers integrating third-party servers have no uniform way to audit them.
Existing options are either the full SDK (heavy, and it masks rather than reports
protocol deviations) or ad-hoc manual testing. `mcp-probe` fills this gap with a
single command (`npx mcp-probe -- node ./server.js`) that requires no installation
and produces a straight verdict on initialization, schema validity, and latency.

Beyond day-to-day developer use, `mcp-probe` is designed to serve as a
*reproducible conformance benchmark* for empirical research on the reliability of
agent tooling. Its deterministic, machine-readable output makes it suitable for
running the same battery of checks across a large sample of public servers and
producing a citable dataset of conformance and reliability findings. This supports
research on tool-use reliability in LLM agents, an area of active concern as
agentic systems move into production [@toolreliability]. The accompanying study
protocol (`benchmark/STUDY.md`) documents a sample frame and metrics so that
measurements are repeatable across releases of the protocol and the ecosystem.

# Functionality

- **Handshake and capability negotiation.** Performs `initialize` and validates the
  server's declared protocol version and capabilities.
- **Tool schema linting.** For every tool returned by `tools/list`, validates the
  `inputSchema` as well-formed JSON Schema and flags deviations from MCP's
  requirements (for example, a missing or non-object schema, or unsupported
  constructs).
- **Latency measurement.** Records round-trip time for protocol operations so that
  slow or unstable servers are visible.
- **Safe round-trips.** With `--call`, exercises read-only or explicitly safe tool
  invocations to confirm the server responds to a well-formed request.
- **Reproducible output.** `--json` emits structured results suitable for
  aggregation across many servers.

# Preliminary findings

To demonstrate `mcp-probe` as a measurement instrument, we ran it as a baseline
study (`benchmark/run-study.mjs`) over a reproducible sample of 24 candidate public
servers: the official Model Context Protocol reference servers plus a set of
popular community servers, each launched over stdio via `npx` with no credentials
supplied. Sixteen servers initialized without credentials and were included (200
tools total); eight were excluded and recorded with a reason (four require
credentials, four fail the handshake without a required argument such as a
connection string or target URL). Full protocol, metrics, and threats-to-validity
are documented in `benchmark/STUDY.md`; raw per-server records are archived
alongside the dataset.

Three findings stand out. First, **hard conformance is high**: all 200 measured
tools carry valid JSON Schema `inputSchema` definitions with zero fatal violations,
which does not support the intuition that MCP tool schemas are frequently
malformed. Second, **the variance is in optional safety metadata**: 83 of 200 tools
(41.5%) omit the tool `annotations` (for example `readOnlyHint` and
`destructiveHint`) introduced in a later spec revision, and the omission is
strictly server-level rather than random — the split is all-or-nothing, with eight
servers annotating every tool and eight annotating none, and not a single server in
between. Because annotations are how a client learns whether a tool is read-only or
destructive *before* invoking it, this is a measurable gap between the
specification's safety affordances and ecosystem adoption. Third, **protocol
versions have already fragmented**: two negotiated versions appear across the
sample, and 4 of the 16 servers (including an official reference server) still
negotiate the older revision.

These numbers come from a still-modest sample ($n=16$ servers) whose primary purpose
is to establish a reproducible, re-runnable pipeline; the absolute percentages are
expected to shift as the sample frame grows further, but the method and the
categories of deviation it surfaces are the reusable contribution. Notably, the two
headline patterns held as the sample nearly doubled from an initial nine-server
pilot: schema validity stayed at 100% and the annotation gap remained a clean
server-level split, which strengthens confidence that these are structural
properties of the ecosystem rather than artifacts of a small sample. Re-running
`mcp-probe` at each spec release yields a longitudinal series of the same
measurements.

# Acknowledgements

We thank the maintainers of the Model Context Protocol specification and its
reference server implementations, against which `mcp-probe` is tested.

# References
