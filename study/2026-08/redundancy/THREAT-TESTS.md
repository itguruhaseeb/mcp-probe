# Threat tests on the redundancy finding, 2026-08-22

Run before writing anything up. Reproduce with `threat-tests.py` in this
directory.

## The threat

Kim, Jiang, Hu, Jia and Gong (arXiv:2605.09817) measure **repository-level code
cloning** across 7,508 MCP repositories and 87,564 tools, and verify 60 to 85
percent of high-similarity candidates as true clones. We measure 2.8 percent
description redundancy among real MCP tools and call the ecosystem diverse.

The obvious alternative explanation is that **our probe discards clones**. We see
only servers that complete a handshake, which is 48.8 percent of a random draw.
If clones disproportionately fail to start, our number is flattering for the
wrong reason, and writing it up unqualified would be overclaim number four.

Each test below was written so that a result in the wrong direction kills the
finding.

## T1: are the servers the filter removed more duplicated?

A server that never starts advertises no tools, so its tool descriptions cannot
be obtained at all. The available proxy is the npm-authored package description,
which exists for both groups. 396 of 400 sampled packages have one.

| group | n | 0.70 | 0.80 | 0.85 | 0.90 |
|---|---|---|---|---|---|
| INCLUDED (server started) | 195 | 0.0% | 0.0% | 0.0% | 0.0% |
| EXCLUDED (never started) | 201 | 0.0% | 0.0% | 0.0% | 0.0% |

No difference. **But this test has low power and that must be said in any
write-up.** Both groups sit at zero, so the proxy cannot discriminate, and it
reads descriptions rather than code. A clone that rewrites its description is
invisible to it. T2 and T3 are the better-powered tests.

## T2: is author-family concentration higher in the excluded group?

A filter removing clone families would show it as scope concentration.

| group | n | distinct npm scopes | scopes shipping >1 package | packages in them |
|---|---|---|---|---|
| INCLUDED | 195 | 69 | 5 | 16 |
| EXCLUDED | 205 | 103 | 3 | 12 |

Comparable, and if anything the **included** group is slightly more
family-concentrated. The largest family in the sample, `@codespar` with 7
packages, was entirely included; the next, `@cyanheads` with 8, was entirely
excluded. Families land on both sides. Nothing here supports the bias hypothesis.

## T3: the adversarial case

If any author in this sample produces cross-server near-duplicate tools, it is
the one shipping the most servers that all started.

**`@codespar`: 7 servers, 125 tools, all included.**

| threshold | cross-server redundancy |
|---|---|
| 0.70 | 0.0% |
| 0.80 | 0.0% |
| 0.85 | 0.0% |
| 0.90 | 0.0% |

**Maximum cross-server cosine: 0.623**, below the lowest threshold tested. One
author shipping seven MCP servers still writes tool descriptions that do not
near-duplicate across those servers. This is the strongest single piece of
evidence that the 0.0 percent figure is real and not a filtering artifact.

## T4: within-unit versus cross-unit, and this is the real finding

How much of each corpus's redundancy is inside one authoring unit rather than
between independent ones? For MCP the unit is the server; for the benchmarks it
is the task row.

| corpus | unique | units | tools/unit | | 0.70 | 0.80 | 0.85 | 0.90 |
|---|---|---|---|---|---|---|---|---|
| Real MCP | 2,756 | 194 | 14.2 | all pairs | 2.8% | 1.1% | 0.5% | 0.0% |
| | | | | **cross-server** | **0.0%** | **0.0%** | **0.0%** | **0.0%** |
| BFCL v4 | 2,724 | 1,507 | 1.8 | all pairs | 16.7% | 9.7% | 6.2% | 2.7% |
| | | | | **cross-task** | **16.4%** | **9.6%** | **6.2%** | **2.7%** |
| UltraTool EN | 2,032 | 1,320 | 1.5 | all pairs | 0.3% | 0.0% | 0.0% | 0.0% |
| | | | | cross-task | 0.3% | 0.0% | 0.0% | 0.0% |

**The finding sharpened.** Every near-duplicate among real MCP tools is inside a
single server: `list_x` / `get_x` / `create_x` families within one project.
Cross-author near-duplication is zero at every threshold tested. BFCL's
redundancy is almost entirely the opposite kind: 16.4 of its 16.7 points sit
**between independently presented tasks**.

So the honest claim is not "BFCL is 6x more redundant". It is: **BFCL repeats
itself across tasks; real MCP does not repeat itself across authors.**

**CAVEAT, and it is a real one.** The units are not comparably sized. Removing
same-unit pairs subtracts almost nothing from a corpus averaging 1.8 tools per
unit, and a lot from one averaging 14.2. The cross-unit columns are therefore
not power-matched, and the BFCL cross-task figure is close to its all-pairs
figure partly by construction. The MCP collapse from 2.8 to 0.0 is not explained
by this, because it runs the other way.

## T5: is the rate driven by a few very large servers?

One server advertises 300 tools and another 122.

| per-server cap | n | 0.70 | 0.80 | 0.85 | 0.90 |
|---|---|---|---|---|---|
| 10 | 1,352 | 0.9% | 0.4% | 0.0% | 0.0% |
| 25 | 1,994 | 2.2% | 1.1% | 0.5% | 0.0% |
| 50 | 2,332 | 3.0% | 1.2% | 0.6% | 0.0% |
| uncapped (headline) | 2,756 | 2.8% | 1.1% | 0.5% | 0.0% |

The headline sits inside the range the caps produce. Not driven by the large
servers.

## Verdict

**The threat is not supported, and the finding is stronger than it was.** Three
independent checks fail to show the handshake filter selecting against clones,
and the adversarial case fails too.

**What stays open.** We measure descriptions; Kim et al. measure code. A clone
that copies implementation while rewriting its tool descriptions is invisible to
this method and would be counted by theirs. That is not ruled out and must be
stated as a limitation, not waved away. The two results are compatible: an
ecosystem can be heavily code-cloned while its **advertised interfaces** stay
lexically distinct, and if so, that gap is itself worth reporting.
