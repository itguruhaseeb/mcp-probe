#!/usr/bin/env node
// aggregate-sample.mjs — turn the per-server records written by probe-sample.mjs
// into the study's headline numbers. Every figure here is a count over the
// per-server records; nothing is asserted that the records do not show.
//
// Usage:
//   node aggregate-sample.mjs --in results/ --sample sample.json --out summary.json

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }
const DIR = arg('in');
const SAMPLE = arg('sample');
const OUT = arg('out', 'summary.json');
if (!DIR || !SAMPLE) {
  console.error('usage: node aggregate-sample.mjs --in <dir> --sample <manifest> --out <file>');
  process.exit(2);
}

function round(n) { return Math.round(n * 10) / 10; }

const manifest = JSON.parse(readFileSync(SAMPLE, 'utf8'));
const recs = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

const inc = recs.filter((r) => r.status === 'included');
const exc = recs.filter((r) => r.status === 'excluded');
const excBreak = {};
for (const r of exc) excBreak[r.excludeReason] = (excBreak[r.excludeReason] || 0) + 1;

const tools = inc.reduce((n, r) => n + r.toolCount, 0);
const described = inc.reduce((n, r) => n + r.toolsDescribed, 0);
const failing = inc.reduce((n, r) => n + r.toolsWithFails, 0);

// Servers with zero tools cannot express an annotation preference and are
// reported separately rather than folded into "none", which would inflate it.
const withTools = inc.filter((r) => r.toolCount > 0);

// CORRECTION 2026-10-01: the `annotations` field in result files measures
// TITLE presence (see the note in probe-sample.mjs), so RQ2_annotations below
// is title coverage and is labelled as such. Result files written after the
// fix also carry `safetyHints`, the readOnlyHint/destructiveHint/
// idempotentHint/openWorldHint coverage the write-ups meant; when every
// included server has it, RQ2_safetyHints is reported from it.
function coverageBlock(field) {
  const rows = withTools.filter((r) => r[field]);
  if (rows.length !== withTools.length) return null;
  const c = { all: 0, none: 0, partial: 0 };
  for (const r of rows) c[r[field].state] += 1;
  const partials = rows.filter((r) => r[field].state === 'partial')
    .map((r) => ({ id: r.id, package: r.package, missing: r[field].missing, total: r[field].total }));
  const missing = rows.reduce((n, r) => n + r[field].missing, 0);
  return { c, partials, missing };
}
const titleCov = coverageBlock('annotations');
const hintCov = coverageBlock('safetyHints');
const ann = titleCov.c;
const partials = titleCov.partials;
const toolsMissingAnn = titleCov.missing;

// One-sided 95% upper bound on partial prevalence (Clopper-Pearson), reported
// ALWAYS, so a sample that happens to observe zero partial servers can never be
// written up as proof that none exist. For k=0 this is 1 - 0.05^(1/n), the
// "rule of three" bound the August summary used; the earlier code applied that
// k=0 formula for every k, which under-reported the bound once the October
// draw observed partial servers. Fixed 2026-10-01; the August number (k=0) is
// unchanged by the fix.
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
const upper95 = upperBound95(ann.partial, withTools.length);

const protos = {};
for (const r of inc) protos[r.negotiatedProtocol || 'unknown'] = (protos[r.negotiatedProtocol || 'unknown'] || 0) + 1;

const wall = inc.map((r) => r.wallMs).filter((x) => x != null).sort((a, b) => a - b);
const p = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : null);

const summary = {
  study: 'MCP registry probability sample, behavioral tier',
  sample: {
    seed: manifest.seed, n: manifest.n, frameSha256: manifest.frameSha256,
    frameCount: manifest.frameCount, frameSnapshotDate: manifest.frameSnapshotDate,
  },
  probed: recs.length,
  included: inc.length,
  includedPct: round(100 * inc.length / recs.length),
  excluded: exc.length,
  excludeBreakdown: Object.fromEntries(Object.entries(excBreak).sort((a, b) => b[1] - a[1])),
  RQ1_conformance: {
    totalToolsMeasured: tools,
    toolsWithDescriptions: described,
    toolsWithSchemaFailures: failing,
    serversWithAnySchemaFailure: inc.filter((r) => r.toolsWithFails > 0).length,
    serversWithZeroTools: inc.length - withTools.length,
  },
  RQ2_annotations: {
    _measures: 'TITLE presence per tool (rule tool/missing-title), NOT safety hints. Historical field name kept so summaries stay comparable; see RQ2_safetyHints and study/2026-10/august-recount/README.md.',
    serversWithTools: withTools.length,
    all: ann.all, none: ann.none, partial: ann.partial,
    bimodalPct: withTools.length ? round(100 * (ann.all + ann.none) / withTools.length) : null,
    partialPrevalenceUpper95Pct: upper95,
    partialServers: partials,
    toolsMissingAnnotations: toolsMissingAnn,
    toolsMissingAnnotationsPct: tools ? round(100 * toolsMissingAnn / tools) : null,
    _caveat: 'partial=0 is a NEGATIVE result in one sample, never proof that partial servers do not exist. Report partialPrevalenceUpper95Pct alongside it.',
  },
  RQ2_safetyHints: hintCov ? {
    _measures: 'readOnlyHint/destructiveHint/idempotentHint/openWorldHint presence per tool (rule tool/no-safety-hints).',
    serversWithTools: withTools.length,
    all: hintCov.c.all, none: hintCov.c.none, partial: hintCov.c.partial,
    bimodalPct: withTools.length ? round(100 * (hintCov.c.all + hintCov.c.none) / withTools.length) : null,
    partialPrevalenceUpper95Pct: upperBound95(hintCov.c.partial, withTools.length),
    partialServers: hintCov.partials,
    toolsMissingSafetyHints: hintCov.missing,
    toolsMissingSafetyHintsPct: tools ? round(100 * hintCov.missing / tools) : null,
  } : {
    _note: 'result files predate the 2026-10-01 harness fix and carry no safetyHints field; compute from a captured catalog instead (study/2026-10/sample/annotation-stats.mjs).',
  },
  RQ2_protocol: protos,
  RQ3_walltime: {
    note: 'Wall time includes first-run npx install cost and is measured under concurrency. NOT a latency measurement.',
    p50: p(wall, 0.5), p95: p(wall, 0.95), min: wall[0] ?? null, max: wall[wall.length - 1] ?? null,
  },
};

writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
