// Covers the --timeout contract: the default lives in one place, a hang is
// reported as a machine-readable reason rather than only as prose, and the
// reason distinguishes a hang from a crash.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TIMEOUT_MS, FAILURE_REASONS, failureReasonOf, McpError } from '../src/client.js';

const cli = fileURLToPath(new URL('../bin/mcp-probe.js', import.meta.url));
const unresponsive = fileURLToPath(new URL('../examples/unresponsive-server.js', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    // Comfortably above every --timeout used below, so a regression that
    // ignores the flag fails this suite instead of hanging CI.
    timeout: 15000,
  });
}

test('the documented default is the constant, not a second copy of the number', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`default ${DEFAULT_TIMEOUT_MS}\\b`));
});

test('a server that never answers times out with a structured reason', () => {
  const result = runCli(['--json', '--timeout', '400', '--', process.execPath, unresponsive]);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.failureReason, FAILURE_REASONS.TIMEOUT);
  // The limit itself is reported, so a consumer can tell a slow server from an
  // impatient probe without parsing the message.
  assert.equal(report.timeoutMs, 400);
  // The prose stays, but nothing should have to regex it.
  assert.match(report.errors[0], /handshake failed: timed out after 400ms waiting for "initialize"/);
});

test('the run gives up near the timeout rather than at the default', () => {
  const start = Date.now();
  const result = runCli(['--timeout', '400', '--', process.execPath, unresponsive]);
  const elapsed = Date.now() - start;

  assert.equal(result.status, 1);
  // Generous upper bound: this asserts the flag is honoured, not the latency.
  assert.ok(
    elapsed < DEFAULT_TIMEOUT_MS,
    `expected the run to end before the ${DEFAULT_TIMEOUT_MS}ms default, took ${elapsed}ms`
  );
});

test('a server that exits is a transport failure, not a timeout', () => {
  const result = runCli(['--json', '--timeout', '400', '--', process.execPath, '-e', '']);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.failureReason, FAILURE_REASONS.TRANSPORT);
});

test('a healthy run carries no failure reason', () => {
  const echo = fileURLToPath(new URL('../examples/echo-server.js', import.meta.url));
  const result = runCli(['--json', '--', process.execPath, echo]);

  const report = JSON.parse(result.stdout);
  assert.equal(report.failureReason, null);
  assert.equal(report.timeoutMs, DEFAULT_TIMEOUT_MS);
});

test('--timeout rejects a non-positive value with the usage exit code', () => {
  for (const bad of ['0', '-1', 'soon']) {
    const result = runCli(['--timeout', bad, '--', process.execPath, '-e', '']);
    assert.equal(result.status, 2, `--timeout ${bad} should be a usage error`);
    assert.match(result.stderr, /--timeout expects a positive number/);
  }
});

test('an unclassified error is reported as unknown rather than guessed at', () => {
  assert.equal(failureReasonOf(new Error('plain')), FAILURE_REASONS.UNKNOWN);
  assert.equal(failureReasonOf(new McpError('no reason given')), FAILURE_REASONS.UNKNOWN);
  assert.equal(
    failureReasonOf(new McpError('hung', { reason: FAILURE_REASONS.TIMEOUT })),
    FAILURE_REASONS.TIMEOUT
  );
});
