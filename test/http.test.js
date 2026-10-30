// Covers the streamable HTTP transport (--url): both legal reply shapes, the
// session handshake, the headers the specification requires, and the failure
// paths that a stdio-only client never has to think about.
//
// Every end-to-end case drives the real CLI as a child process against a real
// HTTP server. The servers run inside this test process, which is why the CLI
// is spawned asynchronously: spawnSync would block this event loop and the
// server would never answer.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FAILURE_REASONS } from '../src/client.js';
import { HTTP_ACCEPT, parseEndpoint } from '../src/http-client.js';
import { resolveArtifact } from '../src/sarif.js';

const cli = fileURLToPath(new URL('../bin/mcp-probe.js', import.meta.url));
const exampleServer = fileURLToPath(new URL('../examples/http-echo-server.js', import.meta.url));

const PROTOCOL_VERSION = '2025-06-18';

function runCli(args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { encoding: 'utf8' });
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

/**
 * Start an HTTP server on an ephemeral port. Returns its /mcp URL.
 *
 * Only POST reaches `handler`. The probe also sends a DELETE to release a
 * session it was given, and that request carries no body, so handing it to a
 * handler that parses one would fail inside the server rather than in the
 * test. Pass `onOther` to observe those requests.
 */
async function serve(handler, onOther) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      req.resume();
      onOther?.(req);
      res.writeHead(204).end();
      return;
    }
    handler(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    async close() {
      server.closeAllConnections?.();
      server.close();
      await once(server, 'close').catch(() => {});
    },
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

function initializeResult() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'test-server', version: '9.9.9' },
  };
}

const ONE_TOOL = [
  {
    name: 'ping',
    description: 'Returns pong.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** The reply for a request, or null when the message is a notification. */
function replyFor(msg) {
  if (msg.id === undefined || msg.id === null) return null;
  if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: initializeResult() };
  if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: ONE_TOOL } };
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } };
}

function sendSse(res, obj, headers = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
  res.write(`event: message\ndata: ${JSON.stringify(obj)}\n\n`);
}

/** Start the shipped example server and return the URL it prints. */
async function startExample(args) {
  const child = spawn(process.execPath, [exampleServer, '--port', '0', ...args]);
  child.stdout.setEncoding('utf8');
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`example server did not start: ${out}`)), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/listening on (\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('error', reject);
  });
  return {
    url,
    close() {
      child.kill('SIGKILL');
    },
  };
}

// ---------------------------------------------------------------------------
// The two legal reply shapes
// ---------------------------------------------------------------------------

test('a server answering with an event stream is probed like any other', async () => {
  const example = await startExample(['--mode', 'sse']);
  try {
    const run = await runCli(['--json', '--url', example.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.transport, 'http');
    assert.equal(report.target, example.url);
    assert.equal(report.server.name, 'http-echo-server');
    assert.deepEqual(
      report.tools.map((t) => t.name),
      ['echo', 'ping']
    );
    assert.deepEqual(report.http.responseModes, ['sse', 'accepted']);
    assert.equal(report.http.session, 'issued');
    assert.equal(report.failureReason, null);
  } finally {
    example.close();
  }
});

test('a server answering with a single JSON document is probed the same way', async () => {
  const example = await startExample(['--mode', 'json']);
  try {
    const run = await runCli(['--json', '--url', example.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.http.responseModes, ['json', 'accepted']);
    assert.deepEqual(
      report.tools.map((t) => t.name),
      ['echo', 'ping']
    );
  } finally {
    example.close();
  }
});

test('an open event stream does not hold the probe open after it has answered', async () => {
  // The server answers and then keeps the response open, which is legal. A
  // client that waits for the body to end instead of for its own message hangs
  // here, so this asserts the run finishes well inside the timeout.
  const held = [];
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    const reply = replyFor(msg);
    if (!reply) return res.writeHead(202).end();
    sendSse(res, reply);
    held.push(res); // deliberately never ended
  });
  try {
    const started = Date.now();
    const run = await runCli(['--json', '--timeout', '3000', '--url', srv.url]);
    const elapsed = Date.now() - started;
    assert.equal(run.status, 0, run.stderr);
    assert.ok(elapsed < 10000, `expected a prompt exit, took ${elapsed}ms`);
  } finally {
    for (const res of held) res.end();
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// Session and headers
// ---------------------------------------------------------------------------

test('the session id the server issues is echoed on every later request', async () => {
  const sessionId = 'session-under-test';
  const seen = [];
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    seen.push({ method: msg.method, session: req.headers['mcp-session-id'] || null });
    const isInit = msg.method === 'initialize';
    // A stateful server rejects anything after initialize that arrives
    // without the session it issued. The run only stays healthy if the
    // client carried it back.
    if (!isInit && req.headers['mcp-session-id'] !== sessionId) {
      return res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'no session' } })
      );
    }
    const reply = replyFor(msg);
    const headers = isInit ? { 'mcp-session-id': sessionId } : {};
    if (!reply) return res.writeHead(202, headers).end();
    res.writeHead(200, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(reply));
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.http.session, 'issued');
    assert.equal(seen[0].method, 'initialize');
    assert.equal(seen[0].session, null, 'initialize cannot carry a session that does not exist yet');
    assert.ok(seen.length > 1, 'expected requests after initialize');
    for (const call of seen.slice(1)) {
      assert.equal(call.session, sessionId, `${call.method} did not carry the session id`);
    }
  } finally {
    await srv.close();
  }
});

