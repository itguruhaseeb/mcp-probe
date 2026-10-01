#!/usr/bin/env node
// A stdio MCP server whose tools/list response is far larger than the 64 KiB
// Linux pipe buffer. Lives in examples/ because node --test runs every file under test/. Used by test/cli.test.js to pin the stdout flush fix:
// before it, `mcp-probe --json | <reader>` returned truncated JSON for a
// server like this one. Hand-rolled like examples/echo-server.js.
const PROTOCOL_VERSION = '2025-06-18';
const N = Number(process.env.LARGE_CATALOG_TOOLS || 600);
const TOOLS = Array.from({ length: N }, (_, i) => ({
  name: `tool_${i}`,
  description: `Tool number ${i}. ${'Padding to make the catalog large. '.repeat(6)}`,
  inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'A query.' } }, required: ['q'] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function handle(msg) {
  const { id, method } = msg;
  if (id === undefined || id === null) return;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'large-catalog', version: '1.0.0' } } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
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
    try { handle(JSON.parse(line)); } catch {}
  }
});
process.stdin.on('end', () => process.exit(0));
