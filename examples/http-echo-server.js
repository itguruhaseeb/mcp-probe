#!/usr/bin/env node
// A minimal, valid streamable HTTP MCP server, the remote counterpart to
// examples/echo-server.js. It exists so the --url path can be exercised by
// hand and in CI without reaching the public internet.
//
// Usage
//   node examples/http-echo-server.js                  # port 3000, SSE replies
//   node examples/http-echo-server.js --port 0         # any free port
//   node examples/http-echo-server.js --mode json      # single JSON replies
//   node examples/http-echo-server.js --stateless      # issue no session id
//
// It prints one line on stdout once it is listening:
//
//   mcp-probe-example listening on http://127.0.0.1:3000/mcp
//
// Then:
//   node bin/mcp-probe.js --url http://127.0.0.1:3000/mcp
//
// Both reply shapes the specification allows are implemented, because a client
// has to handle both: `--mode sse` answers with a one-event event stream and
// `--mode json` answers with a single JSON document. Tools and behaviour are
// otherwise identical to the stdio example.

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PROTOCOL_VERSION = '2025-06-18';
const PATH = '/mcp';

const TOOLS = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Return the provided text unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to echo back.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'ping',
    title: 'Ping',
    description: 'Health check that returns "pong". Takes no parameters.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

function parseArgs(argv) {
  const opts = { port: 3000, mode: 'sse', stateless: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      opts.port = Number(argv[++i]);
      if (!Number.isInteger(opts.port) || opts.port < 0) {
        fail(`--port expects a non-negative integer, got "${argv[i]}"`);
      }
    } else if (a === '--mode') {
      opts.mode = argv[++i];
      if (opts.mode !== 'sse' && opts.mode !== 'json') {
        fail(`--mode expects "sse" or "json", got "${opts.mode}"`);
      }
    } else if (a === '--stateless') {
      opts.stateless = true;
    } else {
      fail(`unknown option "${a}"`);
    }
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
const sessions = new Set();

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

/** The JSON-RPC answer to one request message, or null for a notification. */
function answer(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null;

  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'http-echo-server', version: '1.0.0' },
      });
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name === 'echo') return ok(textResult(String(args.text ?? '')));
      if (name === 'ping') return ok(textResult('pong'));
      return err(-32602, `unknown tool: ${name}`);
    }
    default:
      return err(-32601, `method not found: ${method}`);
  }
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function sendSse(res, obj, headers = {}) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...headers,
  });
  // A comment first, which a conformant client must skip, then the message.
  res.write(': mcp-probe example stream\n\n');
  res.write(`event: message\ndata: ${JSON.stringify(obj)}\n\n`);
  // The stream is left open on purpose. A client that waits for the end of the
  // body instead of for its own response would hang here, which is exactly the
  // bug this example is useful for catching.
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== PATH) {
    sendJson(res, 404, { error: `no MCP endpoint at ${url.pathname}, try ${PATH}` });
    return;
  }

  const sessionId = req.headers['mcp-session-id'];

  if (req.method === 'DELETE') {
    if (sessionId) sessions.delete(String(sessionId));
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET') {
    // Server-initiated streams are optional and this example has nothing to
    // push, so it declines rather than holding a connection open.
    res.writeHead(405, { allow: 'POST, DELETE' }).end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST, DELETE' }).end();
    return;
  }

  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'parse error' },
      });
      return;
    }

    const isInitialize = msg?.method === 'initialize';
    const headers = {};

    if (!opts.stateless) {
      if (isInitialize) {
        const issued = randomUUID();
        sessions.add(issued);
        headers['mcp-session-id'] = issued;
      } else if (!sessionId || !sessions.has(String(sessionId))) {
        // The specified way to say "you did not carry the session back".
        sendJson(res, 400, {
          jsonrpc: '2.0',
          id: msg?.id ?? null,
          error: { code: -32600, message: 'missing or unknown Mcp-Session-Id' },
        });
        return;
      }
    }

    const reply = answer(msg);
    if (reply === null) {
      // A notification gets no body.
      res.writeHead(202, headers).end();
      return;
    }

    if (opts.mode === 'json') {
      sendJson(res, 200, reply, headers);
    } else {
      sendSse(res, reply, headers);
    }
  });
});

server.listen(opts.port, '127.0.0.1', () => {
  const { port } = server.address();
  process.stdout.write(`mcp-probe-example listening on http://127.0.0.1:${port}${PATH}\n`);
});
