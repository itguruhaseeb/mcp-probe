#!/usr/bin/env node
// run-study.mjs — the reproducible harness for the mcp-probe conformance study.
//
// For every candidate server in benchmark/servers.json it:
//   1. launches the server over stdio via `mcp-probe --json` (NO --call by
//      default, to honor the "never trigger side-effecting tools" guardrail in
//      STUDY.md; --call is only used for entries flagged roundTripSafe),
//   2. captures the full machine-readable probe record, exit code, wall time,
//   3. classifies the outcome (included / excluded-with-reason),
//   4. writes one raw JSON record per server plus an aggregate summary.
//
// No credentials are ever supplied. Servers that cannot initialize without
// secrets are recorded as excluded (reason: needs-credentials) — never dropped
// silently. Results land in benchmark/results/.
//
// Usage:  node benchmark/run-study.mjs [--call-safe] [--per-server-ms 60000]

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS = join(__dirname, 'results');
const RAW = join(RESULTS, 'raw');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
}
const PER_SERVER_MS = Number(arg('--per-server-ms', '90000'));
const PROBE_TIMEOUT_MS = 15000; // per-request timeout handed to mcp-probe

const frame = JSON.parse(readFileSync(join(__dirname, 'servers.json'), 'utf8'));
const sandbox = mkdtempSync(join(tmpdir(), 'mcp-study-'));

mkdirSync(RAW, { recursive: true });

// Run one `mcp-probe --json` invocation, killing it after PER_SERVER_MS.
function probe(server) {
  const args = server.args.map((a) => a.replaceAll('__SANDBOX__', sandbox));
  const probeArgs = ['bin/mcp-probe.js', '--json', '--timeout', String(PROBE_TIMEOUT_MS)];
  if (server.roundTripSafe) probeArgs.push('--call');
  probeArgs.push('--', 'npx', '-y', server.package, ...args);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', probeArgs, { cwd: ROOT, env: process.env });
    let out = '';
    let err = '';
    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch {}
    }, PER_SERVER_MS);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('close', (code) => {
      clearTimeout(killer);
      const wallMs = Date.now() - started;
      let json = null;
      try { json = JSON.parse(out); } catch {}
      resolve({ json, exitCode: code, wallMs, killed, stderrTail: err.trim(), rawStdout: out });
    });
  });
}

function classify(server, run) {
  const j = run.json;
  if (run.killed && !j) return { status: 'excluded', reason: 'timeout' };
  if (!j) {
    // No JSON at all: npx install failed / package missing / crashed pre-handshake.
    const s = (run.stderrTail || '').toLowerCase();
    if (s.includes('404') || s.includes('could not resolve') || s.includes('not found'))
      return { status: 'excluded', reason: 'package-unavailable' };
    return { status: 'excluded', reason: 'launch-failed' };
  }
  if (!j.server && (j.errors || []).length) {
    // Handshake failed. Distinguish "needs credentials" (server exits early,
    // often printing an API-key/token message) from a generic launch failure.
    const blob = ((run.stderrTail || '') + ' ' + (j.errors || []).join(' ')).toLowerCase();
    const credWords = ['api key', 'api_key', 'token', 'credential', 'environment variable',
      'must be set', 'unauthorized', 'auth', 'secret', 'connection string'];
    if (credWords.some((w) => blob.includes(w)))
      return { status: 'excluded', reason: 'needs-credentials' };
    return { status: 'excluded', reason: 'handshake-failed' };
  }
  return { status: 'included', reason: null };
}

function derive(j) {
  if (!j || !j.server) return null;
  const tools = j.tools || [];
  const deviations = {};
  for (const t of tools) {
    for (const iss of t.issues || []) {
      const key = `${iss.severity}:${normalize(iss.message)}`;
      deviations[key] = (deviations[key] || 0) + 1;
    }
  }
  const toolsWithFails = tools.filter((t) => t.fails > 0).length;
  const toolsWithWarns = tools.filter((t) => t.warns > 0).length;
  return {
    initializes: j.ok !== undefined,
    handshakeOk: !!j.server,
    healthy: j.ok === true,
    serverName: j.server?.name || null,
    serverVersion: j.server?.version || null,
    negotiatedProtocol: j.negotiatedProtocolVersion || null,
    protocolMismatch: !!(j.negotiatedProtocolVersion &&
      j.negotiatedProtocolVersion !== j.clientProtocolVersion),
    capabilities: Object.keys(j.capabilities || {}),
    toolCount: tools.length,
    toolsClean: tools.filter((t) => t.fails === 0 && t.warns === 0).length,
    toolsWithFails,
    toolsWithWarns,
    schemaValidPct: tools.length ? round(100 * tools.filter((t) => t.fails === 0).length / tools.length) : null,
    deviationTypes: deviations,
    nonJsonStdout: (j.warnings || []).some((w) => w.includes('non-JSON')),
    handshakeMs: j.timings?.handshakeMs ?? null,
    toolsListMs: j.timings?.toolsListMs ?? null,
  };
}

// Collapse dynamic bits (quoted names, numbers) so deviation messages aggregate.
function normalize(msg) {
  return msg.replace(/"[^"]*"/g, '"X"').replace(/\d+/g, 'N').trim();
}
function round(n) { return Math.round(n * 10) / 10; }

