// Single source of truth for the version string.
//
// The version used to be hardcoded in three places: the CLI's --version output,
// the `version` field of every --json report, and the clientInfo sent during the
// MCP initialize handshake. They drifted, and shipped 0.1.0 while package.json
// said 0.1.1. Read it from package.json instead so it cannot happen again.
//
// package.json is always present in a published npm tarball and sits at the
// package root, so this resolves both in a git checkout and inside node_modules.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));

/** @type {string} */
export const VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
