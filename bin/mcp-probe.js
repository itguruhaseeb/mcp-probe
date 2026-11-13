#!/usr/bin/env node
// mcp-probe: lint and health-check an MCP (Model Context Protocol) server.
//
// Usage:
//   npx mcp-probe -- <command...>
//   npx mcp-probe -- node ./my-server.js
//   npx mcp-probe --call --json -- python server.py
//   npx mcp-probe --url https://example.com/mcp

import { runDiagnostics, renderHuman } from '../src/report.js';
import { toSarif, resolveArtifact } from '../src/sarif.js';
import { color } from '../src/color.js';
import { VERSION } from '../src/version.js';
import { DEFAULT_TIMEOUT_MS } from '../src/client.js';
import { parseEndpoint, TRANSPORT_OWNED_HEADERS } from '../src/http-client.js';

const HELP = `mcp-probe  lint and health-check any MCP server, over stdio or streamable HTTP

Usage
  mcp-probe [options] -- <command...>
  mcp-probe [options] --url <endpoint>

Examples
  mcp-probe -- node ./server.js
  mcp-probe -- python server.py
  mcp-probe --call -- node examples/echo-server.js
  mcp-probe --json -- node examples/echo-server.js
  mcp-probe --sarif -- node examples/echo-server.js > mcp-probe.sarif
  mcp-probe --url https://example.com/mcp
  mcp-probe --json --url http://127.0.0.1:3000/mcp
  mcp-probe --url https://example.com/mcp --bearer-env MCP_TOKEN

Options
  --url <endpoint>  probe a remote server over streamable HTTP instead of
                    launching a local one over stdio
  --header <'Name: value'>
                    extra request header for --url, repeatable
  --bearer <token>  shorthand for --header 'Authorization: Bearer <token>'
  --bearer-env <VAR>
                    same, with the token read from an environment variable, so
                    it stays out of the job log and the shell history
  --call            attempt a safe round-trip on tools with no required params
  --json            emit machine-readable JSON instead of the human report
  --sarif           emit SARIF 2.1.0 for GitHub code scanning
  --sarif-artifact <path>
                    file the SARIF findings are attributed to (default: the
                    server entry script, when it is inside the working dir)
  --timeout <ms>    per-request timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS})
  -h, --help        show this help
  -v, --version     show version

Everything after "--" is the command used to launch the target MCP server.
Give either a command or --url, not both. Exit code is non-zero when a hard
failure is found (bad handshake, invalid tool schema).

No header value is ever written to the report, to the SARIF, or to an error
message, including the quoted body of a failed response.`;

function parseArgs(argv) {
  const opts = {
    call: false,
    json: false,
    sarif: false,
    sarifArtifact: null,
    timeout: DEFAULT_TIMEOUT_MS,
    command: null,
    args: [],
    url: null,
    headers: [],
  };
  // Which flag asked for the Authorization header, for the conflict messages
  // below. Holds the flag name, never the token.
  let bearerFlag = null;
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      const rest = argv.slice(i + 1);
      opts.command = rest[0] || null;
      opts.args = rest.slice(1);
      break;
    } else if (a === '--call') {
      opts.call = true;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--sarif') {
      opts.sarif = true;
    } else if (a === '--url') {
      const val = argv[++i];
      if (!val) {
        throw new UsageError('--url expects an endpoint');
      }
      opts.url = val;
    } else if (a === '--header') {
      const val = argv[++i];
      if (!val) {
        throw new UsageError("--header expects 'Name: value'");
      }
      addHeader(opts, parseHeader(val));
    } else if (a === '--bearer') {
      const val = argv[++i];
      if (!val) {
        throw new UsageError('--bearer expects a token');
      }
      if (bearerFlag) {
        throw new UsageError(`${bearerFlag} and --bearer both set the Authorization header; pick one`);
      }
      bearerFlag = '--bearer';
      addHeader(opts, { name: 'authorization', value: `Bearer ${val}` });
    } else if (a === '--bearer-env') {
      const name = argv[++i];
      if (!name) {
        throw new UsageError('--bearer-env expects the name of an environment variable');
      }
      if (bearerFlag) {
        throw new UsageError(
          `${bearerFlag} and --bearer-env both set the Authorization header; pick one`
        );
      }
      bearerFlag = '--bearer-env';
      const token = process.env[name];
      // The message names the variable, never its contents, and an empty
      // variable is as wrong as a missing one: it would send "Bearer " and the
      // server would answer 401 as though the token were rejected.
      if (!token) {
        throw new UsageError(`--bearer-env: the environment variable "${name}" is empty or not set`);
      }
      addHeader(opts, { name: 'authorization', value: `Bearer ${token}` });
    } else if (a === '--sarif-artifact') {
      const val = argv[++i];
      if (!val) {
        throw new UsageError('--sarif-artifact expects a path');
      }
      opts.sarifArtifact = val;
    } else if (a === '--timeout') {
      const val = Number(argv[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        throw new UsageError(`--timeout expects a positive number, got "${argv[i]}"`);
      }
      opts.timeout = val;
    } else if (a === '-h' || a === '--help') {
      opts.help = true;
    } else if (a === '-v' || a === '--version') {
      opts.showVersion = true;
    } else {
      throw new UsageError(`unknown option "${a}" (did you forget "--" before the command?)`);
    }
  }

  // Two machine formats on one stdout would produce a file that is neither.
  if (opts.json && opts.sarif) {
    throw new UsageError('--json and --sarif both write to stdout; pick one');
  }
  if (opts.sarifArtifact && !opts.sarif) {
    throw new UsageError('--sarif-artifact has no effect without --sarif');
  }
  // Credentials belong to the HTTP transport. Over stdio they would be
  // silently discarded, which on an authenticated run is the kind of silence
  // that gets read as "the server does not need a token after all".
  if (opts.headers.length > 0 && !opts.url && !opts.help && !opts.showVersion) {
    throw new UsageError('--header, --bearer and --bearer-env apply to --url, not to a "--" command');
  }
  // One target per run. Probing a local command and a remote endpoint are
  // different runs with different reports, and silently preferring one of
  // them would make the other look like it had been probed.
  if (opts.url && opts.command) {
    throw new UsageError('--url and a "--" command are two targets; pick one');
  }
  if (opts.url && !opts.help && !opts.showVersion) {
    // Fail on an unusable endpoint before launching anything, so a typo is a
    // usage error rather than a connection failure reported as an unhealthy
    // server.
    try {
      parseEndpoint(opts.url);
    } catch (err) {
      throw new UsageError(`--url: ${err.message}`);
    }
  }

  return opts;
}

