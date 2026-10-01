#!/usr/bin/env node
// probe-sample.mjs — behavioral tier for a registry probability sample.
//
// Runs mcp-probe against every server in a sample manifest produced by
// draw-sample.mjs, writes one compact JSON record per server, and is RESUMABLE:
// a server that already has a record is skipped. That matters because this
// sandbox kills background processes between turns, so a 400-server run has to
// be chunked into repeated in-turn invocations rather than backgrounded. Two
// earlier study runs were lost before that was understood.
//
// It also prunes the npx cache as it goes. An unpruned npx cache reached 21GB on
// a previous run and filled the volume; the symptom was a linker "bus error",
// not a disk error.
//
// Usage:
//   node probe-sample.mjs --sample sample.json --probe-root /path/to/mcp-probe \
//        --out results/ [--concurrency 6] [--per-server-ms 45000] [--budget-ms 470000]
//
// Exits 3 while servers remain, so a caller can loop until it exits 0.
//
// Guardrails, unchanged from STUDY.md: public servers only, no credentials ever
// supplied, no side-effecting tool invoked (never passes --call), every excluded
// server recorded with a reason rather than dropped.

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

const SAMPLE = arg('sample');
const PROBE_ROOT = arg('probe-root');
const OUT = arg('out');
const CONCURRENCY = Number(arg('concurrency', '4'));
const PER_SERVER_MS = Number(arg('per-server-ms', '60000'));
const BUDGET_MS = Number(arg('budget-ms', '420000'));
const PROBE_TIMEOUT_MS = 15000;

if (!SAMPLE || !PROBE_ROOT || !OUT) {
  console.error('usage: node probe-sample.mjs --sample <manifest.json> --probe-root <dir> --out <dir>');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync(SAMPLE, 'utf8'));
const all = manifest.servers;
const done = new Set(readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
const todo = all.filter((s) => !done.has(s.id));

console.error(`[probe] sample=${all.length} done=${done.size} todo=${todo.length} concurrency=${CONCURRENCY} budget=${Math.round(BUDGET_MS / 1000)}s`);

// npm-level resolution failure. Checked BEFORE credentials because npm's own
// error text contains words like "auth" that would otherwise misclassify.
const NPM_MISSING = ['e404', 'npm error 404', '404 not found', 'could not resolve', 'is not in this registry',
  'no matching version', 'npm err!'];
const CRED_WORDS = ['api key', 'api_key', 'apikey', 'token', 'credential', 'environment variable',
  'must be set', 'unauthorized', 'auth', 'secret', 'connection string', 'not set', 'missing env'];

function probe(pkg) {
  const args = ['bin/mcp-probe.js', '--json', '--timeout', String(PROBE_TIMEOUT_MS), '--', 'npx', '-y', pkg];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', args, { cwd: PROBE_ROOT, env: process.env });
    let out = '';
    let err = '';
    let killed = false;
    const killer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch {} }, PER_SERVER_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-3000)));
    child.on('close', (code) => {
      clearTimeout(killer);
      let json = null;
      try { json = JSON.parse(out); } catch {}
      resolve({ json, exitCode: code, wallMs: Date.now() - started, killed, stderrTail: err.trim() });
    });
  });
}

function classify(run) {
  const j = run.json;
  if (run.killed && !j) return ['excluded', 'timeout'];
  if (!j) {
    const s = (run.stderrTail || '').toLowerCase();
    if (s.includes('404') || s.includes('could not resolve') || s.includes('not found'))
      return ['excluded', 'package-unavailable'];
    return ['excluded', 'launch-failed'];
  }
  if (!j.server) {
    const blob = ((run.stderrTail || '') + ' ' + (j.errors || []).join(' ')).toLowerCase();
    if (NPM_MISSING.some((w) => blob.includes(w))) return ['excluded', 'package-unavailable'];
    if (CRED_WORDS.some((w) => blob.includes(w))) return ['excluded', 'needs-credentials'];
    return ['excluded', 'handshake-failed'];
  }
  return ['included', null];
}

