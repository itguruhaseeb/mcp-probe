# Files held for the Zenodo data deposit

The per-server files of the October 2026 draw and the August recount are too
large to commit through the route this repository is maintained by, so they
go in the next Zenodo data deposit. This file pins them so the deposited
copies can be checked against this commit. Hashes are SHA-256.

| held file | what it is | sha256 |
|---|---|---|
| `sample/sample.json` | the full draw manifest written by `draw-sample.mjs` (ids and package/version per server; `sample/sample-ids.json` here is the ids array extracted from it) | `f44e1a7f61cf6df0125b1785fef901993a01e41dee2ccf877fd0a68366143589` |
| `sample/SHA256SUMS` | one line per file in `sample/results/` (400) and `sample/catalog/` (196) | `d01a84957119615e7c2dce992c9a76520250bffb7f30f06d9758ac46a2c47ec3` |
| `august-recount/SHA256SUMS` | one line per file in `august-recount/catalog/` (195) | `447b78052aae7ae2dd67f3bf438b880c93cda6dfafb051c6a87323299e9661bd` |
| `candidates-registry-2026-10-01.json` | the frame the draw was made from, 9,956 entries, snapshot `2026-10-01T12:26:07.857Z` | `77864abc4812476abfeb666e45fbefa1f8a6fe78d8caf1d97c36794e6cda813d` |
| `declarations-2026-10-01.json` | registry-declared environmentVariables for every npm/stdio package, 10,025 packages, snapshot `2026-10-01T12:26:09.858Z` | `8644f92e444a330f3015b4e3d799cfe01d0b20656479d2a390aeeb6481318ea0` |
| `october-run-logs.tar.gz` | the four probe chunk logs and the catalog-pass log of the October draw (`sample/logs/` keeps the two small files: the reaper log and the first-pass `0nmcp` result) | `040e8df7a0bd4be10e071907dc234fb9888cd0c71c0b03af7d996b9c2edc6b97` |
| `august-recount-chunk1.log` | the August recount run log | `db2e330bd0a473b3a76e1b4befb5f7fdbd9d6964a214c76c49cce12e59b98c36` |

To verify a deposit: check the `SHA256SUMS` files against this table, then run
`sha256sum -c SHA256SUMS` inside each directory.

The deposit has not been published yet; this file is updated with the record
DOI when it is. Until then the counts in `sample/summary-2026-10-01.json`,
`sample/study-2026-10-01.tsv`, `sample/annotations-2026-10-01.json` and
`august-recount/recount-2026-10-01.json` are the released numbers.
