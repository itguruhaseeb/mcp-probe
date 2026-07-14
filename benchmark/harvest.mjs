#!/usr/bin/env node
// harvest.mjs — build a large, reproducible CENSUS of the public MCP server
// ecosystem from the official MCP registry, without executing any server code.
//
// This is the "census tier" of the mcp-probe measurement study (see STUDY.md).
// It scales to the whole published population (hundreds–thousands of servers) by
// measuring only metadata the registry already exposes: transport types, package
// ecosystems, lifecycle status, and schema/version drift. No untrusted code is
// run, so it is safe to sweep at population scale and fully reproducible.
//
// The credential-free, npm-launchable, stdio subset it emits
// (candidates-registry.json) is the sampling frame the DYNAMIC tier
// (run-study.mjs) probes for schema/annotation/latency findings.
//
// Usage:  node benchmark/harvest.mjs
// Output: benchmark/corpus.json            (full per-server classified frame + provenance)
//         benchmark/results/census.json    (population-level aggregates)
//         benchmark/results/CENSUS.md       (human-readable findings)
//         benchmark/candidates-registry.json (npm/stdio launchable subset for the dynamic tier)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_CORPUS = join(HERE, 'corpus.json');
const OUT_CENSUS = join(HERE, 'results', 'census.json');
const OUT_CENSUS_MD = join(HERE, 'results', 'CENSUS.md');
const OUT_CANDIDATES = join(HERE, 'candidates-registry.json');

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const PAGE = 100;
const PAGE_DELAY_MS = 150;      // be polite to the registry
const MAX_PAGES = 5000;         // hard backstop (5000 * 100 = 500k version-rows)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

async function fetchPage(cursor) {
  const url = new URL(REGISTRY);
  url.searchParams.set('limit', String(PAGE));
  if (cursor) url.searchParams.set('cursor', cursor);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`registry ${res.status} at cursor=${cursor || '(start)'}`);
  return res.json();
}

// Sweep the whole registry via cursor pagination. Every version is collected;
// dedup to latest happens afterwards so nothing is silently dropped.
async function sweepRegistry() {
  const rows = [];
  let cursor = null;
  let pages = 0;
  do {
    const data = await fetchPage(cursor);
    for (const entry of data.servers || []) {
      const meta = entry._meta?.['io.modelcontextprotocol.registry/official'] || {};
      rows.push({ server: entry.server || {}, meta });
    }
    cursor = data.metadata?.nextCursor || null;
    pages += 1;
    process.stderr.write(`\r  swept ${pages} pages, ${rows.length} version-rows…`);
    if (cursor) await sleep(PAGE_DELAY_MS);
  } while (cursor && pages < MAX_PAGES);
  process.stderr.write('\n');
  const truncated = !!cursor; // stopped by MAX_PAGES rather than exhausting the cursor
  if (truncated) {
    console.error(
      `[harvest] WARNING: hit MAX_PAGES=${MAX_PAGES} with a live cursor — the ` +
        `population is LARGER than what was swept. Raise MAX_PAGES and re-run; ` +
        `this snapshot is a lower bound, not the full census.`
    );
  }
  return { rows, pages, truncated };
}

// Version compare (semver-ish, falls back to string) to pick the newest row per name.
function versionNewer(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10));
  const pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return String(a) > String(b);
    if (x !== y) return x > y;
  }
  return false;
}

function schemaDate(s) {
  const m = /schemas\/(\d{4}-\d{2}-\d{2})\//.exec(s?.$schema || '');
  return m ? m[1] : 'unknown';
}

function classify(server, meta) {
  const packages = Array.isArray(server.packages) ? server.packages : [];
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  const pkgTypes = [...new Set(packages.map((p) => p.registryType || 'unknown'))];
  const pkgTransports = [...new Set(packages.map((p) => p.transport?.type || 'unknown'))];
  const remoteTypes = [...new Set(remotes.map((r) => r.type || 'unknown'))];

  const hasStdio = packages.some((p) => (p.transport?.type || '') === 'stdio');
  const npmStdio = packages.find(
    (p) => p.registryType === 'npm' && (p.transport?.type || 'stdio') === 'stdio'
  );

  let deployment;
  if (packages.length && remotes.length) deployment = 'both';
  else if (packages.length) deployment = 'package';
  else if (remotes.length) deployment = 'remote';
  else deployment = 'none';

  return {
    name: server.name,
    version: server.version,
    title: server.title || null,
    status: meta.status || 'unknown',
    schemaDate: schemaDate(server),
    deployment,
    pkgTypes,
    pkgTransports,
    remoteTypes,
    hasStdio,
    // npm-published + stdio => launchable by the dynamic tier via `npx`
    npmStdioIdentifier: npmStdio ? npmStdio.identifier : null,
    npmStdioVersion: npmStdio ? npmStdio.version : null,
    publishedAt: meta.publishedAt || null,
    updatedAt: meta.updatedAt || null,
  };
}

