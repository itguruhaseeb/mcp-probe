// Covers authenticating to a remote endpoint: --header, --bearer and
// --bearer-env.
//
// Half of these tests are about the credential arriving and half are about it
// not coming back out. The second half is the point of the feature: a probe
// that prints its own token into a SARIF file an action uploads is worse than
// one that cannot authenticate at all, so a server that reflects the
// Authorization header is modelled here deliberately.
//
// The servers run inside this test process, so the CLI is spawned
// asynchronously; spawnSync would block this event loop and no server would
// ever answer.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FAILURE_REASONS } from '../src/client.js';
import { McpHttpClient, HTTP_ACCEPT, REDACTED } from '../src/http-client.js';

const cli = fileURLToPath(new URL('../bin/mcp-probe.js', import.meta.url));

const PROTOCOL_VERSION = '2025-06-18';
const TOKEN = 'sk-test-abcdef0123456789';

function runCli(args, { timeout = 20000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`mcp-probe did not exit within ${timeout}ms`));
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function initializeResult() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'guarded-server', version: '1.0.0' },
  };
}

const ONE_TOOL = [
  {
    name: 'ping',
    description: 'Returns pong.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function replyFor(msg) {
  if (msg.id === undefined || msg.id === null) return null;
  if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: initializeResult() };
  if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: ONE_TOOL } };
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

/**
 * A server that answers only when the request carries the expected
 * Authorization header, and otherwise returns 401.
 *
 * `echoCredential` makes the 401 body quote back whatever Authorization value
 * it was given, which is the behaviour the redaction has to survive. Every
 * request it sees, of any method, is recorded in `seen`.
 */