class UsageError extends Error {}

/**
 * Parse one `--header 'Name: value'` argument.
 *
 * The name is lowercased because HTTP header names are case-insensitive and
 * the duplicate check below has to agree with the client, which lowercases
 * too. The value keeps its own case and its internal spaces; only the single
 * space conventionally written after the colon is dropped.
 */
function parseHeader(arg) {
  const sep = arg.indexOf(':');
  if (sep === -1) {
    throw new UsageError(`--header expects 'Name: value', got "${arg}"`);
  }
  const name = arg.slice(0, sep).trim().toLowerCase();
  const value = arg.slice(sep + 1).replace(/^ /, '');
  if (!name) {
    throw new UsageError(`--header got an empty header name in "${arg}"`);
  }
  // A name with whitespace in it is a missing quote, nearly always: the shell
  // split "Authorization: Bearer x" and only the first word arrived.
  if (/\s/.test(name)) {
    throw new UsageError(
      `--header got "${name}" as a header name; quote the whole argument, as --header 'Name: value'`
    );
  }
  if (!value) {
    throw new UsageError(`--header got an empty value for "${name}"`);
  }
  // Named rather than silently dropped. The transport sets these itself, and a
  // workflow author who writes one should be told it will not be used rather
  // than left to infer it from a report that looks normal.
  if (TRANSPORT_OWNED_HEADERS.has(name)) {
    throw new UsageError(`--header cannot set "${name}"; mcp-probe sets that header itself`);
  }
  return { name, value };
}

function addHeader(opts, header) {
  if (opts.headers.some((h) => h.name === header.name)) {
    throw new UsageError(`--header "${header.name}" was given more than once`);
  }
  opts.headers.push(header);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(color.red(`error: ${err.message}\n\n`));
    process.stderr.write(HELP + '\n');
    process.exit(2);
  }

  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return;
  }
  if (opts.showVersion) {
    process.stdout.write(VERSION + '\n');
    return;
  }
  if (!opts.command && !opts.url) {
    process.stderr.write(color.red('error: no server command or --url given\n\n'));
    process.stderr.write(HELP + '\n');
    process.exit(2);
  }

  const result = await runDiagnostics({
    command: opts.command,
    args: opts.args,
    url: opts.url,
    headers: opts.headers,
    timeout: opts.timeout,
    call: opts.call,
  });

  if (opts.sarif) {
    const artifact = resolveArtifact({
      command: opts.command,
      args: opts.args,
      url: opts.url,
      override: opts.sarifArtifact,
    });
    if (artifact.synthetic) {
      // Worth saying out loud: the upload will still be accepted, but the
      // alerts will not anchor to a file in the repository. stderr, so the
      // SARIF on stdout stays clean.
      process.stderr.write(
        color.yellow(
          `warning: ${
            opts.url
              ? 'a remote target has no file in the checkout'
              : 'no server file found in the working directory'
          }, attributing findings to ${artifact.uri}\n` +
            '         pass --sarif-artifact <path> to anchor them to a file in the repo\n'
        )
      );
    }
    await writeOut(JSON.stringify(toSarif(result, { artifactUri: artifact.uri }), null, 2) + '\n');
  } else if (opts.json) {
    await writeOut(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result);
  }

  process.exit(result.ok ? 0 : 1);
}

// When stdout is a pipe (a CI step, a harness, `| jq`), process.exit() drops
// whatever has not yet left the kernel pipe buffer, which on Linux is 64 KiB.
// A server that reports a large tool catalog therefore came back as truncated,
// unparseable JSON to any consumer reading through a pipe, while the same
// command printed to a file or terminal looked fine. Waiting for the write
// callback before exiting is the whole fix.
function writeOut(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
  });
}

main().catch((err) => {
  process.stderr.write(color.red(`unexpected error: ${err?.stack || err}\n`));
  process.exit(2);
});
