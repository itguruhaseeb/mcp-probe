# Licensing of the study artifacts

This directory holds two different kinds of thing under two different licences.
The split is stated file by file so there is nothing to infer.

## Data and documentation: CC BY 4.0

Creative Commons Attribution 4.0 International.
Deed: <https://creativecommons.org/licenses/by/4.0/>
Legal code: <https://creativecommons.org/licenses/by/4.0/legalcode>

| file | what it is |
|---|---|
| `README.md` | this directory's documentation |
| `LICENSE-DATA.md` | this file |
| `census/census-2026-08-22.json` | registry-wide census aggregates, 2026-08-22 sweep |
| `census/CENSUS-SERIES.md` | the two-point longitudinal series and its provenance notes |
| `sample/study-2026-08-22.tsv` | the per-server outcome of all 400 draws |
| `sample/summary-2026-08-22.json` | the aggregates computed from that TSV, plus the draw manifest fields |
| `redundancy/redundancy-2026-08-22.json` | near-duplicate rates across the three corpora |
| `redundancy/provenance.json` | SHA-256 of every source file the corpus extractor read |
| `redundancy/THREAT-TESTS.md` | the within-unit and cross-unit split, and what it rules out |

Use them for anything, including commercially, provided you credit the source.
Citation details are in `CITATION.cff` at the repository root.

## Code: MIT

The scripts stay under the repository's MIT licence, which is in `LICENSE` at the
root. That is every `.py` and `.mjs` file here:

`redundancy/bounds.py`, `redundancy/extract-corpora.py`,
`redundancy/measure-redundancy.py`, `redundancy/threat-tests.py`,
`sample/aggregate-sample.mjs`, `sample/draw-sample.mjs`,
`sample/probe-sample.mjs`.

## Data elsewhere in this repository

The same split applies outside this directory, and naming only these sixteen files
would leave the rest implicitly MIT, which for a census aggregate is the same
category error this file exists to avoid. So, explicitly, **CC BY 4.0**:

| file | what it is |
|---|---|
| `benchmark/results/census.json` | the 2026-07-14 census aggregates |
| `benchmark/results/CENSUS.md` | its human-readable rendering |
| `benchmark/results/summary.json` | the 24-server curated-frame run, the comparison the paper contrasts the random draw against |
| `benchmark/results/summary.csv` | the same, one row per server |
| `benchmark/results/records.json`, `benchmark/results/manifest.json`, `benchmark/results/raw/*.json` | the per-server outputs behind it |
| `benchmark/results/FINDINGS.md` | what that run found |
| `benchmark/candidates-registry.json` | the 2026-07-14 candidate frame |
| `benchmark/servers.json`, `benchmark/servers-v2.json` | the hand-curated 24-server frame itself |
| `benchmark/summary-merged.json` | the merged view of the curated runs |

`benchmark/candidates-registry.json` is the one file here that is not our
measurement: it is a filtered copy of 5,671 records of MCP registry metadata,
which the registry publishes. The CC BY 4.0 grant above covers the selection and
arrangement, which is ours. It does not and cannot relicense the registry's own
content, and nothing here claims otherwise.

Everything else in the repository is MIT under the root `LICENSE`: every `.js`,
`.mjs` and `.py` file wherever it sits, and also the project's own furniture,
`package.json`, `CHANGELOG.md`, `.zenodo.json`, `.gitignore`, the workflow files,
`benchmark/STUDY.md`, and the paper sources under `paper/`. That is a residual
clause on purpose, so that a file added tomorrow has a licence today. Anything
that is measurement output rather than project furniture belongs in the CC BY 4.0
tables above, and adding it there is part of adding the file.

## What is not covered

The BFCL and UltraTool corpora are third-party releases and carry their own
licences. Nothing here relicenses them. `redundancy/extract-corpora.py` records
where each was fetched from, and `redundancy/provenance.json` records a SHA-256
for every file read, so what was measured is identifiable without redistributing
anyone else's data.

The MCP registry metadata the census counts is published by the registry itself.
The census files in this directory are aggregate counts computed from it, not a
copy of it. `benchmark/candidates-registry.json` is the exception and is described
as one above.
