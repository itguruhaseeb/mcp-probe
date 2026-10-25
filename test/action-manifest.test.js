// Covers the composite wiring in action.yml, which is the part of the GitHub
// Action that script/probe-step.sh cannot cover. The script is real code and
// test/action.test.js runs it. The manifest is assembly: which inputs reach
// the script, which outputs come back, and in what order the steps run. Those
// are only exercised for real on a runner, and until something runs there,
// these three invariants are the next best thing.
//
// They read action.yml as text rather than as parsed YAML on purpose. This
// package has no dependencies, and a hand-rolled YAML parser would be a worse
// thing to trust than a narrow regex.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = join(root, 'action.yml');
const scriptPath = join(root, 'script', 'probe-step.sh');

test('every input the step script reads is passed by the action manifest', () => {
  // An input added to the script and forgotten in the manifest arrives on a
  // runner as an empty string, so the script silently takes its default
  // instead of failing. That is the quietest kind of action bug.
  const script = readFileSync(scriptPath, 'utf8');
  const manifest = readFileSync(manifestPath, 'utf8');

  const read = new Set(script.match(/MCP_PROBE_[A-Z_]+/g) ?? []);
  // The manifest sets this one from github.action_path, not from an input.
  read.delete('MCP_PROBE_BIN');

  assert.ok(read.size > 0, 'expected the script to read some MCP_PROBE_ variables');
  for (const name of read) {
    assert.match(
      manifest,
      new RegExp(`^\\s+${name}:\\s*\\$\\{\\{\\s*inputs\\.`, 'm'),
      `action.yml does not pass ${name} from an input`,
    );
  }
});

test('the gate step comes after the SARIF upload step', () => {
  // Order is the whole design. Failing on the exit code before the upload
  // runs ends the job and throws away the annotations that explain the
  // failure, which leaves an adopter with a red check and no detail.
  const manifest = readFileSync(manifestPath, 'utf8');

  const upload = manifest.indexOf('codeql-action/upload-sarif');
  const gate = manifest.indexOf('Gate on the result');

  assert.ok(upload > 0, 'the manifest has no SARIF upload step');
  assert.ok(gate > 0, 'the manifest has no gate step');
  assert.ok(gate > upload, 'the gate step must come after the SARIF upload');
});

test('every declared output is wired to the step that writes it', () => {
  const script = readFileSync(scriptPath, 'utf8');
  const manifest = readFileSync(manifestPath, 'utf8');

  for (const name of ['exit-code', 'healthy', 'report-file']) {
    assert.match(
      manifest,
      new RegExp(`steps\\.probe\\.outputs\\.${name}`),
      `action.yml declares no value for the ${name} output`,
    );
    assert.match(
      script,
      new RegExp(`${name}=`),
      `probe-step.sh never writes ${name} to GITHUB_OUTPUT`,
    );
  }
});
