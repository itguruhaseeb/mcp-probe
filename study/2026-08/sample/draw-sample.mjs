#!/usr/bin/env node
// draw-sample.mjs — draw a reproducible probability sample from the census
// candidate frame emitted by benchmark/harvest.mjs.
//
// Why this exists: the research lane's rule is that a result is real only if it
// regenerates from a committed script plus a committed seed. The August 2026
// 400-server sample was drawn without a committed draw script, so it could not
// be regenerated and its findings could not be audited. This script fixes that.
//
// The frame itself moves (the registry grows by roughly 195 servers a day), so a
// draw is only reproducible against the SAME frame. The manifest therefore
// records the SHA-256 of the exact frame bytes the draw was made from. Re-running
// against a different frame produces a different sample and the hash mismatch
// says so instead of silently pretending otherwise.
//
// Usage:
//   node draw-sample.mjs --frame benchmark/candidates-registry.json \
//                        --seed 20260819 --n 400 --out sample.json
//
// Output manifest fields:
//   seed, n, method, frame, frameSha256, frameCount, frameSnapshotDate,
//   ids[], servers[]

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const framePath = arg('frame');
const seed = Number(arg('seed'));
const n = Number(arg('n', '400'));
const outPath = arg('out', 'sample.json');

if (!framePath || !Number.isInteger(seed)) {
  console.error('usage: node draw-sample.mjs --frame <candidates.json> --seed <int> [--n 400] [--out sample.json]');
  process.exit(2);
}

const raw = readFileSync(framePath);
const frameSha256 = createHash('sha256').update(raw).digest('hex');
const frame = JSON.parse(raw.toString('utf8'));
const servers = frame.servers || [];

if (servers.length < n) {
  console.error(`frame has ${servers.length} servers, cannot draw ${n}`);
  process.exit(2);
}

// Canonical order first, so the draw does not depend on the frame's file order.
const ordered = [...servers].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));

// mulberry32: small, deterministic, and identical across Node versions.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Partial Fisher-Yates: unbiased draw without replacement.
const rand = mulberry32(seed);
const pool = [...ordered];
const drawn = [];
for (let i = 0; i < n; i += 1) {
  const j = i + Math.floor(rand() * (pool.length - i));
  [pool[i], pool[j]] = [pool[j], pool[i]];
  drawn.push(pool[i]);
}

const manifest = {
  _comment:
    'Probability sample of the npm/stdio candidate frame. Reproduce with: node draw-sample.mjs --frame <frame> --seed <seed> --n <n>. The draw is only reproducible against a frame whose sha256 matches frameSha256.',
  drawScript: 'draw-sample.mjs',
  seed,
  n,
  method: 'canonical sort by id, then partial Fisher-Yates with mulberry32(seed)',
  frame: framePath,
  frameSha256,
  frameCount: servers.length,
  frameSnapshotDate: frame.snapshotDate || null,
  ids: drawn.map((s) => s.id),
  servers: drawn.map((s) => ({ id: s.id, registryName: s.registryName, package: s.package, version: s.version })),
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `[draw] n=${n} seed=${seed} frame=${servers.length} sha256=${frameSha256.slice(0, 16)}… -> ${outPath}`
);
