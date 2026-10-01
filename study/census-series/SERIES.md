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

| | 2026-07-14 | 2026-08-22 | 2026-09-18 | 2026-09-29 |
|---|---|---|---|---|
| unique servers | 16,548 | 24,135 | 33,346 | **37,408** |
| active | 16,377 | 23,881 | 32,994 | 36,961 |
| deprecated | 171 | 254 | 352 | 447 |
| remote-only | 42.6% | 49.7% | 56.9% | 56.8% |
| package-only | 50.4% | 43.6% | 37.0% | 37.1% |
| npm/stdio launchable | 5,804 (35.1%) | 7,414 (30.7%) | 8,697 (26.1%) | 10,066 (26.9%) |
| of those, active: the drawable frame | 5,671 | 7,258 | 8,511 | 9,859 |
| registry pages swept | 512 | 790 | 1,080 | 1,254 |

Four anchor points shown. `series.tsv` in this directory is the full machine-readable
series and is the file to count from; this table is a reading aid and nothing should
be quoted from it that `series.tsv` does not support.

## CORRECTION, 2026-10-01: the acceleration claim was wrong

The 18 September version of this file said the composition shift was accelerating:
remote-only moving +0.18 pp/day and then +0.27 pp/day, with the note that anyone
reading the percentage-point column as a constant rate would extrapolate wrong.

Eleven more days of data say the warning was right and the claim it was attached
to was not. From 18 to 29 September:

| | 18 Sep | 29 Sep | change |
|---|---|---|---|
| unique servers | 33,346 | 37,408 | +4,062, or 369/day |
| remote-only | 56.9% | 56.8% | **-0.1 pp** |
| npm/stdio share | 26.1% | 26.9% | **+0.8 pp** |

The population kept growing at the same pace, 341/day before and 369/day after.
The composition shift stopped. Remote-only moved -0.009 pp/day over the window and
dipped to 56.3% on 25 September before recovering. The locally probeable share,
which the earlier text said was tightening faster than the first two points
suggested, went the other way and **rose** 0.8 points.

Three points were enough to see a direction and not enough to see a rate. Writing
"accelerating" from two intervals was an over-read of exactly the kind this file
warns against, and it is corrected here rather than quietly edited away.

What survives: remote-only overtook package-only between July and August, and that
crossover held through September. That is a change between measured endpoints, and
it is all the series supports.

## The consequence for a stdio instrument, restated honestly

The locally probeable slice fell from 35.1% to 26.1% of the population between
July and 18 September, then recovered to 26.9% by 29 September. In absolute terms
it has grown throughout, 5,804 to 10,066.

So the earlier framing, that a stdio-only instrument covers less of this ecosystem
every month, is true of the July-to-September span and is not true of the most
recent eleven days. The limit on a stdio-only sampling frame is real and it is not
monotone. State it as a range between measured endpoints, never as a rate.

## Data quality: this series has holes

The daily sweep has been running since 19 September and has not landed every day.
Missing: 19, 20, 21, 22, 23, 24, 26 and 30 September. The 30 September run is the
instructive one: the scheduler recorded it as succeeded, it finished in 2m 27s,
which is shorter than the sweep's own minimum pacing of roughly 3m 8s at 1,254
pages, and no row was committed. A run that reports success and commits nothing is
the 2026-08-19 failure wearing a different hat.

Gaps are left as gaps. A missing day cannot be backfilled, because the registry
state that day is gone. Anything computed from this series must use the dates that
are present rather than assuming a daily grid.

## What is kept with each point, and where

* **In git, here:** `census-YYYY-MM-DD.json`, the population aggregates. Small,
  diffable, and the thing every figure above is counted from.
* **On Zenodo, with the versioned archive:** `candidates-YYYY-MM-DD.json`, the
  `npm`/`stdio` active frame at that snapshot, in full. The August study could not
  publish its frame because the file did not survive; keeping the frame means a
  draw against it stays reproducible by anyone. It is 1.8 MB per point and grows
  every month, which is a dataset deposit rather than a git object, so it goes to
  the archive under the concept DOI rather than into this directory.

The 2026-09-18 frame, 8,511 active `npm`/`stdio` candidates, was held for the
next deposit and **did not survive**: the sandbox holding it was reset before
the deposit was made, the same way the August frame was lost. Its hash was
never committed, so it cannot even be checked. The 2026-10-01 frame (9,956
candidates) is the first one pinned by hash in git at the moment of the draw
(`study/2026-10/DEPOSIT-MANIFEST.md`,
`77864abc4812476abfeb666e45fbefa1f8a6fe78d8caf1d97c36794e6cda813d`) and is
packaged for the deposit together with the same-hour declarations sweep. The
rule that follows from losing two frames: a frame is hashed into git the hour
it is harvested, and the deposit happens before the sandbox is trusted to keep
anything.

## Reproduce

```bash
node benchmark/harvest.mjs
# writes benchmark/results/census.json and benchmark/candidates-registry.json
# copy both into this directory under today's date, and commit them today
```

A re-run produces a **new** snapshot, not a copy of any column above.
