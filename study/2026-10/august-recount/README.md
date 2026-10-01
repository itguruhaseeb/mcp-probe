# August draw, re-probed at pinned versions on 2026-10-01

Why this exists: the August 2026 artifacts report an "annotation" figure that
turned out to measure tool **titles**, not the safety hints (`readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint`) the write-ups describe.
The August run kept only name and description per tool, so the real figure
could not be recomputed from the released files. This directory re-probes the
195 included August servers at the versions recorded in
`study/2026-08/sample/study-2026-08-22.tsv` (`npx -y <pkg>@<version>`) and
keeps the full tool objects, so both metrics can be computed on the same
tools and checked against the August table row by row.

## What the recount can and cannot say

184 of 195 pinned versions still installed and completed the handshake on
2026-10-01; 11 did not (`recount-2026-10-01.json` lists them). Of the 184,
166 advertised exactly the tool count recorded in August and 18 did not; a
server's tool list can depend on its environment and on what else is
installed, so those 18 are not the same observation and are excluded. The
numbers below are for the **166 recountable servers (165 with at least one
tool, 2,203 tools)**, 85% of the August included set. They are the best
available estimate of what the August draw would have shown under the
correct definition, not a re-measurement of the August draw itself.

## The test that settles what August measured

For each of the 166 servers, the August table's `miss` column was compared
with two counts over the re-captured tools:

| count | servers where it equals the August `miss` |
|---|---|
| tools without a title | **166 / 166** |
| tools without any safety hint | 136 / 166 |

The August column is title presence. The 30 servers where the two
definitions disagree are listed in the JSON; they include servers the August
table calls "annotates none" whose every tool carries `readOnlyHint` (for
example `@yawlabs/vew-mcp`, 16 of 16, and `@tideorg/mcp`, 20 of 20) and
servers it calls "annotates all" that carry no safety hint on any tool
(`bookmarks-mcp`, `wiring-diagram-mcp`, `uicockpit-mcp`).

## Corrected figures (166 recountable August servers)

| | as published (title) | corrected (safety hints) |
|---|---|---|
| tools lacking the property | 1,311 / 2,203 (59.5%) | 1,279 / 2,203 (58.1%) |
| servers annotating every tool | 64 | 51 |
| servers annotating no tool | 101 | 112 |
| servers partial | 0 | 2 |
| bimodal share | 100% | 98.8% |
| one-sided 95% upper bound on partial prevalence | 1.8% | 3.8% |

The published tool-level rate (58.8% on all 2,766 tools) happens to sit close
to the corrected rate on the recountable subset (58.1%), because most servers
that omit titles also omit hints and vice versa (135 of 165 land on the
diagonal of the cross-tabulation). The server-level claims do not survive:
"194 of 194 servers are all-or-nothing, no partial server observed" was a
statement about titles, and under the real definition partial servers exist
in this draw (2 of 165) and in the October draw (5 of 196). The 17.3-point
curated-versus-random gap (41.5% vs 58.8%) is also a title gap: the
curated-frame figure in `benchmark/results/summary.json` was produced with
mcp-probe 0.1.0, whose only "annotation" warning was the missing-title one
(the safety-hint rule arrived in 0.1.1), and its 83 flagged tools are all
`tool has no "title" annotation`. It has not been re-measured under the
safety-hint definition.

## Files

| file | what it is |
|---|---|
| `catalog/rowNNN-<pkg>.json` (deposit) | per-server second pass, pinned version: full tool objects, probe lint issues, first- and second-pass tool counts; 195 files, 4.1 MB, in the Zenodo data deposit, pinned through `../DEPOSIT-MANIFEST.md` |
| `recount-2026-10-01.json` | both metrics over the recountable set, the row-by-row test, the cross-tabulation, the dropped servers |
| `recount-chunk1.log` (deposit) | the run log, held for the deposit and pinned in `../DEPOSIT-MANIFEST.md` |

## Reproduce

```sh
cd study/2026-10/august-recount
node ../sample/capture-catalog.mjs --sample ../../2026-08/sample/study-2026-08-22.tsv --pin --probe-root ../../.. --out catalog/
node ../sample/annotation-stats.mjs --catalog catalog/ --tsv ../../2026-08/sample/study-2026-08-22.tsv --out recount.json
```

Pinned versions make the install reproducible as long as npm still serves
them; the 11 that failed on 2026-10-01 will not come back.