function tally(list, keyFn) {
  const out = {};
  for (const x of list) {
    const ks = keyFn(x);
    for (const k of Array.isArray(ks) ? ks : [ks]) out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function githubTopicCount() {
  // Secondary provenance datapoint: how large is the topic:mcp-server universe on
  // GitHub? (The registry is the measured frame; this is context, not the sample.)
  try {
    const res = await fetch(
      'https://api.github.com/search/repositories?q=topic:mcp-server&per_page=1',
      { headers: { accept: 'application/vnd.github+json', 'user-agent': 'mcp-probe-harvest' } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d.total_count === 'number' ? d.total_count : null;
  } catch {
    return null;
  }
}

async function main() {
  const snapshotDate = new Date().toISOString();
  console.error(`[harvest] sweeping ${REGISTRY} …`);
  const { rows, pages, truncated } = await sweepRegistry();

  // Dedup to the newest version per server name.
  const latest = new Map();
  for (const { server, meta } of rows) {
    const name = server.name;
    if (!name) continue;
    const cur = latest.get(name);
    if (!cur || versionNewer(server.version, cur.server.version)) {
      latest.set(name, { server, meta });
    }
  }

  const classified = [...latest.values()].map(({ server, meta }) => classify(server, meta));
  const active = classified.filter((s) => s.status === 'active');
  const N = classified.length;

  const ghTopic = await githubTopicCount();

  const census = {
    tool: 'mcp-probe harvest',
    source: REGISTRY,
    snapshotDate,
    registryPagesSwept: pages,
    versionRowsFetched: rows.length,
    sweepComplete: !truncated, // false => hit MAX_PAGES; numbers are a lower bound
    uniqueServers: N,
    activeServers: active.length,
    githubTopicMcpServerRepos: ghTopic, // context only; not the measured frame
    lifecycle: tally(classified, (s) => s.status),
    deploymentModel: {
      counts: tally(classified, (s) => s.deployment),
      pct: {
        remoteOnly: pct(classified.filter((s) => s.deployment === 'remote').length, N),
        packageOnly: pct(classified.filter((s) => s.deployment === 'package').length, N),
        both: pct(classified.filter((s) => s.deployment === 'both').length, N),
        none: pct(classified.filter((s) => s.deployment === 'none').length, N),
      },
    },
    packageEcosystems: tally(
      classified.filter((s) => s.pkgTypes.length),
      (s) => s.pkgTypes
    ),
    packageTransports: tally(
      classified.filter((s) => s.pkgTransports.length),
      (s) => s.pkgTransports
    ),
    remoteTransports: tally(
      classified.filter((s) => s.remoteTypes.length),
      (s) => s.remoteTypes
    ),
    schemaVersionDrift: tally(classified, (s) => s.schemaDate),
    launchableNpmStdio: classified.filter((s) => s.npmStdioIdentifier).length,
    launchableNpmStdioPct: pct(classified.filter((s) => s.npmStdioIdentifier).length, N),
  };

  // Candidate frame for the dynamic tier: npm + stdio + active. These are the
  // servers run-study.mjs can actually launch via npx (still credential-gated at
  // run time; inclusion is decided empirically by the probe, per STUDY.md).
  const candidates = classified
    .filter((s) => s.npmStdioIdentifier && s.status === 'active')
    .map((s) => ({
      id: s.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, ''),
      registryName: s.name,
      package: s.npmStdioIdentifier,
      version: s.npmStdioVersion,
      title: s.title,
    }))
    .sort((a, b) => a.package.localeCompare(b.package));

  mkdirSync(dirname(OUT_CENSUS), { recursive: true });
  writeFileSync(
    OUT_CORPUS,
    JSON.stringify(
      {
        _comment:
          'Reproducible census frame of the public MCP registry, harvested by ' +
          'harvest.mjs. Metadata-only (no server code executed). Dedup to newest ' +
          'version per server name. Provenance in the fields below.',
        provenance: {
          source: REGISTRY,
          snapshotDate,
          registryPagesSwept: pages,
          versionRowsFetched: rows.length,
          uniqueServers: N,
        },
        servers: classified,
      },
      null,
      2
    )
  );
  writeFileSync(OUT_CENSUS, JSON.stringify(census, null, 2));
  writeFileSync(
    OUT_CANDIDATES,
    JSON.stringify(
      {
        _comment:
          'npm + stdio + active servers from the registry census — the sampling ' +
          'frame for the dynamic probe (run-study.mjs). Credential needs are ' +
          'verified empirically at run time, not assumed here.',
        snapshotDate,
        count: candidates.length,
        servers: candidates,
      },
      null,
      2
    )
  );
  writeCensusMd(census, candidates.length);

  console.error(
    `[harvest] ${N} unique servers (${active.length} active) across ${pages} pages; ` +
      `${census.launchableNpmStdio} npm/stdio launchable → candidates-registry.json`
  );
  console.error(`[harvest] wrote corpus.json, results/census.json, results/CENSUS.md`);
}

function writeCensusMd(c, candidateCount) {
  const top = (obj, n = 8) =>
    Object.entries(obj)
      .slice(0, n)
      .map(([k, v]) => `| \`${k}\` | ${v} | ${pct(v, c.uniqueServers)}% |`)
      .join('\n');
  const md = `# MCP ecosystem census — registry snapshot

Population-level measurement of the public Model Context Protocol server
ecosystem, harvested from the **official MCP registry** by \`benchmark/harvest.mjs\`.
This is the *census tier* of the study: it measures only metadata the registry
publishes, so it runs no server code and scales to the whole population. It is the
denominator the dynamic conformance probe (\`run-study.mjs\`) samples from.

- **Source:** ${c.source}
- **Snapshot:** ${c.snapshotDate}
- **Registry pages swept:** ${c.registryPagesSwept} (${c.versionRowsFetched} version-rows)
- **Unique servers (latest version each):** **${c.uniqueServers}**
- **Active servers:** ${c.activeServers}
- **Context — GitHub \`topic:mcp-server\` repos:** ${c.githubTopicMcpServerRepos ?? 'n/a'} (universe size; not the measured frame)

## Deployment model — how servers ship

| model | count | share |
|---|---|---|
| remote-only (hosted HTTP/SSE) | ${c.deploymentModel.counts.remote || 0} | ${c.deploymentModel.pct.remoteOnly}% |
| package-only (installed locally) | ${c.deploymentModel.counts.package || 0} | ${c.deploymentModel.pct.packageOnly}% |
| both | ${c.deploymentModel.counts.both || 0} | ${c.deploymentModel.pct.both}% |
| neither declared | ${c.deploymentModel.counts.none || 0} | ${c.deploymentModel.pct.none}% |

**Why it matters:** the deployment split tells you how the ecosystem is actually
consumed. A large remote-only share means most servers are hosted endpoints (agent
integrations, auth, network reliability) rather than local stdio tools.

## Package ecosystems (of servers that ship a package)

| registry | count | share of all |
|---|---|---|
${top(c.packageEcosystems)}

## Transport declarations

Package transports:

| transport | count | share |
|---|---|---|
${top(c.packageTransports)}

Remote transports:

| transport | count | share |
|---|---|---|
${top(c.remoteTransports)}

## Schema-version drift

Registry entries pin a \`$schema\` revision; the spread is a clean, code-free drift
signal across the population.

| schema revision | count | share |
|---|---|---|
${top(c.schemaVersionDrift)}

## Sampling frame for the dynamic tier

**${c.launchableNpmStdio}** servers (${c.launchableNpmStdioPct}% of the population) are
npm-published stdio servers — i.e. launchable by \`npx\` for the dynamic conformance
probe. \`candidates-registry.json\` holds these ${candidateCount} candidates; the probe
decides inclusion empirically (credential needs verified at run time, per STUDY.md).

## Honest limitations

- The registry is one (authoritative) view of the ecosystem; servers never
  published to it are out of frame. The GitHub topic count above is reported as
  context for how much larger the informal universe is.
- Census metrics are self-declared registry metadata; the dynamic tier is what
  validates behavior (schema validity, annotations, latency).
- A snapshot moves over time; every number here is tagged to the snapshot date and
  the sweep is re-runnable to produce a longitudinal series.

## Reproduce

\`\`\`bash
node benchmark/harvest.mjs      # writes corpus.json, results/census.json, this file
\`\`\`
`;
  writeFileSync(OUT_CENSUS_MD, md);
}

main().catch((e) => {
  console.error('[harvest] failed:', e.message);
  process.exit(1);
});
