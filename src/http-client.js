// Minimal MCP client for the streamable HTTP transport.
//
// The stdio client in client.js owns a child process and a newline-delimited
// pipe. This one owns neither: every JSON-RPC message is the body of an HTTP
// POST to a single endpoint, and the response comes back either as one JSON
// document or as a Server-Sent Events stream carrying one or more messages.
// Both shapes are legal per the MCP specification, and a server picks per
// request, so a client that handles only one of them works against roughly
// half of the remote servers it meets.
//
// Three details of the transport are easy to get wrong and are each pinned by
// a test in test/http.test.js:
//
//   1. Accept must offer BOTH `application/json` and `text/event-stream`.
//      A server is entitled to refuse the request otherwise, and some do.
//   2. A session id handed back in the `Mcp-Session-Id` response header must be
//      echoed on every later request. Without it a stateful server answers the
//      handshake and then rejects tools/list, which looks like a server bug
//      rather than a client one.
//   3. A notification gets no response body. The server answers `202 Accepted`,
//      and treating that as a failed request turns a healthy server unhealthy.
//
// This is written against node:http and node:https rather than fetch on
// purpose. fetch is still flagged experimental on Node 18, which this package
// supports, and it prints a warning to stderr the first time it is used, which
// would land in the middle of a report that CI parses.

import http from 'node:http';
import https from 'node:https';

import {
  McpError,
  FAILURE_REASONS,
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
} from './client.js';
import { VERSION } from './version.js';

// Both content types, in the order the specification lists them. A server may
// answer with either, so a client that asks for only one is not conformant.
export const HTTP_ACCEPT = 'application/json, text/event-stream';

// How much of an error response body is quoted back in a message. An HTML error
// page from a proxy in front of the server is useful in the first line or two
// and useless after that.
const ERROR_BODY_LIMIT = 500;

/** Throws unless `value` is an absolute http or https URL. */
export function parseEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new McpError(`not a valid URL: "${value}"`, { reason: FAILURE_REASONS.TRANSPORT });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new McpError(
      `unsupported URL scheme "${url.protocol}" (expected http: or https:)`,
      { reason: FAILURE_REASONS.TRANSPORT }
    );
  }
  return url;
}

export class McpHttpClient {
  /**
   * @param {string} endpoint  the server's MCP endpoint, http or https
   * @param {object} opts
   * @param {number} opts.timeout  per-request timeout in ms
   */
  constructor(endpoint, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
    this.url = parseEndpoint(endpoint);
    this.timeout = timeout;
    this.transport = 'http';

    this._nextId = 1;
    this._closed = false;
    // Set from the Mcp-Session-Id response header, when the server issues one.
    this.sessionId = null;
    // Sent once the server has told us which protocol version it negotiated.
    this.negotiatedProtocolVersion = null;
    // Which response shapes this server actually used, in first-seen order.
    this._responseModes = [];
    this._nonJsonFrames = [];
  }

  /** Symmetry with the stdio client. There is no process to launch. */
  start() {}

  get responseModes() {
    return [...this._responseModes];
  }

  /**
   * SSE data frames that did not parse as JSON. The stdio client reports the
   * same class of problem for non-JSON lines on stdout.
   */
  get nonJsonLines() {
    return [...this._nonJsonFrames];
  }

