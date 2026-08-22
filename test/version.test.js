import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VERSION } from '../src/version.js';

const cli = fileURLToPath(new URL('../bin/mcp-probe.js', import.meta.url));
const echoServer = fileURLToPath(new URL('../examples/echo-server.js', import.meta.url));
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);

test('VERSION matches package.json', () => {
  assert.equal(VERSION, pkg.version);
});

test('--version prints the package version', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('the JSON report carries the package version', () => {
  const result = spawnSync(process.execPath, [cli, '--json', '--', process.execPath, echoServer], {
    encoding: 'utf8',
    timeout: 15000,
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, pkg.version);
});