// Annotation coverage, the finding that was previously overclaimed as absolute.
//
// CORRECTION 2026-10-01. Until this date the function below counted a tool as
// "missing annotations" when any lint issue's JSON contained the word
// "annotation". The only probe message that contains that word is the one for
// a missing tool TITLE ('tool has no "title" annotation'); the safety-hint
// message does not. So every "annotation" figure produced by this harness
// before 2026-10-01, including the August 2026 draw and the paper written
// from it, measured TITLE presence, not readOnlyHint/destructiveHint/
// idempotentHint/openWorldHint. The function now reports both, by rule id,
// under names that say which is which. `annotations` keeps the old shape and
// the old (title) meaning so earlier result files stay comparable; the new
// `safetyHints` field is the one the paper's prose describes. See
// study/2026-10/august-recount/README.md.
// Recorded per server as all / none / partial so bimodality is MEASURED rather
// than asserted, and so a partial server can never be rounded away.
function coverage(tools, ruleId) {
  if (!tools.length) return { state: 'no-tools', missing: 0, total: 0 };
  const missing = tools.filter((t) => (t.issues || []).some((i) => i.id === ruleId)).length;
  const state = missing === 0 ? 'all' : missing === tools.length ? 'none' : 'partial';
  return { state, missing, total: tools.length };
}
// Title presence. This is what the pre-2026-10-01 code measured.
function annotationState(tools) { return coverage(tools, 'tool/missing-title'); }
// Safety hints. This is what the write-ups meant.
function safetyHintState(tools) { return coverage(tools, 'tool/no-safety-hints'); }

function record(server, run) {
  const [status, reason] = classify(run);
  const j = run.json;
  const tools = (j && j.tools) || [];
  return {
    id: server.id,
    package: server.package,
    version: server.version,
    status,
    excludeReason: reason,
    wallMs: run.wallMs,
    exitCode: run.exitCode,
    serverName: j?.server?.name ?? null,
    serverVersion: j?.server?.version ?? null,
    negotiatedProtocol: j?.negotiatedProtocolVersion ?? null,
    healthy: j?.ok === true,
    toolCount: tools.length,
    toolsDescribed: tools.filter((t) => t.description && String(t.description).trim()).length,
    toolsWithFails: tools.filter((t) => t.fails > 0).length,
    toolsWithWarns: tools.filter((t) => t.warns > 0).length,
    // `annotations` = title coverage (historical name, see the correction above).
    annotations: annotationState(tools),
    // `safetyHints` = readOnlyHint/destructiveHint/idempotentHint/openWorldHint coverage.
    safetyHints: safetyHintState(tools),
    // name + full description: the unit the redundancy study deduplicates on.
    toolCatalog: status === 'included'
      ? tools.map((t) => ({ name: t.name, description: t.description ?? null }))
      : undefined,
    stderrTail: status === 'included' ? undefined : (run.stderrTail || '').slice(-400),
  };
}

function pruneNpx() {
  try {
    const bytes = execSync('du -sb ~/.npm/_npx 2>/dev/null | cut -f1', { shell: '/bin/bash' }).toString().trim();
    if (Number(bytes) > 2e9) {
      execSync('rm -rf ~/.npm/_npx', { shell: '/bin/bash' });
      console.error(`[probe] pruned npx cache (was ${(Number(bytes) / 1e9).toFixed(1)}GB)`);
    }
  } catch {}
}

const started = Date.now();
let idx = 0;
let n = 0;
let stopped = false;

async function worker() {
  for (;;) {
    if (stopped || Date.now() - started > BUDGET_MS) { stopped = true; return; }
    const i = idx++;
    if (i >= todo.length) return;
    const s = todo[i];
    const run = await probe(s.package);
    const rec = record(s, run);
    writeFileSync(join(OUT, `${s.id}.json`), JSON.stringify(rec, null, 2));
    n += 1;
    console.error(
      `[${done.size + n}/${all.length}] ${rec.status.padEnd(8)} ${(rec.excludeReason || '').padEnd(19)} ` +
      `${s.package.slice(0, 44).padEnd(44)} tools=${rec.toolCount} title=${rec.annotations.state} hints=${rec.safetyHints.state}`
    );
    if (n % 20 === 0) pruneNpx();
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
pruneNpx();
const remaining = all.length - (done.size + n);
console.error(`[probe] this chunk probed ${n}; ${remaining} remaining. Re-run the same command to continue.`);
if (remaining > 0) process.exitCode = 3;