  _headers(extra = {}) {
    const headers = {
      'content-type': 'application/json',
      accept: HTTP_ACCEPT,
      'user-agent': `mcp-probe/${VERSION}`,
      ...extra,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    // The specification asks the client to state the negotiated version on
    // every request after initialize, so a server can reject a mismatch.
    if (this.negotiatedProtocolVersion) {
      headers['mcp-protocol-version'] = this.negotiatedProtocolVersion;
    }
    return headers;
  }

  _noteMode(mode) {
    if (!this._responseModes.includes(mode)) this._responseModes.push(mode);
  }

  /**
   * POST one JSON-RPC message.
   *
   * When `wantId` is a number the call resolves with the JSON-RPC message
   * carrying that id. When it is null the call is a notification and resolves
   * once the server has accepted it.
   */
  _post(payload, wantId) {
    if (this._closed) {
      throw new McpError('connection closed', { reason: FAILURE_REASONS.TRANSPORT });
    }

    const body = JSON.stringify(payload);
    const agentModule = this.url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const timer = setTimeout(() => {
        const method = payload.method;
        req.destroy();
        finish(
          reject,
          new McpError(`timed out after ${this.timeout}ms waiting for "${method}"`, {
            reason: FAILURE_REASONS.TIMEOUT,
          })
        );
      }, this.timeout);

      const req = agentModule.request(
        this.url,
        {
          method: 'POST',
          headers: { ...this._headers(), 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          const status = res.statusCode || 0;
          const contentType = String(res.headers['content-type'] || '').toLowerCase();

          // A session id arrives on the initialize response and is required on
          // everything after it.
          const issued = res.headers['mcp-session-id'];
          if (issued && !this.sessionId) this.sessionId = String(issued);

          if (status >= 400) {
            readBounded(res, ERROR_BODY_LIMIT).then((text) => {
              finish(
                reject,
                new McpError(httpErrorMessage(status, res.statusMessage, text, this.sessionId), {
                  data: { status, body: text },
                  reason: FAILURE_REASONS.TRANSPORT,
                })
              );
            });
            return;
          }

          // 202 Accepted, or any empty success, is the correct answer to a
          // notification and a protocol violation in answer to a request.
          if (status === 202 || status === 204 || contentType === '') {
            res.resume();
            if (wantId === null) {
              this._noteMode('accepted');
              finish(resolve, undefined);
            } else {
              finish(
                reject,
                new McpError(
                  `server answered "${payload.method}" with HTTP ${status} and no message body`,
                  { reason: FAILURE_REASONS.TRANSPORT }
                )
              );
            }
            return;
          }

          if (contentType.startsWith('application/json')) {
            this._noteMode('json');
            readBounded(res, 0).then((text) => {
              let msg;
              try {
                msg = JSON.parse(text);
              } catch (err) {
                finish(
                  reject,
                  new McpError(`server sent unparseable JSON: ${err.message}`, {
                    reason: FAILURE_REASONS.TRANSPORT,
                  })
                );
                return;
              }
              // A server may answer a single request with a batch of one.
              const found = Array.isArray(msg)
                ? msg.find((m) => m && m.id === wantId)
                : msg;
              if (wantId === null) return finish(resolve, undefined);
              if (!found || found.id !== wantId) {
                finish(
                  reject,
                  new McpError(
                    `server answered "${payload.method}" without a response for request id ${wantId}`,
                    { reason: FAILURE_REASONS.TRANSPORT }
                  )
                );
                return;
              }
              settleJsonRpc(found, finish, resolve, reject);
            });
            return;
          }

          if (contentType.startsWith('text/event-stream')) {
            this._noteMode('sse');
            this._consumeSse(res, wantId, finish, resolve, reject, payload);
            return;
          }

          readBounded(res, ERROR_BODY_LIMIT).then((text) => {
            finish(
              reject,
              new McpError(
                `server answered with content-type "${contentType || 'none'}", which is neither ` +
                  `application/json nor text/event-stream` +
                  (text ? `: ${firstLine(text)}` : ''),
                { data: { status, body: text }, reason: FAILURE_REASONS.TRANSPORT }
              )
            );
          });
        }
      );

      req.on('error', (err) => {
        finish(
          reject,
          new McpError(`${this.url.origin}: ${err.message}`, {
            data: { code: err.code },
            reason: FAILURE_REASONS.TRANSPORT,
          })
        );
      });

      req.end(body);
    });
  }

