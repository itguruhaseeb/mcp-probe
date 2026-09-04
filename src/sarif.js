// SARIF 2.1.0 output for mcp-probe.
//
// SARIF is the format GitHub code scanning ingests, so emitting it is what lets
// a conformance run show up as annotations on a pull request rather than as
// text buried in a job log.
//
// The mapping is deliberately thin:
//
//   RULES (src/linter.js)  ->  runs[0].tool.driver.rules
//   a finding's `id`       ->  result.ruleId
//   a finding's `severity` ->  result.level  (fail -> error, warn -> warning)
//   a finding's `message`  ->  result.message.text
//
// The rules array is built by iterating the exported RULES registry. It must
// stay that way. Two hand-maintained lists of rule ids that can disagree is the
// exact problem stable ids were introduced to remove.
//
// One wrinkle is worth stating plainly. SARIF results are shaped around files,
// and mcp-probe lints a live process rather than a checkout. Findings are
// therefore attributed to an artifact chosen by the caller (see resolveArtifact
// and the --sarif-artifact flag): the server's entry script when one can be
// identified inside the working directory, otherwise a synthetic URI naming the
// launch command.
// Tool-level problems that belong to no rule, such as a failed handshake, are
// reported as invocation notifications instead of as results, which is where
// SARIF puts things the analysis said about itself.

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { relative, isAbsolute, resolve } from 'node:path';

import { RULES, RULE_IDS, FAIL } from './linter.js';

export const SARIF_VERSION = '2.1.0';
export const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json';

const INFORMATION_URI = 'https://github.com/itguruhaseeb/mcp-probe';
const RULE_HELP_URI = `${INFORMATION_URI}#rule-ids`;

/** fail -> error, warn -> warning. SARIF has no notion of our severity words. */
function levelFor(severity) {
  return severity === FAIL ? 'error' : 'warning';
}

/**
 * Pick the artifact findings are attributed to.
 *
 * Preference order:
 *   1. an explicit override from the caller (--sarif-artifact)
 *   2. the first launch argument that is a file inside the working directory
 *   3. the launch command itself, on the same terms, for a server invoked
 *      directly rather than through an interpreter
 *   4. a synthetic `mcp-probe://` URI naming the command
 *
 * Two constraints drive that order, and both come from what GitHub can do with
 * the result. Arguments are tried before the command because `node server.js`
 * is a probe of `server.js`, not of the node binary. And a candidate is only
 * accepted when it lands inside the working directory, because an alert can
 * only anchor to a file that exists in the checkout: an absolute path to an
 * interpreter on the runner is worse than admitting we do not have a file.
 *
 * Returns { uri, synthetic }. `synthetic` is true when nothing qualified. Such
 * a log still uploads and still validates, the alerts just will not attach to
 * a line of code.
 */
export function resolveArtifact({ command, args = [], override, cwd = process.cwd() } = {}) {
  if (override) {
    return { uri: toPosix(override), synthetic: false };
  }

  for (const candidate of [...args, command]) {
    const uri = inTreeFile(candidate, cwd);
    if (uri) return { uri, synthetic: false };
  }

  const target = [command, ...args].filter(Boolean).join(' ');
  return { uri: `mcp-probe://${encodeURI(target)}`, synthetic: true };
}

/**
 * The candidate as a checkout-relative URI, or null when it is not a file
 * inside the working directory.
 */
function inTreeFile(candidate, cwd) {
  if (typeof candidate !== 'string' || candidate === '') return null;
  // A bare `node` or `python` is a program name. Resolving it against cwd would
  // invent a file that is not there.
  if (!candidate.includes('/') && !candidate.includes('\\') && !candidate.includes('.')) return null;

  let stat;
  try {
    stat = statSync(candidate);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const rel = isAbsolute(candidate) ? relative(cwd, candidate) : relative(cwd, resolve(cwd, candidate));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return toPosix(rel);
}

function toPosix(p) {
  return p.split('\\').join('/');
}

/**
 * A stable identity for a finding, so re-running the probe does not create a
 * second copy of an alert that has not actually changed. Tool name plus rule id
 * is the right grain: the same rule tripping on two different tools is two
 * findings, the same rule on the same tool across runs is one.
 */
function fingerprint(toolName, ruleId) {
  return createHash('sha256').update(`${toolName}\u0000${ruleId}`).digest('hex').slice(0, 16);
}

/** Build the driver.rules array straight from the registry. */
function driverRules() {
  return RULE_IDS.map((id) => {
    const rule = RULES[id];
    const [namespace] = id.split('/');
    return {
      id,
      name: id,
      shortDescription: { text: rule.summary },
      defaultConfiguration: { level: levelFor(rule.severity) },
      helpUri: RULE_HELP_URI,
      properties: { tags: ['mcp', namespace] },
    };
  });
}

/**
 * Convert a runDiagnostics() result into a SARIF 2.1.0 log.
 *
 * @param {object} result   the object runDiagnostics returns
 * @param {object} [opts]
 * @param {string} [opts.artifactUri]  URI findings are attributed to; when
 *   omitted it is resolved from the result's target
 * @returns {object} a SARIF log, ready for JSON.stringify
 */
export function toSarif(result, { artifactUri } = {}) {
  const rules = driverRules();
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));

  const uri =
    artifactUri ||
    resolveArtifact({
      command: (result?.target || '').split(' ')[0],
      args: (result?.target || '').split(' ').slice(1),
    }).uri;

  const results = [];
  for (const tool of result?.tools || []) {
    for (const finding of tool.issues || []) {
      const index = ruleIndex.get(finding.id);
      results.push({
        ruleId: finding.id,
        ...(index === undefined ? {} : { ruleIndex: index }),
        level: levelFor(finding.severity),
        message: { text: `${tool.name}: ${finding.message}` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri },
            },
            logicalLocations: [
              {
                name: tool.name,
                fullyQualifiedName: `tool/${tool.name}`,
                kind: 'function',
              },
            ],
          },
        ],
        partialFingerprints: {
          mcpProbeToolRule: fingerprint(tool.name, finding.id),
        },
        properties: { mcpTool: tool.name },
      });
    }
  }

  // Handshake failures, transport noise and protocol mismatches are statements
  // about the run rather than about a rule, so they belong in notifications.
  const notifications = [
    ...(result?.errors || []).map((text) => ({ level: 'error', message: { text } })),
    ...(result?.warnings || []).map((text) => ({ level: 'warning', message: { text } })),
  ];

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'mcp-probe',
            version: result?.version,
            semanticVersion: result?.version,
            informationUri: INFORMATION_URI,
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: result?.ok !== false,
            ...(notifications.length ? { toolExecutionNotifications: notifications } : {}),
          },
        ],
        artifacts: [{ location: { uri } }],
        results,
        properties: {
          target: result?.target,
          clientProtocolVersion: result?.clientProtocolVersion,
          negotiatedProtocolVersion: result?.negotiatedProtocolVersion ?? null,
        },
      },
    ],
  };
}
