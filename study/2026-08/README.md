# August 2026 study artifacts

Everything the paper in `paper/arxiv/` counts from, plus the scripts that produced
it. The point of this directory is that no number in the paper has to be taken on
trust: each one is a count over a file here, made by a script here.

```
census/       registry-wide sweep, and the two-point longitudinal series
sample/       the seeded draw, the probe runner, the aggregator, and all 400 outcomes
redundancy/   the three-corpus near-duplicate measurement and its threat tests
```

## What produced what

| number in the paper | file here | script that made it |
|---|---|---|
| 24,135 servers, 49.7% remote-only, 43.6% package-only | `census/census-2026-08-22.json` | `benchmark/harvest.mjs` (repo root) |
| the 2026-07-14 to 2026-08-22 crossover | `census/CENSUS-SERIES.md` | same, two runs |
| 400 drawn, 195 included (48.8%) | `sample/summary-2026-08-22.json` | `sample/aggregate-sample.mjs` |
| the per-server outcome of every draw | `sample/study-2026-08-22.tsv` | `sample/probe-sample.mjs` |
| 2.8% / 16.7% / 0.3% redundancy at cosine 0.70 | `redundancy/redundancy-2026-08-22.json` | `redundancy/measure-redundancy.py` |
| the within-unit / cross-unit split | `redundancy/THREAT-TESTS.md` | `redundancy/threat-tests.py` |
| every upper bound stated for an observed zero | printed by the script | `redundancy/bounds.py` |

## Reproducing

The sample is reproducible only against the same frame, because the registry grows
by roughly 195 servers a day. `draw-sample.mjs` records the SHA-256 of the frame
bytes it drew from, and `sample/summary-2026-08-22.json` carries that hash,
`78b5a0a79ddbc576dbf784f269b1e75a1806bb7d2c5fb95b9961a0966253e1f9`, over 7,258
candidates at snapshot `2026-08-22T02:06:22.994Z`. A run against a different frame
is a different sample, and the hash mismatch says so rather than silently
pretending otherwise.

**That frame is not in this repository and is not published anywhere.** The
`benchmark/candidates-registry.json` committed here is the earlier `2026-07-14`
frame of 5,671 candidates, kept for the static tier; a draw against it produces a
different sample and a hash that does not match. Step 1 below re-harvests a
*current* frame, which will not match either. So the August 2026 draw can be
checked but not re-executed: what is verifiable is the recorded hash, count and
snapshot time, and what is independently recountable is the outcome of all 400
draws in `sample/study-2026-08-22.tsv`. That is a real limit on this artifact and
is stated here rather than left to be discovered.

```bash
# 1. sweep the registry (writes benchmark/candidates-registry.json)
NODE_USE_ENV_PROXY=1 node benchmark/harvest.mjs

# 2. draw
node study/2026-08/sample/draw-sample.mjs \
     --frame benchmark/candidates-registry.json --seed 20260819 --n 400 --out sample.json

# 3. probe. Resumable: re-run the same command until it exits 0.
node study/2026-08/sample/probe-sample.mjs \
     --sample sample.json --probe-root . --out results/

# 4. aggregate
node study/2026-08/sample/aggregate-sample.mjs --in results/ --sample sample.json

# 5. redundancy, and check the method against a hand-worked corpus first
python3 study/2026-08/redundancy/measure-redundancy.py --self-test
python3 study/2026-08/redundancy/measure-redundancy.py \
     --corpus mcp=mcp.json --corpus bfcl=bfcl.json --corpus ultratool=ultratool.json
```

`redundancy/extract-corpora.py` builds the three corpus files and records a sha256
for every source file it reads; those hashes are in `redundancy/provenance.json`.

## What is deliberately not here

* **The raw registry dump and the August candidate frame.** `benchmark/harvest.mjs`
  writes a full-population `corpus.json` and, derived from it, the npm/stdio
  `candidates-registry.json`. Neither the August run's `corpus.json` nor its
  7,258-candidate frame survived the sandbox that produced them, so neither is in
  git and neither is in the Zenodo archive. Re-running the harvester yields a
  current snapshot, not that one. See the note under "Reproducing" above.
* **The per-server probe record files.** Their contents are summarised row by row
  in `sample/study-2026-08-22.tsv`, which is the artifact the paper releases.
* **The BFCL and UltraTool source files.** Third-party releases. Fetch them from
  the URLs in `redundancy/extract-corpora.py` and check them against the sha256
  values in `redundancy/provenance.json`.
* **The lane's internal working notes.** A few script comments and `bounds.py`
  cite paths of the form `research/redundancy/...` or `lanes/research.md`. Those
  are the working repository's layout; `research/redundancy/` and
  `research/census/` map onto `study/2026-08/redundancy/` and
  `study/2026-08/census/` here, and `lanes/research.md` is not published.

## A note on the numbers that are not here

`census/CENSUS-SERIES.md` carries a provenance correction rather than a tidy
series. A census run on 2026-08-19 was reported and never committed, and the
sandbox that produced it is gone. A registry sweep cannot be re-derived after the
fact, so those figures are not results and are cited nowhere. The same applies to
a 400-server behavioral run from the same day. Both are named in that file so the
gap is visible instead of silently closed.
