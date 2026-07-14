# MCP ecosystem census — registry snapshot

Population-level measurement of the public Model Context Protocol server
ecosystem, harvested from the **official MCP registry** by `benchmark/harvest.mjs`.
This is the *census tier* of the study: it measures only metadata the registry
publishes, so it runs no server code and scales to the whole population. It is the
denominator the dynamic conformance probe (`run-study.mjs`) samples from.

- **Source:** https://registry.modelcontextprotocol.io/v0/servers
- **Snapshot:** 2026-07-14T03:22:19.367Z
- **Registry pages swept:** 512 (51151 version-rows)
- **Unique servers (latest version each):** **16548**
- **Active servers:** 16377
- **Context — GitHub `topic:mcp-server` repos:** 20629 (universe size; not the measured frame)

## Deployment model — how servers ship

| model | count | share |
|---|---|---|
| remote-only (hosted HTTP/SSE) | 7057 | 42.6% |
| package-only (installed locally) | 8340 | 50.4% |
| both | 852 | 5.1% |
| neither declared | 299 | 1.8% |

**Why it matters:** the deployment split tells you how the ecosystem is actually
consumed. A large remote-only share means most servers are hosted endpoints (agent
integrations, auth, network reliability) rather than local stdio tools.

## Package ecosystems (of servers that ship a package)

| registry | count | share of all |
|---|---|---|
| `npm` | 5880 | 35.5% |
| `pypi` | 2648 | 16% |
| `oci` | 562 | 3.4% |
| `mcpb` | 349 | 2.1% |
| `nuget` | 83 | 0.5% |
| `cargo` | 1 | 0% |

## Transport declarations

Package transports:

| transport | count | share |
|---|---|---|
| `stdio` | 9057 | 54.7% |
| `streamable-http` | 380 | 2.3% |
| `sse` | 24 | 0.1% |

Remote transports:

| transport | count | share |
|---|---|---|
| `streamable-http` | 7478 | 45.2% |
| `sse` | 682 | 4.1% |

## Schema-version drift

Registry entries pin a `$schema` revision; the spread is a clean, code-free drift
signal across the population.

| schema revision | count | share |
|---|---|---|
| `2025-12-11` | 14603 | 88.2% |
| `2025-09-29` | 979 | 5.9% |
| `2025-10-17` | 556 | 3.4% |
| `2025-07-09` | 271 | 1.6% |
| `2025-09-16` | 137 | 0.8% |
| `unknown` | 2 | 0% |

## Sampling frame for the dynamic tier

**5804** servers (35.1% of the population) are
npm-published stdio servers — i.e. launchable by `npx` for the dynamic conformance
probe. `candidates-registry.json` holds these 5671 candidates; the probe
decides inclusion empirically (credential needs verified at run time, per STUDY.md).

## Honest limitations

- The registry is one (authoritative) view of the ecosystem; servers never
  published to it are out of frame. The GitHub topic count above is reported as
  context for how much larger the informal universe is.
- Census metrics are self-declared registry metadata; the dynamic tier is what
  validates behavior (schema validity, annotations, latency).
- A snapshot moves over time; every number here is tagged to the snapshot date and
  the sweep is re-runnable to produce a longitudinal series.

## Reproduce

```bash
node benchmark/harvest.mjs      # writes corpus.json, results/census.json, this file
```
