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
