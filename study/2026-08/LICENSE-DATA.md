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

## What is not covered

The BFCL and UltraTool corpora are third-party releases and carry their own
licences. Nothing here relicenses them. `redundancy/extract-corpora.py` records
where each was fetched from, and `redundancy/provenance.json` records a SHA-256
for every file read, so what was measured is identifiable without redistributing
anyone else's data.

The MCP registry metadata the census counts is published by the registry itself.
The census files here are aggregate counts computed from it, not a copy of it.
