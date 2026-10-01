import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const cli = fileURLToPath(new URL('../bin/mcp-probe.js', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('exits 0 when help is requested', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage/);
});

test('exits 1 when the target server fails the handshake', () => {
  const result = runCli(['--timeout', '100', '--', process.execPath, '-e', '']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /handshake failed/);
});

test('exits 2 when invoked without a server command', () => {
  const result = runCli([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no server command given/);
});

test('--json output survives a pipe when the catalog exceeds the 64 KiB pipe buffer', () => {
  const large = fileURLToPath(new URL('../examples/large-catalog-server.js', import.meta.url));
  // spawnSync reads stdout through a pipe, exactly like a CI step or a harness.
  const result = spawnSync(process.execPath, [cli, '--json', '--timeout', '5000', '--', process.execPath, large], {
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 64 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.length > 65536, `expected more than one pipe buffer of output, got ${result.stdout.length}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.tools.length, 600);
});