async function serveGuarded({ expected = `Bearer ${TOKEN}`, echoCredential = false } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    seen.push({ method: req.method, headers: { ...req.headers } });

    const supplied = req.headers.authorization;
    if (supplied !== expected) {
      req.resume();
      const body = echoCredential
        ? `unauthorized: rejected credential ${supplied || '(none)'}`
        : 'unauthorized';
      res.writeHead(401, { 'content-type': 'text/plain' }).end(body);
      return;
    }

    if (req.method !== 'POST') {
      req.resume();
      res.writeHead(204).end();
      return;
    }

    const msg = JSON.parse(await readBody(req));
    const reply = replyFor(msg);
    if (!reply) {
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
    res.end(JSON.stringify(reply));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seen,
    async close() {
      server.closeAllConnections?.();
      server.close();
      await once(server, 'close').catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// The credential arrives
// ---------------------------------------------------------------------------

test('--bearer gets a probe through a server that requires a token', async () => {
  const srv = await serveGuarded();
  try {
    const run = await runCli(['--json', '--url', srv.url, '--bearer', TOKEN]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.server.name, 'guarded-server');
    assert.deepEqual(
      report.tools.map((t) => t.name),
      ['ping']
    );
    assert.equal(report.http.auth, 'supplied');
    const posts = srv.seen.filter((r) => r.method === 'POST');
    assert.ok(posts.length >= 2, 'the handshake and tools/list should both have been sent');
    for (const r of posts) {
      assert.equal(r.headers.authorization, `Bearer ${TOKEN}`);
    }
  } finally {
    await srv.close();
  }
});

test('the same server without the token reports a transport failure quoting HTTP 401', async () => {
  const srv = await serveGuarded();
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.failureReason, FAILURE_REASONS.TRANSPORT);
    assert.match(report.errors.join('\n'), /HTTP 401/);
    // The run still says which transport it used and that it was unauthenticated,
    // so two reports of one endpoint can be told apart.
    assert.equal(report.http.auth, 'none');
  } finally {
    await srv.close();
  }
});

test('--header is repeatable and every header reaches the server', async () => {
  const srv = await serveGuarded({ expected: 'Token xyz' });
  try {
    const run = await runCli([
      '--json',
      '--url',
      srv.url,
      '--header',
      'Authorization: Token xyz',
      '--header',
      'X-Tenant: acme',
    ]);
    assert.equal(run.status, 0, run.stderr);
    const post = srv.seen.find((r) => r.method === 'POST');
    assert.equal(post.headers.authorization, 'Token xyz');
    assert.equal(post.headers['x-tenant'], 'acme');
  } finally {
    await srv.close();
  }
});

test('the credential is sent on the session DELETE too, not only on the posts', async () => {
  const srv = await serveGuarded();
  try {
    const run = await runCli(['--json', '--url', srv.url, '--bearer', TOKEN]);
    assert.equal(run.status, 0, run.stderr);
    // The DELETE is best effort and races the probe's exit, so wait for it.
    for (let i = 0; i < 100 && !srv.seen.some((r) => r.method === 'DELETE'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const del = srv.seen.find((r) => r.method === 'DELETE');
    assert.ok(del, 'the probe should release the session it was issued');
    assert.equal(del.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(del.headers['mcp-session-id'], 'sess-1');
  } finally {
    await srv.close();
  }
});

test('--bearer-env reads the token from the environment', async () => {
  const srv = await serveGuarded();
  try {
    const run = await runCli(['--json', '--url', srv.url, '--bearer-env', 'MCP_PROBE_TEST_TOKEN'], {
      env: { MCP_PROBE_TEST_TOKEN: TOKEN },
    });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.http.auth, 'supplied');
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// The credential does not come back out
// ---------------------------------------------------------------------------

test('a server echoing the credential into its error body does not get it reproduced', async () => {
  const srv = await serveGuarded({ expected: 'Bearer something-else', echoCredential: true });
  try {
    const run = await runCli(['--json', '--url', srv.url, '--bearer', TOKEN]);
    assert.equal(run.status, 1);
    // Nowhere in the report, nowhere on stderr, and that includes the quoted
    // body the HTTP 401 message carries.
    assert.ok(!run.stdout.includes(TOKEN), 'the token must not appear in the report');
    assert.ok(!run.stderr.includes(TOKEN), 'the token must not appear on stderr');
    const report = JSON.parse(run.stdout);
    assert.match(report.errors.join('\n'), /HTTP 401/);
    assert.match(report.errors.join('\n'), new RegExp(REDACTED.replace(/[[\]]/g, '\\$&')));
  } finally {
    await srv.close();
  }
});

test('the same holds for the SARIF an action uploads', async () => {
  const srv = await serveGuarded({ expected: 'Bearer something-else', echoCredential: true });
  try {
    const run = await runCli(['--sarif', '--url', srv.url, '--bearer', TOKEN]);
    assert.equal(run.status, 1);
    assert.ok(!run.stdout.includes(TOKEN), 'the token must not appear in the SARIF');
    const log = JSON.parse(run.stdout);
    const notifications = log.runs[0].invocations[0].toolExecutionNotifications || [];
    assert.ok(notifications.length > 0, 'a failed handshake is reported as a notification');
    assert.ok(!JSON.stringify(notifications).includes(TOKEN));
  } finally {
    await srv.close();
  }
});

test('redact masks every supplied value, longest first', () => {
  const client = new McpHttpClient('http://127.0.0.1:1/mcp', {
    headers: [
      { name: 'Authorization', value: 'Bearer abc123' },
      { name: 'X-Key', value: 'abc' },
    ],
  });
  // "abc" is a substring of "Bearer abc123". Masking the longer value first is
  // what keeps the longer one from being reported in pieces.
  assert.equal(client.redact('got Bearer abc123 back'), `got ${REDACTED} back`);
  assert.equal(client.redact('got abc back'), `got ${REDACTED} back`);
  assert.equal(client.redact('nothing secret here'), 'nothing secret here');
});

// ---------------------------------------------------------------------------
// The transport keeps its own headers
// ---------------------------------------------------------------------------

test('a caller cannot override a header the transport owns', () => {
  const client = new McpHttpClient('http://127.0.0.1:1/mcp', {
    headers: [
      { name: 'accept', value: 'application/json' },
      { name: 'Content-Type', value: 'text/plain' },
      { name: 'mcp-session-id', value: 'forged' },
      { name: 'mcp-protocol-version', value: '1999-01-01' },
      { name: 'Authorization', value: `Bearer ${TOKEN}` },
    ],
  });
  const headers = client._headers();
  assert.equal(headers.accept, HTTP_ACCEPT);
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['mcp-session-id'], undefined);
  assert.equal(headers['mcp-protocol-version'], undefined);
  // The one that is not transport-owned still arrives.
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  // And a transport-owned name never becomes a reason to redact: its value was
  // dropped, so masking it would corrupt unrelated text.
  assert.equal(client.redact('application/json stays'), 'application/json stays');
});

test('a run with no headers reports auth none and redacts nothing', () => {
  const client = new McpHttpClient('http://127.0.0.1:1/mcp');
  assert.equal(client.authenticated, false);
  assert.equal(client.redact('anything at all'), 'anything at all');
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

test('a malformed --header is a usage error naming what was wrong', async () => {
  const cases = [
    [['--header', 'Authorization'], /--header expects 'Name: value'/],
    [['--header', ': value'], /empty header name/],
    [['--header', 'X-Key:'], /empty value/],
    [['--header', 'Content-Type: text/plain'], /mcp-probe sets that header itself/],
  ];
  for (const [args, pattern] of cases) {
    const run = await runCli(['--url', 'http://127.0.0.1:1/mcp', ...args]);
    assert.equal(run.status, 2, `${args.join(' ')} should be a usage error`);
    assert.match(run.stderr, pattern);
  }
});

test('an unquoted --header argument is named as a quoting problem', async () => {
  const run = await runCli(['--url', 'http://127.0.0.1:1/mcp', '--header', 'Authorization: Bearer']);
  // This one is well formed: "Bearer" is the value. The quoting message is for
  // the case where the shell split the argument and a word arrived as a name.
  assert.equal(run.status, 1, run.stderr);

  const split = await runCli(['--url', 'http://127.0.0.1:1/mcp', '--header', 'Bearer token: x']);
  assert.equal(split.status, 2);
  assert.match(split.stderr, /quote the whole argument/);
});

test('the same header twice is a usage error rather than a silent last-wins', async () => {
  const run = await runCli([
    '--url',
    'http://127.0.0.1:1/mcp',
    '--header',
    'X-Key: one',
    '--header',
    'x-key: two',
  ]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /given more than once/);
});

test('two flags setting Authorization is a usage error', async () => {
  const both = await runCli([
    '--url',
    'http://127.0.0.1:1/mcp',
    '--bearer',
    TOKEN,
    '--bearer-env',
    'MCP_PROBE_TEST_TOKEN',
  ]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /pick one/);

  const withHeader = await runCli([
    '--url',
    'http://127.0.0.1:1/mcp',
    '--header',
    `Authorization: Bearer ${TOKEN}`,
    '--bearer',
    TOKEN,
  ]);
  assert.equal(withHeader.status, 2);
  assert.match(withHeader.stderr, /given more than once/);
});

test('--bearer-env names the variable, never its contents, when it is not set', async () => {
  const run = await runCli(['--url', 'http://127.0.0.1:1/mcp', '--bearer-env', 'MCP_PROBE_ABSENT']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /MCP_PROBE_ABSENT/);
  assert.match(run.stderr, /empty or not set/);

  const empty = await runCli(['--url', 'http://127.0.0.1:1/mcp', '--bearer-env', 'MCP_PROBE_EMPTY'], {
    env: { MCP_PROBE_EMPTY: '' },
  });
  assert.equal(empty.status, 2, 'an empty variable would send "Bearer " and read as a rejected token');
});

test('--bearer and --header expect a value', async () => {
  for (const flag of ['--bearer', '--bearer-env', '--header']) {
    const run = await runCli(['--url', 'http://127.0.0.1:1/mcp', flag]);
    assert.equal(run.status, 2, `${flag} alone should be a usage error`);
  }
});

test('credentials over stdio are a usage error, not a silent discard', async () => {
  const run = await runCli(['--bearer', TOKEN, '--', process.execPath, '-e', '']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /apply to --url/);
  assert.ok(!run.stderr.includes(TOKEN), 'the usage error must not echo the token');
});

test('--help documents the auth flags without inviting a token on the command line', async () => {
  const run = await runCli(['--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--header/);
  assert.match(run.stdout, /--bearer-env/);
  assert.match(run.stdout, /No header value is ever written to the report/);
});
