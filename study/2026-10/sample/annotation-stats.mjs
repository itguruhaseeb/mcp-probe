#!/usr/bin/env node
// annotation-stats.mjs: tool-level and server-level annotation coverage from a
// captured catalog (capture-catalog.mjs output), under BOTH definitions:
//
//   title        the tool carries a `title` (top-level or annotations.title).
//                This is what the pre-2026-10-01 harness measured and reported
//                as "annotations".
//   safetyHints  the tool carries at least one of readOnlyHint, destructiveHint,
//                idempotentHint, openWorldHint. This is what the August 2026
//                write-ups described.
//
// Also reports the readOnlyHint split, which the truthfulness study consumes.
//
// Usage:
//   node annotation-stats.mjs --catalog catalog/ --out annotations-2026-10-01.json
//   node annotation-stats.mjs --catalog ../august-recount/catalog/ \
//        --tsv ../../2026-08/sample/study-2026-08-22.tsv --out ../august-recount/recount-2026-10-01.json
//
// With --tsv, only servers whose second-pass tool count equals the first-pass
// count in the TSV are counted (the "recountable" set), and the script checks
// the TSV's `miss` column against both definitions server by server, which is
// the test that settles what the first pass measured.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }
const dir = arg('catalog');
const tsvPath = arg('tsv');
const outPath = arg('out', 'annotations.json');
if (!dir) { console.error('usage: node annotation-stats.mjs --catalog <dir> [--tsv <outcomes.tsv>] --out <file>'); process.exit(2); }

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
const hasTitle = (t) => t.title != null || (t.annotations && t.annotations.title != null);
const hasHint = (t) => !!t.annotations && HINTS.some((h) => t.annotations[h] !== undefined);
const round = (x) => Math.round(x * 10) / 10;

function binomCdf(k, n, p) {
  let term = Math.pow(1 - p, n), sum = term;
  for (let i = 1; i <= k; i += 1) { term *= ((n - i + 1) / i) * (p / (1 - p)); sum += term; }
  return sum;
}
function upperBound95(k, n) {
  if (!n) return null;
  if (k >= n) return 100;
  let lo = k / n, hi = 1;
  for (let i = 0; i < 60; i += 1) { const mid = (lo + hi) / 2; if (binomCdf(k, n, mid) > 0.05) lo = mid; else hi = mid; }
  return round(100 * hi);
}

let tsvMiss = null;
if (tsvPath) {
  const lines = readFileSync(tsvPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const hdr = lines[0].split('\t');
  tsvMiss = new Map(lines.slice(1).map((l) => { const c = Object.fromEntries(hdr.map((h, i) => [h, l.split('\t')[i]])); return [c.pkg, c]; }));
}

const catalogs = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

const counted = [];
const dropped = { secondPassFailed: [], toolCountChanged: [] };
for (const c of catalogs) {
  if (!c.secondPassOk) { dropped.secondPassFailed.push({ package: c.package, version: c.version }); continue; }
  if (tsvMiss && c.tools.length !== c.firstPassToolCount) {
    dropped.toolCountChanged.push({ package: c.package, version: c.version, firstPass: c.firstPassToolCount, secondPass: c.tools.length });
    continue;
  }
  counted.push(c);
}

function coverage(pred) {
  const srv = { all: 0, none: 0, partial: 0 };
  let tools = 0, missing = 0;
  const partialServers = [];
  for (const c of counted) {
    if (!c.tools.length) continue;
    const miss = c.tools.filter((t) => !pred(t)).length;
    tools += c.tools.length; missing += miss;
    const state = miss === 0 ? 'all' : miss === c.tools.length ? 'none' : 'partial';
    srv[state] += 1;
    if (state === 'partial') partialServers.push({ package: c.package, version: c.version, missing: miss, total: c.tools.length });
  }
  const n = srv.all + srv.none + srv.partial;
  return {
    serversWithTools: n, ...srv,
    bimodalPct: n ? round(100 * (srv.all + srv.none) / n) : null,
    partialPrevalenceUpper95Pct: upperBound95(srv.partial, n),
    partialServers,
    tools, toolsMissing: missing, toolsMissingPct: tools ? round(100 * missing / tools) : null,
  };
}

const title = coverage(hasTitle);
const safetyHints = coverage(hasHint);

// Cross-tabulation at the server level: what the title metric called a server
// versus what the safety-hint metric calls it.
const cross = {};
for (const c of counted) {
  if (!c.tools.length) continue;
  const st = (pred) => { const m = c.tools.filter((t) => !pred(t)).length; return m === 0 ? 'all' : m === c.tools.length ? 'none' : 'partial'; };
  const k = `title=${st(hasTitle)} hints=${st(hasHint)}`;
  cross[k] = (cross[k] || 0) + 1;
}

// readOnlyHint split, for the truthfulness study.
const ro = { true: 0, false: 0, undefined: 0, serversWithTrue: new Set() };
for (const c of counted) for (const t of c.tools) {
  const v = t.annotations ? t.annotations.readOnlyHint : undefined;
  if (v === true) { ro.true += 1; ro.serversWithTrue.add(c.package); } else if (v === false) ro.false += 1; else ro.undefined += 1;
}

const out = {
  catalog: dir,
  serversCaptured: catalogs.length,
  serversCounted: counted.length,
  dropped,
  definitions: {
    title: 'tool has `title` (top-level or annotations.title); rule tool/missing-title; what the pre-2026-10-01 harness reported as "annotations"',
    safetyHints: 'tool has at least one of readOnlyHint, destructiveHint, idempotentHint, openWorldHint; rule tool/no-safety-hints; what the write-ups described',
  },
  title,
  safetyHints,
  serverLevelCrossTab: cross,
  readOnlyHint: { true: ro.true, false: ro.false, undefined: ro.undefined, serversWithAnyTrue: ro.serversWithTrue.size },
};

if (tsvMiss) {
  let titleAgree = 0, hintAgree = 0, n = 0;
  const disagreements = [];
  for (const c of counted) {
    const row = tsvMiss.get(c.package);
    if (!row) continue;
    n += 1;
    const miss = Number(row.miss);
    const nt = c.tools.filter((t) => !hasTitle(t)).length;
    const nh = c.tools.filter((t) => !hasHint(t)).length;
    if (nt === miss) titleAgree += 1;
    if (nh === miss) hintAgree += 1;
    else disagreements.push({ package: c.package, firstPassMiss: miss, noTitle: nt, noSafetyHint: nh, tools: c.tools.length });
  }
  out.firstPassMetricTest = {
    serversCompared: n,
    firstPassMissEqualsNoTitle: titleAgree,
    firstPassMissEqualsNoSafetyHint: hintAgree,
    verdict: titleAgree === n && hintAgree < n
      ? 'the first-pass "annotations" column is title presence'
      : 'inconclusive, inspect disagreements',
    disagreementsWithSafetyHintDefinition: disagreements,
  };
}

writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.error(`[annotation-stats] ${counted.length}/${catalogs.length} servers counted; title missing ${title.toolsMissingPct}%, safety hints missing ${safetyHints.toolsMissingPct}% -> ${outPath}`);
