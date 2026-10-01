#!/usr/bin/env node
// make-outcome-table.mjs: emit the per-server outcome table (TSV) for a probed
// draw, in draw order, from the sample manifest and the per-server result files.
//
// The August table was assembled by hand from the same inputs. This script makes
// the October table regenerable from the committed files, which is the whole
// point of the lane's rule that a result is real only if it regenerates.
//
// Usage:
//   node make-outcome-table.mjs --sample sample.json --in results/ --out study-2026-10-01.tsv
//
// Columns match study/2026-08/sample/study-2026-08-22.tsv exactly so that the
// comparison scripts read both without a special case:
//   pkg  ver  st  rsn  tools  ann  miss
//   st:  I=included X=excluded
//   rsn: hs=handshake-failed cred=needs-credentials na=package-unavailable
//        lf=launch-failed to=timeout
//   ann: A=every tool has a title  N=no tool has one  P=partial  -=no tools
//   miss: tools lacking a title
//
// `ann`/`miss` are TITLE coverage, the same quantity the August table's
// columns hold (see study/2026-10/august-recount/README.md); safety-hint
// coverage for this draw comes from the captured catalog via
// annotation-stats.mjs, not from this table.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }

const samplePath = arg('sample');
const inDir = arg('in');
const outPath = arg('out', 'study.tsv');
if (!samplePath || !inDir) {
  console.error('usage: node make-outcome-table.mjs --sample <manifest.json> --in <results dir> --out <file.tsv>');
  process.exit(2);
}

const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const RSN = { 'handshake-failed': 'hs', 'needs-credentials': 'cred', 'package-unavailable': 'na',
  'launch-failed': 'lf', timeout: 'to' };
const ANN = { all: 'A', none: 'N', partial: 'P', 'no-tools': '-' };

const probedDate = arg('date', new Date().toISOString().slice(0, 10));
const head = [
  `# MCP registry probability sample, behavioral tier, probed ${probedDate}`,
  `# seed=${sample.seed} n=${sample.n} frameCount=${sample.frameCount} frameSnapshot=${sample.frameSnapshotDate}`,
  `# frameSha256=${sample.frameSha256}`,
  `# draw:      node ../../2026-08/sample/draw-sample.mjs --frame <candidates-registry.json> --seed ${sample.seed} --n ${sample.n}`,
  '# probe:     node ../../2026-08/sample/probe-sample.mjs --sample sample.json --probe-root <mcp-probe> --out results/',
  '# aggregate: node ../../2026-08/sample/aggregate-sample.mjs --in results/ --sample sample.json',
  '# table:     node make-outcome-table.mjs --sample sample.json --in results/',
  '# st: I=included X=excluded | rsn: hs=handshake-failed cred=needs-credentials na=package-unavailable lf=launch-failed to=timeout',
  '# ann: A=every tool has a title  N=none has  P=partial  -=no tools | miss=tools lacking a TITLE (not safety hints; see august-recount/README.md)',
  '# Row order is the draw order, which is part of the sample.',
  'pkg\tver\tst\trsn\ttools\tann\tmiss',
];

const rows = [];
let missing = 0;
for (const s of sample.servers) {
  let r;
  try { r = JSON.parse(readFileSync(join(inDir, `${s.id}.json`), 'utf8')); } catch { missing += 1; continue; }
  const st = r.status === 'included' ? 'I' : 'X';
  const rsn = st === 'X' ? (RSN[r.excludeReason] || r.excludeReason) : '';
  const ann = ANN[r.annotations?.state] ?? '-';
  rows.push([s.package, s.version ?? '', st, rsn, r.toolCount ?? 0, ann, r.annotations?.missing ?? 0].join('\t'));
}
if (missing) {
  console.error(`[table] ${missing} sampled servers have no result file; refusing to write a partial table`);
  process.exit(1);
}
writeFileSync(outPath, `${head.join('\n')}\n${rows.join('\n')}\n`);
console.error(`[table] ${rows.length} rows -> ${outPath}`);
