// Minimal MCP (Model Context Protocol) client that speaks JSON-RPC 2.0 to a
// stdio server over a child process's stdin/stdout.
//
// MCP stdio transport frames messages as newline-delimited JSON: each JSON-RPC
// message is a single line terminated by '\n', with no embedded newlines. We
// implement exactly that here rather than pulling in @modelcontextprotocol/sdk,
// which keeps mcp-doctor dependency-light and demonstrates the wire protocol.
// (Swapping in the official SDK's StdioClientTransport is a reasonable future
// option once we want richer transport support such as HTTP/SSE.)

import { spawn } from 'node:child_process';

// The protocol version mcp-doctor advertises during initialize. Servers may
// negotiate a different one back; we surface whatever they return.
export const PROTOCOL_VERSION = '2025-06-18';

export class McpError extends Error {
  constructor(message, { code, data } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

export class McpClient {
  /**
   * @param {string} command  executable to launch (e.g. "node", "python")
   * @param {string[]} args   arguments for that executable
   * @param {object} opts
   * @param {number} opts.timeout  per-request timeout in ms
   */
  constructor(command, args = [], { timeout = 10000 } = {}) {
    this.command = command;
    this.args = args;
    this.timeout = timeout;

    this.child = null;
    this._nextId = 1;
    this._pending = new Map(); // id -> { resolve, reject, timer }
    this._buffer = '';
    this._stderr = '';
    this._closed = false;
    this._closeReason = null;
  }

  start() {
    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this._onStdout(chunk));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      // Keep a bounded tail of stderr for diagnostics.
      this._stderr = (this._stderr + chunk).slice(-4000);
    });

    this.child.on('error', (err) => {
      this._fail(new McpError(`failed to launch "${this.command}": ${err.message}`));
    });

    this.child.on('exit', (code, signal) => {
      const reason =
        signal != null
          ? `server exited via signal ${signal}`
          : `server exited with code ${code}`;
      this._closeReason = reason;
      this._fail(new McpError(reason, { data: { stderr: this._stderr.trim() } }));
    });
  }

  _onStdout(chunk) {
    this._buffer += chunk;
    let idx;
    while ((idx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);
      if (line === '') continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // Non-JSON noise on stdout is a protocol violation for stdio MCP.
        // Record it but keep going; the linter surfaces it as a warning.
        this._nonJsonLines = (this._nonJsonLines || []);
        this._nonJsonLines.push(line);
        continue;
      }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    // We only issue requests, so we care about responses keyed by id.
    // Notifications/requests from the server are ignored for the MVP.
    if (msg.id === undefined || msg.id === null) return;
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(
        new McpError(msg.error.message || 'server returned an error', {
          code: msg.error.code,
          data: msg.error.data,
        })
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  _fail(err) {
    if (this._closed) return;
    this._closed = true;
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this._pending.clear();
  }

  _send(obj) {
    if (this._closed) throw new McpError(this._closeReason || 'connection closed');
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** Send a JSON-RPC request and await its result. */
  request(method, params) {
    const id = this._nextId++;
    const payload = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new McpError(`timed out after ${this.timeout}ms waiting for "${method}"`));
      }, this.timeout);
      this._pending.set(id, { resolve, reject, timer });
      try {
        this._send(payload);
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  notify(method, params) {
    const payload = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    this._send(payload);
  }

  /** Perform the MCP initialize handshake. Returns the server's result. */
  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-doctor', version: '0.1.0' },
    });
    // Per spec the client confirms readiness before making other calls.
    this.notify('notifications/initialized');
    return result;
  }

  get nonJsonLines() {
    return this._nonJsonLines || [];
  }

  async close() {
    this._closed = true;
    if (!this.child) return;
    for (const [, pending] of this._pending) clearTimeout(pending.timer);
    this._pending.clear();
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    // Give the child a moment to exit cleanly, then force it.
    await new Promise((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        return resolve();
      }
      const t = setTimeout(() => {
        try {
          this.child.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 500);
      this.child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
