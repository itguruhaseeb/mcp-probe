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

# State of the field

Three kinds of tooling exist around MCP today, and none answers the conformance
question directly.

The official MCP Inspector is an interactive graphical client for exploring a
running server by hand. It is built for debugging during development, which makes
it well suited to diagnosis and unsuited to measurement, because its output is a
screen rather than a durable record.

The official MCP SDKs provide compliant client implementations. Because their
purpose is to make integration work, they absorb deviations rather than report
them: a server returning a subtly malformed tool definition is often handled
gracefully, which is correct behavior for an integration library and precisely the
wrong behavior for an audit. An SDK-based check also cannot distinguish a server
that is conformant from one whose non-conformance the SDK happens to tolerate.

Ad-hoc per-project scripts are the third and most common category. They are
unpublished, unversioned, and not comparable across authors, so a finding from one
team cannot be replicated by another.

The gap is a non-interactive, dependency-light checker whose output is a durable
machine-readable record. This mirrors a familiar pattern in other protocol
ecosystems, where independent conformance suites developed alongside reference
implementations precisely because a reference implementation, by design, tolerates
what a conformance suite must flag. `mcp-probe` occupies that position for MCP.
Work on agent tool-use reliability such as [@toolreliability] measures whether an
agent succeeds at a task, one layer above the question here; `mcp-probe` measures
whether the tool surface an agent is handed is well-formed in the first place.

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

# Software design

`mcp-probe` is a Node.js command-line program with no runtime dependencies beyond
the language runtime. That constraint is a design decision rather than an
aesthetic: a conformance checker that pulls in the SDK it is meant to audit
inherits that SDK's tolerances, and a checker with a large dependency tree cannot
credibly claim its results are reproducible years later.

The program is organized into four modules under `src/`, each with a single
responsibility. `client.js` implements the MCP wire protocol directly: it spawns
the server under test as a child process, writes newline-delimited JSON-RPC 2.0
requests to its standard input, reads framed responses from its standard output,
performs the `initialize` handshake, records the negotiated protocol version, and
issues `tools/list`. Keeping the transport hand-written is what allows the tool to
observe deviations an SDK would silently accommodate. `linter.js` holds the
conformance rules, expressed independently of the transport so the rule set can
track the specification without touching protocol code. `report.js` renders results
either as a human-readable summary or, under `--json`, as a structured record; the
structured form is the one intended for research use, is stable across releases,
and is what the benchmark pipeline aggregates. `color.js` isolates terminal
formatting so machine-readable output is never contaminated by escape sequences.

Around these sit `bin/` for the command-line entry point, `test/` for the unit
suite, `examples/` for runnable sample servers, and `benchmark/` for the study
harness, sample frame, and archived measurement records.

The separation between protocol, rules, and reporting is what makes the tool usable
as an instrument. A study can pin a released version, re-run an identical rule set
against a documented sample frame, and compare across time, because the thing that
changed between two runs is the ecosystem rather than the measurement.

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
strictly server-level rather than random: the split is all-or-nothing, with eight
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

# Research impact statement

`mcp-probe` is offered as a research instrument rather than as a library with an
established user base, and its contribution should be judged on that basis.

That contribution is a reproducible measurement pipeline for an ecosystem that
currently has none. Claims about MCP server quality circulate widely and are
largely anecdotal, because there has been no shared, versioned way to measure them.
`mcp-probe` turns those claims into checkable ones: a documented sample frame, a
fixed rule set, deterministic machine-readable output, and archived raw records
that a third party can re-run without contacting the author.

The baseline study above already produced findings a reader can act on and, more
importantly, can contest. That hard schema conformance is universal in the sample
contradicts a common assumption. That safety annotations are omitted in a strictly
server-level, all-or-nothing pattern is the kind of structural observation that is
invisible without systematic measurement and that bears directly on client design,
since annotations are how a client learns whether a tool is destructive before
calling it.

Because the instrument is versioned and the sample frame documented, re-running it
at each specification release yields a longitudinal series rather than a one-time
snapshot. That is the durable output: not the current percentages, which will move,
but the ability to say how and when they moved, and for anyone else to check. The
author notes plainly that independent adoption and use are what would demonstrate
impact rather than argue for it, and that this record is still being built.

# AI usage disclosure

Generative AI assistance was used substantially in this work. AI coding assistants
were used to draft and refactor the implementation and its test suite, to build and
run the benchmark harness, and to draft this manuscript. All reported measurements
were produced by executing the software against live servers rather than generated
by a model, and the archived raw records permit independent verification of every
figure reported here. The author reviewed the code and the manuscript, and takes
full responsibility for the correctness of the implementation, the study protocol,
and the findings.

# Acknowledgements

We thank the maintainers of the Model Context Protocol specification and its
reference server implementations, against which `mcp-probe` is tested.

# References
