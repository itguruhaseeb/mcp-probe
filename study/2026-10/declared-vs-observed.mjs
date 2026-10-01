#!/usr/bin/env node
// declared-vs-observed.mjs
//
// Does the MCP registry's declared environment-variable metadata predict whether
// a server actually starts?
//
// Input:  study/2026-08/sample/study-2026-08-22.tsv, the released 400-draw outcomes.
// Does:   sweeps the registry, matches each drawn npm package to its entry, and
//         compares "declares a REQUIRED environment variable" against the probe's
//         observed outcome.
// Output: declared-vs-observed-<date>.json
//
// Usage: node declared-vs-observed.mjs --tsv <path> --out <path>
//        node declared-vs-observed.mjs --tsv <path> --declarations <declarations.json> --out <path>
//
// With --declarations, the saved output of declarations-sweep.mjs is used
// instead of a live sweep. That is the same-snapshot mode: pass the sweep taken
// in the same hour as the frame the draw was made from, and the "different
// times" limitation below does not apply.
//
// The live sweep is ~1,300 pages at 150ms and takes a few minutes. It reads the
// registry only; it executes no server code.

import { readFileSync, writeFileSync } from 'node:fs';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 ? process.argv[i + 1] : d;
};

function readOutcomes(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const hdr = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(hdr.map((h, i) => [h, c[i]]));
  });
}

// Match on the npm identifier. A package that has since left the registry simply
// does not match and is excluded from the comparison with its count reported,
// rather than being silently treated as "declares nothing".
async function sweepDeclarations(wanted) {
  const map = new Map();
  let cursor = null, pages = 0;
  do {
    const u = new URL(REGISTRY);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`registry ${res.status} at page ${pages}`);
    const d = await res.json();
    for (const e of d.servers || []) {
      for (const p of (e.server || {}).packages || []) {
        if (p.registryType !== 'npm') continue;
        if (!wanted.has(p.identifier) || map.has(p.identifier)) continue;
        const ev = p.environmentVariables || [];
        map.set(p.identifier, {
          declared: ev.length,
          required: ev.filter((v) => v.isRequired || v.required).length,
        });
      }
    }
    cursor = d.metadata?.nextCursor || null;
    pages += 1;
    if (cursor) await sleep(150);
  } while (cursor);
  return { map, pages };
}

function ztest(k1, n1, k2, n2) {
  const p1 = k1 / n1, p2 = k2 / n2, p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const z = se ? (p1 - p2) / se : 0;
  // Abramowitz-Stegun 7.1.26
  const erfAS = (x) => {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
      + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  const pv = 2 * (1 - 0.5 * (1 + erfAS(Math.abs(z) / Math.SQRT2)));
  return { z: Number(z.toFixed(3)), p: Number(pv.toFixed(4)) };
}

async function main() {
  const tsv = arg('tsv', 'study/2026-08/sample/study-2026-08-22.tsv');
  const out = arg('out', 'declared-vs-observed.json');
  const rows = readOutcomes(tsv);
  const wanted = new Set(rows.map((r) => r.pkg));
  console.error(`[dvo] ${rows.length} drawn rows, ${wanted.size} distinct packages`);

  const declPath = arg('declarations', null);
  let map, pages, snapshot = null;
  if (declPath) {
    const d = JSON.parse(readFileSync(declPath, 'utf8'));
    const src = d.packages || d.map || d;
    snapshot = d.snapshotDate || d.snapshot || d.sweptAt || null;
    map = new Map();
    for (const r of rows) {
      const e = src[r.pkg];
      if (e && !map.has(r.pkg)) map.set(r.pkg, { declared: e.declared, required: e.required });
    }
    pages = d.registryPagesSwept ?? d.pages ?? null;
    console.error(`[dvo] saved declarations ${declPath} (snapshot ${snapshot}), matched ${map.size} of ${wanted.size}`);
  } else {
    ({ map, pages } = await sweepDeclarations(wanted));
    console.error(`[dvo] swept ${pages} pages, matched ${map.size} of ${wanted.size}`);
  }

  const matched = rows.filter((r) => map.has(r.pkg));
  const req = (r) => map.get(r.pkg).required > 0;
  const grp = (r) => (r.st === 'I' ? 'included' : r.rsn);

  const groups = {};
  for (const g of ['included', 'hs', 'cred', 'na']) {
    const sub = matched.filter((r) => grp(r) === g);
    if (!sub.length) continue;
    groups[g] = {
      n: sub.length,
      declaresAnyEnv: sub.filter((r) => map.get(r.pkg).declared > 0).length,
      declaresRequired: sub.filter(req).length,
      declaresRequiredPct: Number((100 * sub.filter(req).length / sub.length).toFixed(1)),
    };
  }

  const inc = matched.filter((r) => grp(r) === 'included');
  const hs = matched.filter((r) => grp(r) === 'hs');
  const cred = matched.filter((r) => grp(r) === 'cred');

  const result = {
    question: 'Does a declared REQUIRED environment variable predict that a server fails to start?',
    probeSnapshot: arg('probe-date', '2026-08-22'),
    registryReadAt: snapshot || new Date().toISOString(),
    declarationsSource: declPath || 'live sweep',
    limitation: declPath
      ? 'Same-snapshot mode: declarations were swept in the same hour as the frame the draw was made from (see declarationsSource); the probe ran the same day.'
      : 'The probe outcomes and the registry declarations were taken at different times. ' +
        'A declaration may have changed in between. A same-snapshot replication is required ' +
        'before any of this is stated as settled.',
    drawn: rows.length,
    matchedToRegistry: matched.length,
    registryPagesSwept: pages,
    groups,
    primaryComparison: {
      note:
        'handshake-failed against started-fine. The credential-labelled group is EXCLUDED here ' +
        'because the probe assigned that label by reading stderr for credential words, so its ' +
        'agreement with the registry is partly circular and would inflate the result.',
      brokenDeclaresRequiredPct: groups.hs.declaresRequiredPct,
      startedDeclaresRequiredPct: groups.included.declaresRequiredPct,
      ...ztest(hs.filter(req).length, hs.length, inc.filter(req).length, inc.length),
    },
    circularComparisonReportedForTransparency: {
      note: 'Do not quote this as the finding. It mostly measures that the probe and the registry agree about what a credential error looks like.',
      credDeclaresRequiredPct: groups.cred.declaresRequiredPct,
      startedDeclaresRequiredPct: groups.included.declaresRequiredPct,
      ...ztest(cred.filter(req).length, cred.length, inc.filter(req).length, inc.length),
    },
  };
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.error(`[dvo] wrote ${out}`);
}

main().catch((e) => { console.error('[dvo] failed:', e.message); process.exit(1); });
