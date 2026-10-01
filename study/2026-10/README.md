# Declared credentials against observed startup, 2026-10-01

Two results. One kills a planned study. One opens a better one. The October
draw itself, the August recount and the annotation correction are in
`sample/` and `august-recount/`; this file is about registry declarations.

## 1. The dead half of the registry is invisible to an agent

A study was scoped to ask whether the 51.2% unrepaired failure rate degrades what
an LLM agent can accomplish. It does not, and the reason is in the protocol rather
than in any experiment.

Every one of the 205 exclusions in the released 400-draw table failed **before**
the `initialize` handshake completed. `probe-sample.mjs` makes this explicit: both
the `needs-credentials` and `handshake-failed` branches of `classify()` sit inside
`if (!j.server)`, which is the no-handshake case. Checked against the data, **zero
excluded servers advertise a single tool.**

In MCP a host must complete `initialize` before it can call `tools/list`. A server
that fails there contributes no tools. The agent never sees it, never selects it,
never spends a turn on it. Simulating registry slices from the released outcomes:

| slice | live servers | tools the agent actually sees |
|---|---|---|
| 5 | 2.44 | 34 (median 23) |
| 10 | 4.88 | 69 (median 54) |
| 20 | 9.75 | 138 (median 117) |

An agent handed twenty unrepaired servers behaves like an agent handed ten working
ones. The failure rate is paid at install time by a person, not at inference time
by a model. **The study is cancelled on its premise, before anything was built.**

## 2. The registry says which servers need a credential. It does not help.

94% of npm package entries in the registry declare `environmentVariables`. The
obvious question is whether that metadata lets a consumer predict what will work.

Matching 398 of the 399 drawn packages back to their registry entries:

| probe outcome | n | declares a REQUIRED env var |
|---|---|---|
| started fine | 194 | 27.3% |
| failed to start | 150 | **26.0%** |
| died demanding a credential | 53 | 71.7% |

Broken servers and working servers declare required credentials at the same rate,
a difference of 1.3 percentage points (z = -0.27, p = 0.78). **Reading the registry
tells you nothing about whether a server will start.**

The credential-labelled group is excluded from that comparison on purpose. The
probe assigned that label by reading stderr for words like "api key", so its 71.7%
agreement with the registry is partly circular. It is reported here rather than
buried, because the magnitude is far beyond what circularity alone explains and it
is a genuine external validation of that label: 71.7% against a 27.3% base rate.

## 3. What this does to the paper

It survives a direct attack. The hypothesis under test was that the 150
"handshake-failed" servers were really credential-gated and misclassified, which
would have broken the headline split. They are not: they declare required
credentials at 26.0%, indistinguishable from the 27.3% of servers that started
fine. They are genuinely broken.

## Limitation of section 2, and the same-snapshot replication that closes it

The section 2 comparison matched August probe outcomes to registry declarations
read on 2026-10-01, forty days later. A declaration could have changed in
between. The replication below removes that gap: the October draw
(`sample/`) was made from a frame harvested at `2026-10-01T12:26:07Z`, the
declarations were swept two seconds later (`declarations-sweep.mjs`, held for
the deposit and pinned in `DEPOSIT-MANIFEST.md`), and the probe ran the same
day. All 400 drawn packages match.

| probe outcome, October draw | n | declares a REQUIRED env var |
|---|---|---|
| started fine | 196 | 27.0% |
| failed to start | 162 | **17.9%** |
| died demanding a credential | 41 | 80.5% |

(`declared-vs-observed-2026-10-01-same-snapshot.json`.) The direction is the
opposite of the one a "required credentials cause failures" story needs:
servers that never start declare a required variable *less* often than servers
that start (17.9% against 27.0%, z = -2.05, p = 0.04). That is one test at
nominal alpha on one draw and should not be read as an effect; pooled across
the two draws the gap is 21.8% against 27.2% (z = -1.64, p = 0.10). What both
draws support, now without the timing caveat, is the negative result: a
declared required environment variable does not predict that a server fails to
start. The 80.5% rate in the credential-labelled group is the external
validation of that label, and is circular for the same reason as in August.

## Reproduce

```bash
# August outcomes against a live sweep (the section 2 numbers; the registry has moved since)
node declared-vs-observed.mjs \
     --tsv ../2026-08/sample/study-2026-08-22.tsv \
     --out declared-vs-observed-$(date +%F).json

# October outcomes against the same-hour declarations (needs declarations-2026-10-01.json from the deposit)
node declared-vs-observed.mjs \
     --tsv sample/study-2026-10-01.tsv --probe-date 2026-10-01 \
     --declarations declarations-2026-10-01.json \
     --out declared-vs-observed-2026-10-01-same-snapshot.json
```

The live sweep reads the registry only, executes no server code, is about 1,300
pages at 150ms and takes a few minutes. Expect a different match count on a
later run, because the registry moves.