test('the session is released with a DELETE when the probe is done with it', async () => {
  const sessionId = 'session-to-release';
  const other = [];
  const srv = await serve(
    async (req, res) => {
      const msg = JSON.parse(await readBody(req));
      const reply = replyFor(msg);
      const headers = msg.method === 'initialize' ? { 'mcp-session-id': sessionId } : {};
      if (!reply) return res.writeHead(202, headers).end();
      res.writeHead(200, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(reply));
    },
    (req) => other.push({ method: req.method, session: req.headers['mcp-session-id'] || null })
  );
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 0, run.stderr);
    // Leaving a session open on every probe is how a server ends up holding
    // state for runs that finished hours ago.
    assert.deepEqual(other, [{ method: 'DELETE', session: sessionId }]);
  } finally {
    await srv.close();
  }
});

test('a stateless server is reported as issuing no session', async () => {
  const example = await startExample(['--mode', 'json', '--stateless']);
  try {
    const run = await runCli(['--json', '--url', example.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.http.session, 'none');
  } finally {
    example.close();
  }
});

test('requests offer both content types and state the negotiated protocol version', async () => {
  const seen = [];
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    seen.push({
      method: msg.method,
      accept: req.headers.accept,
      contentType: req.headers['content-type'],
      protocolVersion: req.headers['mcp-protocol-version'] || null,
      userAgent: req.headers['user-agent'],
    });
    const reply = replyFor(msg);
    if (!reply) return res.writeHead(202).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 0, run.stderr);

    for (const call of seen) {
      // A server may answer with either shape, so a client that asks for only
      // one of them is not conformant.
      assert.equal(call.accept, HTTP_ACCEPT, `${call.method} sent Accept: ${call.accept}`);
      assert.match(call.contentType, /^application\/json/);
      assert.match(call.userAgent, /^mcp-probe\//);
    }
    const init = seen.find((c) => c.method === 'initialize');
    assert.equal(init.protocolVersion, null, 'nothing is negotiated before initialize answers');
    for (const call of seen.filter((c) => c.method !== 'initialize')) {
      assert.equal(call.protocolVersion, PROTOCOL_VERSION, `${call.method} omitted the version header`);
    }
  } finally {
    await srv.close();
  }
});

test('the initialized notification is sent and 202 is accepted, not treated as a failure', async () => {
  const methods = [];
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    methods.push(msg.method);
    const reply = replyFor(msg);
    if (!reply) return res.writeHead(202).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.ok(
      methods.includes('notifications/initialized'),
      `expected the readiness notification, saw ${methods.join(', ')}`
    );
    assert.ok(report.http.responseModes.includes('accepted'));
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test('an HTTP error status is a transport failure that quotes the status', async () => {
  const srv = await serve((req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('upstream exploded');
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.failureReason, FAILURE_REASONS.TRANSPORT);
    assert.match(report.errors[0], /HTTP 500/);
    assert.match(report.errors[0], /upstream exploded/);
  } finally {
    await srv.close();
  }
});

test('a content type that is neither JSON nor an event stream is named as the problem', async () => {
  const srv = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html>sign in to continue</html>');
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.failureReason, FAILURE_REASONS.TRANSPORT);
    assert.match(report.errors[0], /content-type "text\/html"/);
  } finally {
    await srv.close();
  }
});

test('an empty body in answer to a request is a transport failure, not a hang', async () => {
  const srv = await serve((req, res) => {
    res.writeHead(202).end();
  });
  try {
    const run = await runCli(['--json', '--timeout', '3000', '--url', srv.url]);
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.failureReason, FAILURE_REASONS.TRANSPORT);
    assert.match(report.errors[0], /HTTP 202 and no message body/);
  } finally {
    await srv.close();
  }
});

test('a server that accepts the connection and never answers is a timeout', async () => {
  const held = [];
  const srv = await serve((req, res) => {
    held.push(res);
  });
  try {
    const run = await runCli(['--json', '--timeout', '600', '--url', srv.url]);
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.failureReason, FAILURE_REASONS.TIMEOUT);
    assert.equal(report.timeoutMs, 600);
    assert.match(report.errors[0], /timed out after 600ms waiting for "initialize"/);
  } finally {
    for (const res of held) res.destroy();
    await srv.close();
  }
});

