# MCP registry census: longitudinal series

Two **verified** snapshots. Both regenerate from `benchmark/harvest.mjs` in
`itguruhaseeb/mcp-probe` @ `39ed6e5`, run unmodified with `NODE_USE_ENV_PROXY=1`.

| snapshot | source of record |
|---|---|
| 2026-07-14 | `mcp-probe/benchmark/results/census.json`, committed |
| 2026-08-22 | `census-2026-08-22.json` in this directory, committed |

## PROVENANCE CORRECTION: the 2026-08-19 figures are unverified

A census run was reported on 2026-08-19 (22,659 servers, package-only 45.8
percent, remote-only 47.3 percent). **Its output was never committed and the
sandbox that produced it is gone.** A registry sweep is not regenerable after the
fact because the registry moves daily, so those numbers cannot be re-derived from
any committed artifact.

Under this lane's own rule they are not results. **Do not cite the 2026-08-19
figures in any paper, post, or summary.** They are consistent with the verified
series, which is reassuring, but consistency is not verification.

The same applies to the 400-server behavioral run of 2026-08-19 (215 included,
3,288 tools, 70/140/4 annotation split). No sample frame, seed manifest, or
result file was preserved. Those figures are unverified and the study needs
re-running against a preserved frame.

## The headline: the deployment model crossed over

In 39 days remote-only overtook package-only.

| deployment model | 2026-07-14 | 2026-08-22 | change |
|---|---|---|---|
| Package-only (installed locally) | 8,340 (50.4%) | 10,530 (43.6%) | -6.8pp |
| Remote-only (hosted HTTP/SSE) | 7,057 (42.6%) | 12,004 (49.7%) | +7.1pp |
| Both | 852 (5.1%) | 1,224 (5.1%) | -0.1pp |
| Neither declared | 299 (1.8%) | 377 (1.6%) | -0.2pp |

Remote-only grew +70.1 percent against +26.3 percent for package-only. This is a
genuine crossover between two verified endpoints, not an interpolation.

**Note for the paper.** The July draft asserted the population was "dominated by
hosted remote servers" when its own table showed package-only leading. That claim
was false when written. It is true now, and the honest version, a measured
crossover, is the stronger result. State it as a change over time with both
endpoints, never as a static property.

## Population

| metric | 2026-07-14 | 2026-08-22 | change |
|---|---|---|---|
| unique servers | 16,548 | 24,135 | +45.8% |
| active | 16,377 | 23,881 | +45.8% |
| deprecated | 171 | 254 | +48.5% |
| registry pages swept | 512 | 790 | +54.3% |
| version rows fetched | 51,151 | 78,901 | +54.3% |
| `sweepComplete` | true | true | neither run is a truncated lower bound |

Net growth is about 195 servers per day over the 39-day window.

## Package ecosystems

| ecosystem | 2026-07-14 | 2026-08-22 | change |
|---|---|---|---|
| npm | 5,880 | 7,501 | +27.6% |
| pypi | 2,648 | 3,332 | +25.8% |
| oci | 562 | 733 | +30.4% |
| mcpb | 349 | 516 | +47.9% |
| nuget | 83 | 101 | +21.7% |
| cargo | 1 | 31 | tiny base, report as a curiosity, not a trend |

## Transports

| transport | 2026-07-14 | 2026-08-22 | change |
|---|---|---|---|
| package / stdio | 9,057 | 11,563 | +27.7% |
| package / streamable-http | 380 | 444 | +16.8% |
| package / sse | 24 | 28 | +16.7% |
| remote / streamable-http | 7,478 | 12,499 | +67.1% |
| remote / sse | 682 | 1,016 | +49.0% |

## Schema-revision drift

| | 2026-07-14 | 2026-08-22 | change |
|---|---|---|---|
| current revision `2025-12-11` | 88.25% | 89.33% | +1.09pp |
| trailing tail (all older revisions) | 11.75% | 10.67% | -1.09pp |
| live revisions | 5 | 5 | unchanged |

**Careful with this one.** Two points cannot separate slow convergence from
noise. The correct statement is that the trailing tail did not grow while the
population grew 45.8 percent, so the lag is at worst reproducing itself and may
be shrinking slightly. Do not call it "stable" and do not call it "converging"
off two points.

## Dynamic-tier denominator

| | 2026-07-14 | 2026-08-22 | change |
|---|---|---|---|
| npm/stdio launchable | 5,804 | 7,414 | +27.7% |
| as a share of population | 35.1% | 30.7% | -4.4pp |
| of those, active: the drawn frame | 5,671 | 7,258 | +28.0% |

The last row is the one the behavioral tier actually draws from, and it is not
the row above it. `launchableNpmStdio` counts npm/stdio servers including the
deprecated ones; `candidates-registry.json` additionally filters on
`status: active`. The August sample was drawn against 7,258 candidates. Quoting
7,414 as the sampling frame is wrong by the 156 deprecated servers between them.

The locally-probeable slice grew in absolute terms but **shrank as a share**,
which follows directly from the shift to hosted remote servers. This is a real
methodological consequence worth stating: a stdio-only instrument covers less of
the ecosystem every month, and any stdio-only sample frame is a narrowing view.

## Reproduce

```bash
git clone https://github.com/itguruhaseeb/mcp-probe.git
cd mcp-probe
NODE_USE_ENV_PROXY=1 node benchmark/harvest.mjs
# writes benchmark/results/census.json (aggregates), benchmark/corpus.json,
# and benchmark/candidates-registry.json (the dynamic-tier sampling frame)
```

A re-run produces a NEW snapshot, not a copy of either point above. Commit the
aggregate `census.json` immediately or the point is lost, which is exactly how
the 2026-08-19 run was lost.
