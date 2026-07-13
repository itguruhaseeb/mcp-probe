#!/usr/bin/env node
// A minimal, valid stdio MCP server used to exercise mcp-doctor end to end.
// It speaks newline-delimited JSON-RPC 2.0 and exposes two trivial tools:
//   echo(text) -> returns the same text
//   add(a, b)  -> returns a + b
//   ping()     -> returns "pong" (no required params, safe to round-trip)
//
// This is intentionally hand-rolled (no SDK) to keep the example dependency
// free and self-contained.

const PROTOCOL_VERSION = '2025-06-18';

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
    name: 'add',
    title: 'Add',
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First addend.' },
        b: { type: 'number', description: 'Second addend.' },
      },
      required: ['a', 'b'],
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

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function handle(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) require no response.
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-server', version: '1.0.0' },
      });
      break;

    case 'tools/list':
      reply(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name === 'echo') {
        reply(id, textResult(String(args.text ?? '')));
      } else if (name === 'add') {
        reply(id, textResult(String(Number(args.a) + Number(args.b))));
      } else if (name === 'ping') {
        reply(id, textResult('pong'));
      } else {
        replyError(id, -32602, `unknown tool: ${name}`);
      }
      break;
    }

    default:
      replyError(id, -32601, `method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // Ignore malformed input on the example server.
    }
  }
});
process.stdin.on('end', () => process.exit(0));
