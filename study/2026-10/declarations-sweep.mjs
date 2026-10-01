#!/usr/bin/env node
// declarations-sweep.mjs
//
// Capture what the registry DECLARES about every npm/stdio package at one
// snapshot: the environmentVariables each package lists, with the isRequired
// flag, keyed by npm identifier. Run in the same hour as harvest.mjs so a probe
// drawn from that frame can be joined to declarations taken at the same time,
// which is what the 2026-10-01 declared-vs-observed analysis lacked.
//
// Reads the registry only. Executes no server code.
//
// Usage: node declarations-sweep.mjs --out declarations-<date>.json

import { writeFileSync } from 'node:fs';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };

async function main() {
  const out = arg('out', 'declarations.json');
  const snapshotDate = new Date().toISOString();
  const map = {};
  let cursor = null, pages = 0, rows = 0;
  do {
    const u = new URL(REGISTRY);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`registry ${res.status} at page ${pages}`);
    const d = await res.json();
    for (const e of d.servers || []) {
      const s = e.server || {};
      const meta = e._meta?.['io.modelcontextprotocol.registry/official'] || {};
      for (const p of s.packages || []) {
        rows += 1;
        if (p.registryType !== 'npm') continue;
        if ((p.transport?.type || 'stdio') !== 'stdio') continue;
        const id = p.identifier;
        if (!id || map[id]) continue; // first occurrence wins; harvest dedups to newest version separately
        const ev = p.environmentVariables || [];
        map[id] = {
          registryName: s.name,
          version: p.version || null,
          status: meta.status || 'unknown',
          declared: ev.length,
          required: ev.filter((v) => v.isRequired || v.required).length,
          names: ev.map((v) => v.name).filter(Boolean),
          repository: s.repository?.url || null,
        };
      }
    }
    cursor = d.metadata?.nextCursor || null;
    pages += 1;
    if (cursor) await sleep(150);
  } while (cursor);
  const result = { snapshotDate, source: REGISTRY, registryPagesSwept: pages, packageRowsSeen: rows,
    npmStdioPackages: Object.keys(map).length, packages: map };
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.error(`[decl] ${pages} pages, ${rows} package rows, ${Object.keys(map).length} npm/stdio packages -> ${out}`);
}
main().catch((e) => { console.error('[decl] failed:', e.message); process.exit(1); });
