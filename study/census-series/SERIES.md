# MCP registry census: the running series

A living directory. Each entry is one complete sweep of the official MCP registry
by `benchmark/harvest.mjs`, committed the day it was taken. Unlike
`study/2026-08/`, which is the frozen artifact of a published paper, this one
grows.

It exists because of a specific failure. A sweep taken on 2026-08-19 was reported
and never committed, and the environment that produced it is gone. A registry
sweep cannot be re-derived after the fact: the registry moves every day, so an
uncommitted sweep is not a delayed result, it is a destroyed one.
`study/2026-08/census/CENSUS-SERIES.md` records that loss. This directory is the
fix, and the rule is one line: **sweep, commit the same hour, or do not count it.**

## The series

Every point below reports `sweepComplete: true`, so none is a truncated lower
bound.

| | 2026-07-14 | 2026-08-22 | 2026-09-18 |
|---|---|---|---|
| unique servers | 16,548 | 24,135 | **33,346** |
| active | 16,377 | 23,881 | 32,994 |
| deprecated | 171 | 254 | 352 |
| remote-only | 42.6% | 49.7% | **56.9%** |
| package-only | 50.4% | 43.6% | **37.0%** |
| both | 5.1% | 5.1% | 4.8% |
| npm/stdio launchable | 5,804 (35.1%) | 7,414 (30.7%) | **8,697 (26.1%)** |
| of those, active: the drawable frame | 5,671 | 7,258 | **8,511** |
| on the current schema revision | 88.3% | 89.3% | 91.2% |
| registry pages swept | 512 | 790 | 1,080 |
| GitHub `topic:mcp-server` repos | 20,629 | not reachable | 29,221 |

## What three points support, and what they do not

Between the first two the paper said a crossover had happened and claimed no
trend, because two points cannot separate a trend from a pair of readings. A third
point changes what can be said, but not by as much as it looks.

**Direction is now consistent across two independent intervals.** Remote-only rose
+7.1pp then +7.2pp; package-only fell -6.8pp then -6.6pp; the `npm`/`stdio` share
fell -4.4pp then -4.6pp. Three points in the same direction with near-identical
step sizes is a stronger statement than one crossover.

**The rate is not constant, and the equal step sizes hide that.** The two
intervals are 39 days and 27 days. Equal movement over a shorter window means the
composition is shifting *faster*, not steadily: remote-only moved 0.18 pp/day and
then 0.27 pp/day. Population growth accelerated in step, from 195 to 341 servers a
day. Anyone reading the pp column as a constant monthly rate will extrapolate
wrong.

**Three points still do not fit a model.** No curve is claimed here. What is
claimed is three measured endpoints, their direction, and the fact that the
per-day rate rose between them.

## The consequence that keeps getting worse

The locally probeable slice, `npm`-published `stdio` servers, has now fallen from
35.1% to 26.1% of the population in 66 days, while growing from 5,804 to 8,697 in
absolute terms. A stdio-only instrument covers a smaller share of this ecosystem
every month. That is a limit on any stdio-based sampling frame, this repository's
included, and it is tightening faster than the first two points suggested.

## What is kept with each point, and where

* **In git, here:** `census-YYYY-MM-DD.json`, the population aggregates. Small,
  diffable, and the thing every figure above is counted from.
* **On Zenodo, with the versioned archive:** `candidates-YYYY-MM-DD.json`, the
  `npm`/`stdio` active frame at that snapshot, in full. The August study could not
  publish its frame because the file did not survive; keeping the frame means a
  draw against it stays reproducible by anyone. It is 1.8 MB per point and grows
  every month, which is a dataset deposit rather than a git object, so it goes to
  the archive under the concept DOI rather than into this directory.

The 2026-09-18 frame, 8,511 active `npm`/`stdio` candidates, is held for the next
deposit. Until that deposit exists this line describes an intention, not a fact,
and it says so rather than the other way round.

## Reproduce

```bash
node benchmark/harvest.mjs
# writes benchmark/results/census.json and benchmark/candidates-registry.json
# copy both into this directory under today's date, and commit them today
```

A re-run produces a **new** snapshot, not a copy of any column above.