async function main() {
  const records = [];
  for (const server of frame.servers) {
    process.stderr.write(`[study] probing ${server.id} (${server.package}) ...\n`);
    const run = await probe(server);
    const { status, reason } = classify(server, run);
    const derived = derive(run.json);
    const record = {
      id: server.id,
      package: server.package,
      category: server.category,
      launch: `npx -y ${server.package} ${server.args.join(' ')}`.trim(),
      status,
      excludeReason: reason,
      wallMs: run.wallMs,
      exitCode: run.exitCode,
      derived,
      stderrTail: status === 'included' ? undefined : (run.stderrTail || '').slice(-600),
    };
    records.push(record);
    writeFileSync(join(RAW, `${server.id}.json`), JSON.stringify(run.json ?? { error: 'no-json', stderrTail: run.stderrTail }, null, 2));
    process.stderr.write(`         -> ${status}${reason ? ' (' + reason + ')' : ''}` +
      (derived ? `, ${derived.toolCount} tools, ${derived.schemaValidPct}% schema-valid` : '') + `\n`);
  }

  // ---- Aggregate (the study's headline numbers) ----
  const included = records.filter((r) => r.status === 'included');
  const excluded = records.filter((r) => r.status === 'excluded');
  const excludeBreakdown = {};
  for (const r of excluded) excludeBreakdown[r.excludeReason] = (excludeBreakdown[r.excludeReason] || 0) + 1;

  const allTools = included.reduce((n, r) => n + r.derived.toolCount, 0);
  const cleanTools = included.reduce((n, r) => n + r.derived.toolsClean, 0);
  const validSchemaTools = included.reduce((n, r) => n + (r.derived.toolCount - r.derived.toolsWithFails), 0);

  const deviationTotals = {};
  for (const r of included)
    for (const [k, v] of Object.entries(r.derived.deviationTypes))
      deviationTotals[k] = (deviationTotals[k] || 0) + v;

  const handshakes = included.map((r) => r.derived.handshakeMs).filter((x) => x != null).sort((a, b) => a - b);
  const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);

  const summary = {
    tool: 'mcp-probe',
    toolVersion: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    clientProtocolVersion: '2025-06-18',
    node: process.version,
    candidateCount: records.length,
    includedCount: included.length,
    excludedCount: excluded.length,
    excludeBreakdown,
    RQ1_conformance: {
      serversInitialized: included.length,
      serversHealthy: included.filter((r) => r.derived.healthy).length,
      totalToolsMeasured: allTools,
      toolsWithValidSchema: validSchemaTools,
      toolsSchemaValidPct: allTools ? round(100 * validSchemaTools / allTools) : null,
      toolsFullyClean: cleanTools,
      toolsFullyCleanPct: allTools ? round(100 * cleanTools / allTools) : null,
      serversWithAllValidSchemas: included.filter((r) => r.derived.toolsWithFails === 0).length,
    },
    RQ2_drift: {
      deviationTypes: Object.fromEntries(
        Object.entries(deviationTotals).sort((a, b) => b[1] - a[1])
      ),
      protocolVersionsSeen: [...new Set(included.map((r) => r.derived.negotiatedProtocol))].filter(Boolean),
      serversWithProtocolMismatch: included.filter((r) => r.derived.protocolMismatch).length,
      serversEmittingNonJsonStdout: included.filter((r) => r.derived.nonJsonStdout).length,
    },
    RQ3_reliability_pilot: {
      handshakeMs_p50: pct(handshakes, 0.5),
      handshakeMs_p95: pct(handshakes, 0.95),
      handshakeMs_min: handshakes[0] ?? null,
      handshakeMs_max: handshakes[handshakes.length - 1] ?? null,
      note: 'Latency includes first-run npx install cost; see STUDY.md threats-to-validity. Malformed-request behavior is out of scope for this baseline run.',
    },
    perServer: records.map((r) => ({
      id: r.id, category: r.category, status: r.status, excludeReason: r.excludeReason,
      tools: r.derived?.toolCount ?? null, schemaValidPct: r.derived?.schemaValidPct ?? null,
      protocol: r.derived?.negotiatedProtocol ?? null, handshakeMs: r.derived?.handshakeMs ?? null,
    })),
  };

  writeFileSync(join(RESULTS, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(RESULTS, 'records.json'), JSON.stringify(records, null, 2));

  // CSV for spreadsheet / paper tables.
  const cols = ['id', 'category', 'status', 'excludeReason', 'serverName', 'serverVersion',
    'protocol', 'toolCount', 'toolsWithFails', 'schemaValidPct', 'handshakeMs'];
  const rows = [cols.join(',')];
  for (const r of records) {
    const d = r.derived || {};
    rows.push([r.id, r.category, r.status, r.excludeReason ?? '', csv(d.serverName), d.serverVersion ?? '',
      d.negotiatedProtocol ?? '', d.toolCount ?? '', d.toolsWithFails ?? '', d.schemaValidPct ?? '',
      d.handshakeMs ?? ''].join(','));
  }
  writeFileSync(join(RESULTS, 'summary.csv'), rows.join('\n') + '\n');

  try { rmSync(sandbox, { recursive: true, force: true }); } catch {}

  process.stderr.write('\n[study] DONE\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
function csv(v) { if (v == null) return ''; return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

main().catch((e) => { process.stderr.write('FATAL ' + (e?.stack || e) + '\n'); process.exit(1); });
