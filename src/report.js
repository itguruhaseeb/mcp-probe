// Orchestrates a full health check against an MCP server and renders the report
// either as colorized human output or as a machine-readable JSON document.

import { McpClient, McpError, PROTOCOL_VERSION } from './client.js';
import { lintTool, safeCallArgs, FAIL, WARN } from './linter.js';
import { color, glyph } from './color.js';

function now() {
  return Number(process.hrtime.bigint() / 1000000n); // ms as integer
}

async function timed(fn) {
  const start = process.hrtime.bigint();
  const value = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { value, ms: Math.round(ms * 10) / 10 };
}

/**
 * Run the full diagnostic. Returns a structured result object regardless of
 * output format, so both the human renderer and --json consume the same data.
 *
 * @param {object} opts
 * @param {string} opts.command
 * @param {string[]} opts.args
 * @param {number} opts.timeout
 * @param {boolean} opts.call   attempt safe round-trips
 */
export async function runDiagnostics({ command, args, timeout, call }) {
  const result = {
    tool: 'mcp-probe',
    version: '0.1.0',
    target: [command, ...args].join(' '),
    clientProtocolVersion: PROTOCOL_VERSION,
    ok: true,
    server: null,
    capabilities: null,
    timings: {},
    tools: [],
    resources: null,
    prompts: null,
    calls: [],
    warnings: [],
    errors: [],
  };

  const client = new McpClient(command, args, { timeout });
  client.start();

  try {
    // 1. Handshake.
    let init;
    try {
      const t = await timed(() => client.initialize());
      init = t.value;
      result.timings.handshakeMs = t.ms;
    } catch (err) {
      result.ok = false;
      result.errors.push(`handshake failed: ${err.message}`);
      if (err instanceof McpError && err.data?.stderr) {
        result.errors.push(`server stderr: ${err.data.stderr}`);
      }
      return result;
    }

    result.server = init?.serverInfo || null;
    result.capabilities = init?.capabilities || {};
    result.negotiatedProtocolVersion = init?.protocolVersion || null;

    if (init?.protocolVersion && init.protocolVersion !== PROTOCOL_VERSION) {
      result.warnings.push(
        `server negotiated protocol ${init.protocolVersion} (client offered ${PROTOCOL_VERSION})`
      );
    }

    const caps = result.capabilities || {};

    // 2. tools/list (only if declared, but many servers expose it regardless).
    if (caps.tools !== undefined || true) {
      try {
        const t = await timed(() => client.request('tools/list', {}));
        result.timings.toolsListMs = t.ms;
        const tools = Array.isArray(t.value?.tools) ? t.value.tools : [];
        for (const tool of tools) {
          const linted = lintTool(tool);
          result.tools.push({
            name: linted.name,
            description: tool.description || null,
            issues: linted.issues,
            fails: linted.fails,
            warns: linted.warns,
            safeToCall: safeCallArgs(tool).safe,
            annotations: tool.annotations ?? null,
          });
          if (linted.fails > 0) result.ok = false;
        }
      } catch (err) {
        if (caps.tools !== undefined) {
          result.ok = false;
          result.errors.push(`tools/list failed: ${err.message}`);
        } else {
          result.warnings.push(`tools/list not available: ${err.message}`);
        }
      }
    }

    // 3. resources/list, if declared.
    if (caps.resources !== undefined) {
      try {
        const t = await timed(() => client.request('resources/list', {}));
        result.timings.resourcesListMs = t.ms;
        result.resources = { count: Array.isArray(t.value?.resources) ? t.value.resources.length : 0 };
      } catch (err) {
        result.warnings.push(`resources/list failed: ${err.message}`);
      }
    }

    // 4. prompts/list, if declared.
    if (caps.prompts !== undefined) {
      try {
        const t = await timed(() => client.request('prompts/list', {}));
        result.timings.promptsListMs = t.ms;
        result.prompts = { count: Array.isArray(t.value?.prompts) ? t.value.prompts.length : 0 };
      } catch (err) {
        result.warnings.push(`prompts/list failed: ${err.message}`);
      }
    }

    // 5. Optional safe round-trips.
    if (call && result.tools.length > 0) {
      // We need the raw tool list again to build args; re-fetch is cheap and
      // avoids threading raw descriptors through the linted view.
      let rawTools = [];
      try {
        const listed = await client.request('tools/list', {});
        rawTools = Array.isArray(listed?.tools) ? listed.tools : [];
      } catch {
        rawTools = [];
      }
      for (const tool of rawTools) {
        const { safe, args: callArgs } = safeCallArgs(tool);
        if (!safe) {
          result.calls.push({ name: tool.name, skipped: true, reason: 'has required parameters' });
          continue;
        }
        try {
          const t = await timed(() =>
            client.request('tools/call', { name: tool.name, arguments: callArgs })
          );
          const isError = t.value?.isError === true;
          result.calls.push({
            name: tool.name,
            skipped: false,
            ok: !isError,
            ms: t.ms,
            isError,
          });
          if (isError) {
            result.warnings.push(`tools/call "${tool.name}" returned isError=true`);
          }
        } catch (err) {
          result.calls.push({ name: tool.name, skipped: false, ok: false, error: err.message });
          result.warnings.push(`tools/call "${tool.name}" failed: ${err.message}`);
        }
      }
    }

    // Surface any non-JSON stdout noise as a protocol warning.
    if (client.nonJsonLines.length > 0) {
      result.warnings.push(
        `server wrote ${client.nonJsonLines.length} non-JSON line(s) to stdout (breaks stdio framing)`
      );
    }

    return result;
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Human renderer
// ---------------------------------------------------------------------------

export function renderHuman(r, out = process.stdout) {
  const lines = [];
  const p = (s = '') => lines.push(s);

  p();
  p(color.bold(`mcp-probe ${color.dim('v' + r.version)}`));
  p(color.gray(`target: ${r.target}`));
  p();

  // Handshake section.
  p(color.bold('Handshake'));
  if (r.errors.length && !r.server) {
    for (const e of r.errors) p(`  ${glyph.fail()} ${e}`);
    p();
    p(section('Summary', r));
    out.write(lines.join('\n') + '\n');
    return;
  }
  const s = r.server || {};
  p(`  ${glyph.pass()} initialized in ${fmtMs(r.timings.handshakeMs)}`);
  p(`  ${glyph.info()} server: ${color.cyan(s.name || 'unknown')} ${color.dim(s.version ? 'v' + s.version : '')}`.trimEnd());
  if (r.negotiatedProtocolVersion) {
    p(`  ${glyph.info()} protocol: ${r.negotiatedProtocolVersion}`);
  }
  const capNames = Object.keys(r.capabilities || {});
  p(`  ${glyph.info()} capabilities: ${capNames.length ? capNames.join(', ') : color.dim('none declared')}`);
  p();

  // Tools section.
  p(color.bold(`Tools ${color.dim(`(${r.tools.length})`)}`));
  if (r.tools.length === 0) {
    p(`  ${color.dim('no tools listed')}`);
  }
  for (const tool of r.tools) {
    const g = tool.fails > 0 ? glyph.fail() : tool.warns > 0 ? glyph.warn() : glyph.pass();
    const meta = [];
    if (tool.fails) meta.push(color.red(`${tool.fails} error${tool.fails > 1 ? 's' : ''}`));
    if (tool.warns) meta.push(color.yellow(`${tool.warns} warning${tool.warns > 1 ? 's' : ''}`));
    const suffix = meta.length ? color.dim(': ') + meta.join(color.dim(', ')) : '';
    p(`  ${g} ${color.bold(tool.name)}${suffix}`);
    for (const iss of tool.issues) {
      const ig = iss.severity === FAIL ? glyph.fail() : glyph.warn();
      p(`      ${ig} ${iss.message}`);
    }
  }
  if (r.timings.toolsListMs !== undefined) {
    p(`  ${color.dim(`tools/list in ${fmtMs(r.timings.toolsListMs)}`)}`);
  }
  p();

  // Resources / prompts.
  if (r.resources || r.prompts) {
    p(color.bold('Other'));
    if (r.resources) p(`  ${glyph.info()} resources: ${r.resources.count}`);
    if (r.prompts) p(`  ${glyph.info()} prompts: ${r.prompts.count}`);
    p();
  }

  // Calls.
  if (r.calls.length) {
    p(color.bold('Round-trips (--call)'));
    for (const c of r.calls) {
      if (c.skipped) {
        p(`  ${glyph.info()} ${c.name} ${color.dim('skipped (' + c.reason + ')')}`);
      } else if (c.ok) {
        p(`  ${glyph.pass()} ${c.name} ${color.dim('returned in ' + fmtMs(c.ms))}`);
      } else {
        p(`  ${glyph.fail()} ${c.name} ${color.red(c.error || 'returned isError')}`);
      }
    }
    p();
  }

  // Warnings not tied to a specific tool.
  if (r.warnings.length) {
    p(color.bold('Warnings'));
    for (const w of r.warnings) p(`  ${glyph.warn()} ${w}`);
    p();
  }

  p(section('Summary', r));
  out.write(lines.join('\n') + '\n');
}

function section(title, r) {
  const totalFails =
    r.errors.length + r.tools.reduce((n, t) => n + t.fails, 0);
  const totalWarns =
    r.warnings.length + r.tools.reduce((n, t) => n + t.warns, 0);
  const parts = [];
  parts.push(`${r.tools.length} tool${r.tools.length === 1 ? '' : 's'}`);
  if (totalFails === 0) {
    parts.push(color.green('0 errors'));
  } else {
    parts.push(color.red(`${totalFails} error${totalFails === 1 ? '' : 's'}`));
  }
  parts.push(
    totalWarns === 0
      ? color.dim('0 warnings')
      : color.yellow(`${totalWarns} warning${totalWarns === 1 ? '' : 's'}`)
  );
  const verdict = r.ok ? color.green('healthy') : color.red('unhealthy');
  return `${color.bold(title)}: ${verdict} ${color.dim('(' + parts.join(', ') + ')')}`;
}

function fmtMs(ms) {
  if (ms === undefined || ms === null) return 'n/a';
  return `${ms}ms`;
}
