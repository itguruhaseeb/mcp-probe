#!/usr/bin/env node
// capture-catalog.mjs: second pass over the INCLUDED servers of a probed draw
// that keeps the full tool objects (name, description, inputSchema, annotations)
// the harness discards. probe-sample.mjs keeps only name and description per
// tool, which is enough for the conformance and redundancy counts but not for
// anything that reads annotations tool by tool, such as the readOnlyHint
// truthfulness study in study/2026-10/.
//
// Same rules as the first pass: no credentials supplied, nothing invoked
// (never --call), kill timeout per server. A server's catalog can differ
// between passes (nondeterministic servers exist); the script records the first
// pass toolCount next to the second so the difference is visible, never papered
// over. Resumable: an existing catalog file is not re-probed.
//
// Usage:
//   node capture-catalog.mjs --sample sample.json --results results/ --probe-root <mcp-probe> \
//        --out catalog/ [--concurrency 2] [--per-server-ms 45000] [--budget-ms 500000]
//   node capture-catalog.mjs --sample ../../2026-08/sample/study-2026-08-22.tsv --pin \
//        --probe-root <mcp-probe> --out ../august-recount/catalog/
//
// Requires an mcp-probe whose --json output carries title and inputSchema per
// tool (commit after 2026-10-01); the 0.1.2 release does not.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; }

const samplePath = arg('sample');
const resultsDir = arg('results');
const PROBE_ROOT = arg('probe-root');
const outDir = arg('out', 'catalog');
const CONC = Number(arg('concurrency', '2'));
const PER_SERVER_MS = Number(arg('per-server-ms', '45000'));
const BUDGET_MS = Number(arg('budget-ms', '500000'));
const PROBE_TIMEOUT_MS = Number(arg('probe-timeout-ms', '15000'));
if (!samplePath || !PROBE_ROOT || (!samplePath.endsWith('.tsv') && !resultsDir)) {
  console.error('usage: node capture-catalog.mjs --sample <manifest.json|outcomes.tsv> [--results <dir>] --probe-root <dir> --out <dir> [--pin]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// --pin: probe pkg@version instead of the latest publish. Used to re-probe the
// August draw at the versions it was drawn at, so the recount is of the same
// code the August table describes. A version that has since been unpublished
// fails in the open and is reported, not substituted.
const PIN = process.argv.includes('--pin');

const todo = [];
if (samplePath.endsWith('.tsv')) {
  // Outcome-table mode: the August draw has no manifest with ids, only the
  // released TSV. Rows are in draw order; included rows (st=I) are captured.
  const lines = readFileSync(samplePath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const hdr = lines[0].split('\t');
  lines.slice(1).forEach((l, i) => {
    const c = Object.fromEntries(hdr.map((h, k) => [h, l.split('\t')[k]]));
    if (c.st !== 'I') return;
    const id = `row${String(i + 1).padStart(3, '0')}-${c.pkg.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
    if (existsSync(join(outDir, `${id}.json`))) return;
    todo.push({ id, package: c.pkg, version: c.ver || null, firstPassToolCount: Number(c.tools) });
  });
} else {
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
  for (const s of sample.servers) {
    let r;
    try { r = JSON.parse(readFileSync(join(resultsDir, `${s.id}.json`), 'utf8')); } catch { continue; }
    if (r.status !== 'included') continue;
    if (existsSync(join(outDir, `${s.id}.json`))) continue;
    todo.push({ ...s, firstPassToolCount: r.toolCount });
  }
}
console.error(`[catalog] included servers to capture: ${todo.length} concurrency=${CONC} budget=${Math.round(BUDGET_MS / 1000)}s`);

function probe(pkg, version) {
  const spec = PIN && version ? `${pkg}@${version}` : pkg;
  const args = ['bin/mcp-probe.js', '--json', '--timeout', String(PROBE_TIMEOUT_MS), '--', 'npx', '-y', spec];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', args, { cwd: PROBE_ROOT, env: process.env });
    let out = '';
    let err = '';
    let killed = false;
    const killer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch {} }, PER_SERVER_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    child.on('close', (code) => {
      clearTimeout(killer);
      let json = null;
      try { json = JSON.parse(out); } catch {}
      resolve({ json, exitCode: code, wallMs: Date.now() - started, killed, stderrTail: err.trim() });
    });
  });
}

const started = Date.now();
let next = 0;
let done = 0;
async function worker() {
  while (next < todo.length && Date.now() - started < BUDGET_MS) {
    const s = todo[next++];
    const run = await probe(s.package, s.version);
    const j = run.json;
    const tools = j?.tools || [];
    const record = {
      id: s.id,
      package: s.package,
      version: s.version,
      pinned: PIN,
      capturedAt: new Date().toISOString(),
      probeVersion: j?.version ?? null,
      secondPassOk: j?.ok === true && !!j?.server,
      exitCode: run.exitCode,
      killed: run.killed,
      wallMs: run.wallMs,
      firstPassToolCount: s.firstPassToolCount,
      secondPassToolCount: j?.server ? tools.length : null,
      server: j?.server ?? null,
      negotiatedProtocol: j?.negotiatedProtocolVersion ?? null,
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title ?? null,
        description: t.description ?? null,
        inputSchema: t.inputSchema ?? null,
        outputSchema: t.outputSchema ?? null,
        annotations: t.annotations ?? null,
        // The probe's own lint issues, kept so the first-pass annotation
        // metric (probe-sample.mjs annotationState) can be recomputed exactly.
        issues: t.issues ?? [],
      })),
      stderrTail: j?.server ? undefined : run.stderrTail.slice(-400),
    };
    writeFileSync(join(outDir, `${s.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    done += 1;
    const flag = record.secondPassToolCount === s.firstPassToolCount ? '' : ` (first pass ${s.firstPassToolCount})`;
    console.error(`[${done}/${todo.length}] ${record.secondPassOk ? 'ok  ' : 'FAIL'} ${s.package.padEnd(44)} tools=${record.secondPassToolCount ?? '-'}${flag}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
const remaining = todo.length - next;
console.error(`[catalog] this chunk captured ${done}; ${Math.max(0, remaining)} remaining. Re-run the same command to continue.`);
process.exit(remaining > 0 ? 3 : 0);