test('nothing listening on the endpoint is a transport failure naming the origin', async () => {
  // Take a port, learn its number, then give it back, so the address is almost
  // certainly free and nothing is listening on it.
  const srv = await serve(() => {});
  const url = srv.url;
  await srv.close();

  const run = await runCli(['--json', '--timeout', '3000', '--url', url]);
  assert.equal(run.status, 1);
  const report = JSON.parse(run.stdout);
  assert.equal(report.failureReason, FAILURE_REASONS.TRANSPORT);
  assert.match(report.errors[0], /handshake failed: http:\/\/127\.0\.0\.1:\d+/);
});

test('a JSON-RPC error on initialize is a protocol failure, not a transport one', async () => {
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32602, message: 'unsupported protocol version' },
      })
    );
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.failureReason, FAILURE_REASONS.PROTOCOL);
    assert.match(report.errors[0], /unsupported protocol version/);
  } finally {
    await srv.close();
  }
});

test('an event-stream frame that is not JSON is reported as broken SSE framing', async () => {
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    const reply = replyFor(msg);
    if (!reply) return res.writeHead(202).end();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // Noise first, then the real message. The noise must not be mistaken for
    // the answer, and it must not be silently dropped either.
    res.write('data: not json at all\n\n');
    res.write(`data: ${JSON.stringify(reply)}\n\n`);
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.ok(
      report.warnings.some((w) => /event-stream frame\(s\) that are not JSON/.test(w)),
      `expected an SSE framing warning, got ${JSON.stringify(report.warnings)}`
    );
  } finally {
    await srv.close();
  }
});

test('a multi-line data frame is reassembled before it is parsed', async () => {
  const srv = await serve(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    const reply = replyFor(msg);
    if (!reply) return res.writeHead(202).end();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // SSE allows a message to be split across several data lines, which are
    // joined with newlines. Treating each line as a message breaks here.
    const [first, ...rest] = JSON.stringify(reply, null, 1).split('\n');
    res.write(`data: ${first}\n`);
    for (const line of rest) res.write(`data: ${line}\n`);
    res.write('\n');
  });
  try {
    const run = await runCli(['--json', '--url', srv.url]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.server.name, 'test-server');
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// Usage and SARIF
// ---------------------------------------------------------------------------

test('--url rejects a non-HTTP endpoint with the usage exit code', async () => {
  for (const bad of ['not a url', 'ftp://example.com/mcp', 'file:///tmp/mcp']) {
    const run = await runCli(['--url', bad]);
    assert.equal(run.status, 2, `--url ${bad} should be a usage error`);
    assert.match(run.stderr, /--url:/);
  }
});

test('--url expects a value', async () => {
  const run = await runCli(['--url']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--url expects an endpoint/);
});

test('a command and --url together is a usage error rather than a silent choice', async () => {
  const run = await runCli(['--url', 'http://127.0.0.1:1/mcp', '--', process.execPath, '-e', '']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /two targets/);
});

test('--help documents the HTTP transport', async () => {
  const run = await runCli(['--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--url <endpoint>/);
  assert.match(run.stdout, /streamable HTTP/);
});

test('a remote target attributes SARIF findings to a synthetic URI, never to a local file', () => {
  const url = 'https://example.com/mcp';
  const artifact = resolveArtifact({ url });
  assert.equal(artifact.synthetic, true);
  assert.equal(artifact.uri, `mcp-probe://${url}`);

  // An override still wins, so a caller can anchor remote findings to the
  // config file that declares the server.
  const pinned = resolveArtifact({ url, override: 'mcp.json' });
  assert.equal(pinned.synthetic, false);
  assert.equal(pinned.uri, 'mcp.json');
});

test('--sarif over --url emits valid SARIF and says the artifact is synthetic', async () => {
  const example = await startExample(['--mode', 'json']);
  try {
    const run = await runCli(['--sarif', '--url', example.url]);
    assert.equal(run.status, 0, run.stderr);
    const log = JSON.parse(run.stdout);
    assert.equal(log.version, '2.1.0');
    const uri = log.runs[0].results?.[0]?.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
    if (uri !== undefined) {
      assert.match(uri, /^mcp-probe:\/\/http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    }
    assert.match(run.stderr, /a remote target has no file in the checkout/);
  } finally {
    example.close();
  }
});

test('parseEndpoint accepts http and https and rejects anything else', () => {
  assert.equal(parseEndpoint('http://example.com/mcp').protocol, 'http:');
  assert.equal(parseEndpoint('https://example.com/mcp').protocol, 'https:');
  assert.throws(() => parseEndpoint('ws://example.com/mcp'), /unsupported URL scheme/);
  assert.throws(() => parseEndpoint('example.com/mcp'), /not a valid URL/);
});