  /**
   * Read an SSE body until the message we are waiting for arrives, then stop
   * reading. A server is allowed to keep the stream open after answering, so
   * waiting for it to end would hang on a conformant server.
   */
  _consumeSse(res, wantId, finish, resolve, reject, payload) {
    let buffer = '';
    let dataLines = [];

    const dispatch = () => {
      if (dataLines.length === 0) return false;
      const raw = dataLines.join('\n');
      dataLines = [];
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        this._nonJsonFrames.push(raw);
        return false;
      }
      const messages = Array.isArray(msg) ? msg : [msg];
      for (const m of messages) {
        if (!m || m.id !== wantId) continue; // a notification, or another request's answer
        settleJsonRpc(m, finish, resolve, reject);
        return true;
      }
      return false;
    };

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = stripCr(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (line === '') {
          if (dispatch()) {
            res.destroy();
            return;
          }
          continue;
        }
        // Comments keep a connection warm and carry no message.
        if (line.startsWith(':')) continue;
        const sep = line.indexOf(':');
        const field = sep === -1 ? line : line.slice(0, sep);
        const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^ /, '');
        if (field === 'data') dataLines.push(value);
        // `event`, `id` and `retry` carry nothing mcp-probe needs.
      }
    });

    res.on('end', () => {
      // A final event may not be followed by a blank line.
      if (dispatch()) return;
      finish(
        reject,
        new McpError(
          `server closed the event stream without answering "${payload.method}"`,
          { reason: FAILURE_REASONS.TRANSPORT }
        )
      );
    });

    res.on('error', (err) => {
      finish(
        reject,
        new McpError(`event stream failed: ${err.message}`, {
          reason: FAILURE_REASONS.TRANSPORT,
        })
      );
    });
  }

  /** Send a JSON-RPC request and await its result. */
  async request(method, params) {
    const id = this._nextId++;
    const payload = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;
    return this._post(payload, id);
  }

  /** Send a JSON-RPC notification. Resolves once the server accepts it. */
  async notify(method, params) {
    const payload = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    return this._post(payload, null);
  }

  /** Perform the MCP initialize handshake. Returns the server's result. */
  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-probe', version: VERSION },
    });
    // Only now do we know what to put in the protocol version header.
    if (result && typeof result.protocolVersion === 'string') {
      this.negotiatedProtocolVersion = result.protocolVersion;
    }
    // Per spec the client confirms readiness before making other calls. A
    // server that rejects the notification is still worth probing, so this
    // failure is not fatal; the handshake itself already succeeded.
    try {
      await this.notify('notifications/initialized');
    } catch {
      // Reported by the linter through the run's warnings, not here.
    }
    return result;
  }

  /**
   * Ask the server to drop the session, when it issued one. Best effort: a
   * server is not required to support DELETE, and a probe that fails at
   * cleanup has still produced its report.
   */
  async close() {
    if (this._closed) return;
    this._closed = true;
    if (!this.sessionId) return;

    const agentModule = this.url.protocol === 'https:' ? https : http;
    await new Promise((resolve) => {
      const req = agentModule.request(
        this.url,
        { method: 'DELETE', headers: { 'mcp-session-id': this.sessionId } },
        (res) => {
          res.resume();
          res.on('end', resolve);
          res.on('error', resolve);
        }
      );
      req.on('error', () => resolve());
      req.setTimeout(Math.min(this.timeout, 2000), () => {
        req.destroy();
        resolve();
      });
      req.end();
    });
  }
}

/** Resolve or reject from one JSON-RPC response message. */
function settleJsonRpc(msg, finish, resolve, reject) {
  if (msg.error) {
    finish(
      reject,
      new McpError(msg.error.message || 'server returned an error', {
        code: msg.error.code,
        data: msg.error.data,
        reason: FAILURE_REASONS.PROTOCOL,
      })
    );
    return;
  }
  finish(resolve, msg.result);
}

function httpErrorMessage(status, statusMessage, body, sessionId) {
  const head = `HTTP ${status}${statusMessage ? ' ' + statusMessage : ''}`;
  // 404 on a request that carried a session id is the specified way for a
  // server to say the session is gone, and it is worth naming.
  if (status === 404 && sessionId) {
    return `${head} (the session the server issued is no longer valid)`;
  }
  return body ? `${head}: ${firstLine(body)}` : head;
}

function firstLine(text) {
  const line = text.trim().split('\n')[0];
  return line.length > 200 ? line.slice(0, 200) + '...' : line;
}

function stripCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Read a response body as text. `limit` of 0 means no limit. */
function readBounded(res, limit) {
  return new Promise((resolve) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      if (limit === 0 || text.length < limit) text += chunk;
    });
    res.on('end', () => resolve(limit === 0 ? text : text.slice(0, limit)));
    res.on('error', () => resolve(text));
  });
}
