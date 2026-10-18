// Covers script/probe-step.sh, which is the body of the GitHub Action's probe
// step. The action is the surface most adopters will meet first, and all of
// its decisions (which flags to assemble, what counts as a bad input versus a
// bad server, what the step outputs say) live in that shell. Running it here
// means CI exercises it on Node 18, 20 and 22 like everything else, instead of
// it being verified only when someone pushes a workflow and watches the run.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const step = join(root, 'script', 'probe-step.sh');
const cli = join(root, 'bin', 'mcp-probe.js');
const echoServer = join(root, 'examples', 'echo-server.js');
const unresponsiveServer = join(root, 'examples', 'unresponsive-server.js');

let bash = null;
try {
  bash = execFileSync('bash', ['--version'], { encoding: 'utf8' }).split('\n')[0];
} catch {
  bash = null;
}

/**
 * Run the probe step in a scratch working directory, with the GitHub-provided
 * files pointed at real paths, and return what a runner would have seen.
 */
function runStep(inputs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-probe-action-'));
  const outputFile = join(dir, '_outputs');
  const summaryFile = join(dir, '_summary');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');

  const result = spawnSync('bash', [step], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      MCP_PROBE_BIN: cli,
      MCP_PROBE_SERVER: inputs.server ?? '',
      MCP_PROBE_SARIF: inputs.sarif ?? 'true',
      MCP_PROBE_ARTIFACT: inputs.artifact ?? '',
      MCP_PROBE_TIMEOUT: inputs.timeout ?? '10000',
      MCP_PROBE_CALL: inputs.call ?? 'false',
      MCP_PROBE_OUTPUT: inputs.outputFile ?? '',
    },
  });

  const outputs = {};
  for (const line of readFileSync(outputFile, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    outputs,
    summary: readFileSync(summaryFile, 'utf8'),
    dir,
  };
}

const skip = bash ? false : 'bash is not available on this machine';

test('a healthy server produces an uploadable SARIF log and a zero exit code', { skip }, () => {
  const r = runStep({ server: `node ${echoServer}` });

  assert.equal(r.status, 0);
  assert.equal(r.outputs['exit-code'], '0');
  assert.equal(r.outputs.healthy, 'true');
  assert.equal(r.outputs['report-file'], 'mcp-probe.sarif');

  const log = JSON.parse(readFileSync(join(r.dir, 'mcp-probe.sarif'), 'utf8'));
  assert.equal(log.version, '2.1.0');
  assert.ok(log.runs[0].tool.driver.rules.length > 0, 'the rule registry should be in the log');
});

test('an unhealthy server is reported through the outputs, not by failing the step', { skip }, () => {
  // This is the whole ordering argument: the step has to survive long enough
  // for the SARIF upload that follows it to run. Failing here would end the
  // job and throw away the annotations that explain the failure.
  const r = runStep({ server: `node ${unresponsiveServer}`, timeout: '800' });

  assert.equal(r.status, 0, 'the step itself must not fail on an unhealthy server');
  assert.equal(r.outputs['exit-code'], '1');
  assert.equal(r.outputs.healthy, 'false');
});

test('JSON mode writes a report that names the cause', { skip }, () => {
  const r = runStep({ server: `node ${unresponsiveServer}`, sarif: 'false', timeout: '800' });

  assert.equal(r.outputs['report-file'], 'mcp-probe.json');
  const report = JSON.parse(readFileSync(join(r.dir, 'mcp-probe.json'), 'utf8'));
  assert.equal(report.failureReason, 'timeout');
  assert.equal(report.timeoutMs, 800);
});

test('an empty server input is a configuration error, not a server failure', { skip }, () => {
  const r = runStep({ server: '   ' });

  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /the 'server' input is required/);
  assert.equal(r.outputs['exit-code'], undefined);
});

test('a bad flag value is reported as a usage error rather than an unhealthy server', { skip }, () => {
  // The probe writes usage errors to stderr, so the report file is empty
  // here. The step has to recognise that as a bad input and not as a runner
  // problem, which is the ordering this test pins.
  const r = runStep({ server: `node ${echoServer}`, timeout: 'soon' });

  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /invoked incorrectly/);
  assert.doesNotMatch(r.stdout + r.stderr, /problem with the runner/);
  assert.equal(r.outputs.healthy, undefined);
});

test('an output path in a directory that does not exist yet is created', { skip }, () => {
  // Regression: the redirect used to fail before the probe ran, and the
  // shell's own exit code 1 was then reported as an unhealthy server.
  const r = runStep({ server: `node ${echoServer}`, sarif: 'false', outputFile: 'reports/nested/probe.json' });

  assert.equal(r.status, 0);
  assert.equal(r.outputs['exit-code'], '0');
  assert.equal(r.outputs.healthy, 'true');
  assert.equal(r.outputs['report-file'], 'reports/nested/probe.json');
  assert.ok(existsSync(join(r.dir, 'reports', 'nested', 'probe.json')));
});

test('a server command that does not exist is a server failure, not a usage error', { skip }, () => {
  const r = runStep({ server: 'definitely-not-a-real-binary', sarif: 'false', timeout: '800' });

  assert.equal(r.status, 0);
  assert.equal(r.outputs['exit-code'], '1');
  const report = JSON.parse(readFileSync(join(r.dir, 'mcp-probe.json'), 'utf8'));
  assert.equal(report.failureReason, 'spawn');
});

test('the artifact input is ignored in JSON mode, with a warning rather than silently', { skip }, () => {
  const r = runStep({ server: `node ${echoServer}`, sarif: 'false', artifact: 'src/client.js' });

  assert.equal(r.outputs['exit-code'], '0');
  assert.match(r.stdout + r.stderr, /only applies to SARIF output/);
});

test('the step summary records the target and the verdict', { skip }, () => {
  const r = runStep({ server: `node ${echoServer}` });

  assert.match(r.summary, /### mcp-probe/);
  assert.match(r.summary, /result: healthy/);
  assert.match(r.summary, /exit code: `0`/);
});

test('the action manifest runs the same script this suite tested', { skip }, () => {
  // A cheap guard against the two drifting: if the step body is ever inlined
  // back into action.yml, everything above stops covering the action.
  const manifest = readFileSync(join(root, 'action.yml'), 'utf8');
  assert.match(manifest, /script\/probe-step\.sh/);
});
