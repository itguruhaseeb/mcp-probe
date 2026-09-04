#!/usr/bin/env node
// mcp-probe: lint and health-check an MCP (Model Context Protocol) server.
//
// Usage:
//   npx mcp-probe -- <command...>
//   npx mcp-probe -- node ./my-server.js
//   npx mcp-probe --call --json -- python server.py

import { runDiagnostics, renderHuman } from '../src/report.js';
import { toSarif, resolveArtifact } from '../src/sarif.js';
import { color } from '../src/color.js';
import { VERSION } from '../src/version.js';

const HELP = `mcp-probe  lint and health-check any MCP server over stdio

Usage
  mcp-probe [options] -- <command...>

Examples
  mcp-probe -- node ./server.js
  mcp-probe -- python server.py
  mcp-probe --call -- node examples/echo-server.js
  mcp-probe --json -- node examples/echo-server.js
  mcp-probe --sarif -- node examples/echo-server.js > mcp-probe.sarif

Options
  --call            attempt a safe round-trip on tools with no required params
  --json            emit machine-readable JSON instead of the human report
  --sarif           emit SARIF 2.1.0 for GitHub code scanning
  --sarif-artifact <path>
                    file the SARIF findings are attributed to (default: the
                    server entry script, when it is inside the working dir)
  --timeout <ms>    per-request timeout in milliseconds (default 10000)
  -h, --help        show this help
  -v, --version     show version

Everything after "--" is the command used to launch the target MCP server.
Exit code is non-zero when a hard failure is found (bad handshake, invalid
tool schema).`;

function parseArgs(argv) {
  const opts = {
    call: false,
    json: false,
    sarif: false,
    sarifArtifact: null,
    timeout: 10000,
    command: null,
    args: [],
  };
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

  return opts;
}

class UsageError extends Error {}

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
  if (!opts.command) {
    process.stderr.write(color.red('error: no server command given\n\n'));
    process.stderr.write(HELP + '\n');
    process.exit(2);
  }

  const result = await runDiagnostics({
    command: opts.command,
    args: opts.args,
    timeout: opts.timeout,
    call: opts.call,
  });

  if (opts.sarif) {
    const artifact = resolveArtifact({
      command: opts.command,
      args: opts.args,
      override: opts.sarifArtifact,
    });
    if (artifact.synthetic) {
      // Worth saying out loud: the upload will still be accepted, but the
      // alerts will not anchor to a file in the repository. stderr, so the
      // SARIF on stdout stays clean.
      process.stderr.write(
        color.yellow(
          `warning: no server file found in the working directory, attributing findings to ${artifact.uri}\n` +
            '         pass --sarif-artifact <path> to anchor them to a file in the repo\n'
        )
      );
    }
    process.stdout.write(
      JSON.stringify(toSarif(result, { artifactUri: artifact.uri }), null, 2) + '\n'
    );
  } else if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(color.red(`unexpected error: ${err?.stack || err}\n`));
  process.exit(2);
});
