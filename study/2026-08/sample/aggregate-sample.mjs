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
const ann = { all: 0, none: 0, partial: 0 };
for (const r of withTools) ann[r.annotations.state] += 1;
const partials = withTools.filter((r) => r.annotations.state === 'partial')
  .map((r) => ({ id: r.id, package: r.package, missing: r.annotations.missing, total: r.annotations.total }));
const toolsMissingAnn = withTools.reduce((n, r) => n + r.annotations.missing, 0);

// One-sided 95% upper bound on partial prevalence. Reported ALWAYS, so a sample
// that happens to observe zero partial servers can never be written up as proof
// that none exist.
const upper95 = withTools.length ? round(100 * (1 - Math.pow(0.05, 1 / withTools.length))) : null;

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
    serversWithTools: withTools.length,
    all: ann.all, none: ann.none, partial: ann.partial,
    bimodalPct: withTools.length ? round(100 * (ann.all + ann.none) / withTools.length) : null,
    partialPrevalenceUpper95Pct: upper95,
    partialServers: partials,
    toolsMissingAnnotations: toolsMissingAnn,
    toolsMissingAnnotationsPct: tools ? round(100 * toolsMissingAnn / tools) : null,
    _caveat: 'partial=0 is a NEGATIVE result in one sample, never proof that partial servers do not exist. Report partialPrevalenceUpper95Pct alongside it.',
  },
  RQ2_protocol: protos,
  RQ3_walltime: {
    note: 'Wall time includes first-run npx install cost and is measured under concurrency. NOT a latency measurement.',
    p50: p(wall, 0.5), p95: p(wall, 0.95), min: wall[0] ?? null, max: wall[wall.length - 1] ?? null,
  },
};

writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
