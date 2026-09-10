// SARIF output tests.
//
// Two things are being defended here. First, that the log validates against the
// shape GitHub code scanning actually requires: every result carries a ruleId
// that resolves in the driver's rules array, a level, a message and a location.
// Second, that the rules array is derived from RULES rather than duplicated, so
// adding a linter rule cannot silently produce SARIF that omits it.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toSarif, resolveArtifact, SARIF_VERSION } from '../src/sarif.js';
import { RULES, RULE_IDS } from '../src/linter.js';
import { VERSION } from '../src/version.js';

const cli = fileURLToPath(new URL('../bin/mcp-probe.js', import.meta.url));
const echoServer = fileURLToPath(new URL('../examples/echo-server.js', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
}

/** A minimal runDiagnostics-shaped result with one failing and one warning finding. */
function sampleResult() {
  return {
    tool: 'mcp-probe',
    version: VERSION,
    target: 'node ./server.js',
    clientProtocolVersion: '2025-06-18',
    negotiatedProtocolVersion: '2025-06-18',
    ok: false,
    tools: [
      {
        name: 'write_file',
        issues: [
          {
            id: 'schema/required-not-in-properties',
            severity: 'fail',
            message: 'inputSchema.required references "ghost" which is not in properties',
          },
          {
            id: 'tool/no-safety-hints',
            severity: 'warn',
            message: 'tool declares no safety hints',
          },
        ],
        fails: 1,
        warns: 1,
      },
    ],
    warnings: ['server negotiated protocol 2024-11-05'],
    errors: [],
  };
}

test('the log declares SARIF 2.1.0 and a single run', () => {
  const log = toSarif(sampleResult(), { artifactUri: 'server.js' });

  assert.equal(log.version, SARIF_VERSION);
  assert.equal(log.version, '2.1.0');
  assert.ok(log.$schema.includes('sarif'));
  assert.equal(log.runs.length, 1);
  assert.equal(log.runs[0].tool.driver.name, 'mcp-probe');
  assert.equal(log.runs[0].tool.driver.version, VERSION);
});

test('every registered rule appears in the driver, none invented', () => {
  const log = toSarif(sampleResult(), { artifactUri: 'server.js' });
  const emitted = log.runs[0].tool.driver.rules.map((r) => r.id);

  assert.deepEqual(emitted, RULE_IDS);
  assert.equal(emitted.length, Object.keys(RULES).length);
});

test('driver rules carry a description and a default level drawn from the registry', () => {
  const log = toSarif(sampleResult(), { artifactUri: 'server.js' });

  for (const rule of log.runs[0].tool.driver.rules) {
    assert.equal(rule.shortDescription.text, RULES[rule.id].summary);
    const expected = RULES[rule.id].severity === 'fail' ? 'error' : 'warning';
    assert.equal(rule.defaultConfiguration.level, expected);
    assert.ok(rule.helpUri);
  }
});

test('a finding becomes a result whose ruleIndex resolves to its own rule', () => {
  const log = toSarif(sampleResult(), { artifactUri: 'server.js' });
  const { results, tool } = log.runs[0];

  assert.equal(results.length, 2);
  for (const found of results) {
    assert.ok(found.ruleId, 'result has no ruleId');
    assert.equal(tool.driver.rules[found.ruleIndex].id, found.ruleId);
  }
});

test('severity maps to a SARIF level', () => {
  const { results } = toSarif(sampleResult(), { artifactUri: 'server.js' }).runs[0];

  assert.equal(results.find((r) => r.ruleId === 'schema/required-not-in-properties').level, 'error');
  assert.equal(results.find((r) => r.ruleId === 'tool/no-safety-hints').level, 'warning');
});

test('every result has the message and location GitHub requires', () => {
  const { results } = toSarif(sampleResult(), { artifactUri: 'server.js' }).runs[0];

  for (const found of results) {
    assert.ok(found.message.text.length > 0);
    assert.equal(found.locations[0].physicalLocation.artifactLocation.uri, 'server.js');
    assert.equal(found.locations[0].logicalLocations[0].name, 'write_file');
  }
});

test('the message names the tool the finding is about', () => {
  const { results } = toSarif(sampleResult(), { artifactUri: 'server.js' }).runs[0];

  for (const found of results) {
    assert.match(found.message.text, /^write_file: /);
  }
});

test('fingerprints are stable across runs and distinct per tool and rule', () => {
  const a = toSarif(sampleResult(), { artifactUri: 'server.js' }).runs[0].results;
  const b = toSarif(sampleResult(), { artifactUri: 'server.js' }).runs[0].results;

  assert.equal(a[0].partialFingerprints.mcpProbeToolRule, b[0].partialFingerprints.mcpProbeToolRule);
  assert.notEqual(
    a[0].partialFingerprints.mcpProbeToolRule,
    a[1].partialFingerprints.mcpProbeToolRule
  );
});

test('run-level errors and warnings become notifications, not results', () => {
  const result = sampleResult();
  result.errors = ['handshake failed: timed out'];
  const run = toSarif(result, { artifactUri: 'server.js' }).runs[0];

  const notifications = run.invocations[0].toolExecutionNotifications;
  assert.ok(notifications.some((n) => n.level === 'error' && /handshake failed/.test(n.message.text)));
  assert.ok(notifications.some((n) => n.level === 'warning'));
  // None of them leaked into results, which are reserved for rule hits.
  assert.ok(run.results.every((r) => !/handshake/.test(r.message.text)));
});

test('executionSuccessful tracks the probe verdict', () => {
  const bad = sampleResult();
  assert.equal(toSarif(bad, { artifactUri: 'x' }).runs[0].invocations[0].executionSuccessful, false);

  const good = sampleResult();
  good.ok = true;
  assert.equal(toSarif(good, { artifactUri: 'x' }).runs[0].invocations[0].executionSuccessful, true);
});

test('a clean server produces a valid log with no results', () => {
  const clean = { version: VERSION, target: 'node ./server.js', ok: true, tools: [], warnings: [], errors: [] };
  const run = toSarif(clean, { artifactUri: 'server.js' }).runs[0];

  assert.deepEqual(run.results, []);
  assert.equal(run.tool.driver.rules.length, RULE_IDS.length);
});

test('the artifact resolves to a real launch file when there is one', () => {
  const resolved = resolveArtifact({ command: 'node', args: [echoServer] });

  assert.equal(resolved.synthetic, false);
  assert.match(resolved.uri, /examples\/echo-server\.js$/);
  assert.ok(!resolved.uri.includes('\\'));
});

test('a program name is not mistaken for a file', () => {
  const resolved = resolveArtifact({ command: 'node', args: ['-e', ''] });

  assert.equal(resolved.synthetic, true);
  assert.match(resolved.uri, /^mcp-probe:\/\//);
});

// Regression. An absolute interpreter path is a real file, so a naive
// exists-on-disk check attributed every finding to the node binary on the
// runner. The server is the argument, not the interpreter, and a path outside
// the checkout cannot anchor an alert anyway.
test('the interpreter is never mistaken for the server', () => {
  const resolved = resolveArtifact({ command: process.execPath, args: [echoServer] });

  assert.equal(resolved.synthetic, false);
  assert.match(resolved.uri, /examples\/echo-server\.js$/);
  assert.ok(!resolved.uri.includes(process.execPath));
});

test('a file outside the working directory is not attributed to', () => {
  const resolved = resolveArtifact({ command: process.execPath, args: ['-e', ''] });

  assert.equal(resolved.synthetic, true, `picked up ${resolved.uri}`);
});

test('an in-tree absolute path becomes checkout-relative', () => {
  const resolved = resolveArtifact({ command: 'node', args: [echoServer] });

  assert.ok(!resolved.uri.startsWith('/'), `${resolved.uri} should be relative`);
  assert.equal(resolved.uri, 'examples/echo-server.js');
});

test('an explicit override wins over detection', () => {
  const resolved = resolveArtifact({ command: 'node', args: [echoServer], override: 'src/server.ts' });

  assert.equal(resolved.uri, 'src/server.ts');
  assert.equal(resolved.synthetic, false);
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

test('--sarif prints a parseable SARIF log for a real server', () => {
  const run = runCli(['--sarif', '--', process.execPath, echoServer]);

  assert.equal(run.status, 0, run.stderr);
  const log = JSON.parse(run.stdout);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.runs[0].tool.driver.rules.length, RULE_IDS.length);
  for (const found of log.runs[0].results) {
    assert.ok(RULES[found.ruleId], `CLI emitted an unregistered ruleId "${found.ruleId}"`);
  }
});

test('--sarif keeps the exit code contract', () => {
  const run = runCli(['--sarif', '--timeout', '100', '--', process.execPath, '-e', '']);

  assert.equal(run.status, 1);
  const log = JSON.parse(run.stdout);
  assert.equal(log.runs[0].invocations[0].executionSuccessful, false);
});

test('--json and --sarif together is a usage error', () => {
  const run = runCli(['--json', '--sarif', '--', process.execPath, echoServer]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /pick one/);
});

test('--sarif-artifact without --sarif is a usage error', () => {
  const run = runCli(['--sarif-artifact', 'x.js', '--', process.execPath, echoServer]);

  assert.equal(run.status, 2);
  assert.match(run.stderr, /no effect without --sarif/);
});

test('--sarif-artifact sets the uri findings are attributed to', () => {
  const run = runCli(['--sarif', '--sarif-artifact', 'servers/echo.js', '--', process.execPath, echoServer]);

  assert.equal(run.status, 0, run.stderr);
  const log = JSON.parse(run.stdout);
  assert.equal(log.runs[0].artifacts[0].location.uri, 'servers/echo.js');
  for (const found of log.runs[0].results) {
    assert.equal(found.locations[0].physicalLocation.artifactLocation.uri, 'servers/echo.js');
  }
});

test('--help documents the sarif flags', () => {
  const run = runCli(['--help']);

  assert.match(run.stdout, /--sarif\b/);
  assert.match(run.stdout, /--sarif-artifact/);
});
