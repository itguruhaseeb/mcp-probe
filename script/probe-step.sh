#!/usr/bin/env bash
# The body of the mcp-probe GitHub Action's probe step.
#
# This lives in a script rather than inline in action.yml for one reason: a
# composite action's shell is otherwise untestable. Here it runs under
# test/action.test.js on every CI run, on all three supported Node versions,
# alongside everything else. Shell inside a YAML string gets exercised only
# when someone pushes a workflow and watches it, which is how action bugs
# reach users.
#
# Inputs arrive as environment variables so that nothing from the caller's
# workflow is interpolated into this file as text:
#
#   MCP_PROBE_SERVER    the command that launches the server, for a local target
#   MCP_PROBE_URL       the endpoint of an already running server, for a remote
#                       target. Exactly one of SERVER and URL is required.
#   MCP_PROBE_SARIF     "true" for SARIF, anything else for JSON
#   MCP_PROBE_ARTIFACT  optional, --sarif-artifact path
#   MCP_PROBE_TIMEOUT   per-request timeout in ms
#   MCP_PROBE_CALL      "true" to attempt safe round-trips
#   MCP_PROBE_OUTPUT    optional, where to write the report
#   MCP_PROBE_BIN       the CLI to run, defaults to the one beside this script
#
# Writes exit-code, healthy and report-file to $GITHUB_OUTPUT, and a short
# report to $GITHUB_STEP_SUMMARY. Exits 2 when the configuration is wrong,
# and 0 otherwise, including when the server is unhealthy: the caller decides
# what to do about an unhealthy server, after the SARIF has been uploaded.

set -uo pipefail

: "${MCP_PROBE_SERVER:=}"
: "${MCP_PROBE_URL:=}"
: "${MCP_PROBE_SARIF:=true}"
: "${MCP_PROBE_ARTIFACT:=}"
: "${MCP_PROBE_TIMEOUT:=10000}"
: "${MCP_PROBE_CALL:=false}"
: "${MCP_PROBE_OUTPUT:=}"
: "${GITHUB_OUTPUT:=/dev/null}"
: "${GITHUB_STEP_SUMMARY:=/dev/null}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${MCP_PROBE_BIN:=$here/../bin/mcp-probe.js}"

# Exactly one target. A local command and a remote endpoint are different runs
# with different reports, so neither silently wins: both set, or neither set,
# is a problem with the workflow rather than with the server, and the CLI would
# otherwise be left to discover it after the step had already claimed to probe
# something. Emptiness is tested with the spaces stripped because an unset
# action input and one set to a blank string arrive here identically.
server_set="${MCP_PROBE_SERVER// /}"
url_set="${MCP_PROBE_URL// /}"

if [ -n "$server_set" ] && [ -n "$url_set" ]; then
  echo "::error::the 'server' and 'url' inputs are two different targets; set exactly one of them, not both"
  exit 2
fi

if [ -z "$server_set" ] && [ -z "$url_set" ]; then
  echo "::error::one of the 'server' or 'url' inputs is required; set exactly one of them"
  exit 2
fi

flags=(--timeout "$MCP_PROBE_TIMEOUT")
if [ "$MCP_PROBE_CALL" = "true" ]; then
  flags+=(--call)
fi

if [ "$MCP_PROBE_SARIF" = "true" ]; then
  flags+=(--sarif)
  default_out="mcp-probe.sarif"
  if [ -n "$MCP_PROBE_ARTIFACT" ]; then
    flags+=(--sarif-artifact "$MCP_PROBE_ARTIFACT")
  elif [ -n "$url_set" ]; then
    # A remote target has no file in the checkout, so every alert anchors to a
    # synthetic mcp-probe:// URI and lands on no line of code. The probe says
    # so on its own stderr, which is buried in the job log, so say it here as
    # well where a maintainer reading the step will see it.
    echo "::notice::a remote target has no file in the checkout, so the code scanning alerts will not anchor to one. Set the 'artifact' input to a path in the checkout, usually the config file that declares this endpoint."
  fi
else
  flags+=(--json)
  default_out="mcp-probe.json"
  if [ -n "$MCP_PROBE_ARTIFACT" ]; then
    echo "::warning::the 'artifact' input only applies to SARIF output and was ignored"
  fi
fi

out="${MCP_PROBE_OUTPUT:-$default_out}"

# Without this, an output path in a directory that does not exist yet makes
# the redirect fail before the probe ever runs, and the captured exit code is
# then the shell's 1, reported as an unhealthy server. A wrong path must not
# be indistinguishable from a bad server.
if ! mkdir -p "$(dirname "$out")"; then
  echo "::error::cannot create the directory for the report at $out"
  exit 2
fi

if [ -n "$url_set" ]; then
  # The endpoint is passed through untouched. A malformed one is rejected by
  # the probe at parse time, which lands below as exit 2 and is reported as a
  # bad input, so a typo is never reported as an unhealthy server.
  target_argv=(--url "$MCP_PROBE_URL")
  target_label="$MCP_PROBE_URL"
else
  # The server command is one string written by the workflow author, so it is
  # split on whitespace the way a shell would. A path containing a space has to
  # be handled by the author, for instance with a wrapper script. Deliberately
  # not eval: this expands, it does not interpret.
  read -r -a server_argv <<< "$MCP_PROBE_SERVER"
  target_argv=(-- "${server_argv[@]}")
  target_label="${server_argv[*]}"
fi

echo "running: mcp-probe ${flags[*]} ${target_argv[*]}"

set +e
node "$MCP_PROBE_BIN" "${flags[@]}" "${target_argv[@]}" > "$out"
code=$?
set -e

# A usage error means the inputs are wrong, not that the server is. It is
# checked before the emptiness check below because the probe writes usage
# errors to stderr, so the report is legitimately empty here and that check
# would otherwise blame the runner for a bad input.
if [ "$code" -eq 2 ]; then
  echo "::error::mcp-probe was invoked incorrectly (exit 2). Check the action inputs."
  exit 2
fi

# Past that point the probe writes a report on every path it exits through,
# so a missing one means the run never got that far: node absent, the action
# checkout incomplete, the disk full. Reporting that as an unhealthy server
# would point the author at the wrong thing entirely.
if [ ! -s "$out" ]; then
  echo "::error::mcp-probe wrote no report to $out (exit $code). This is a problem with the runner or the action, not with the server."
  exit 2
fi

if [ "$code" -eq 0 ]; then
  healthy=true
else
  healthy=false
fi

{
  echo "exit-code=$code"
  echo "healthy=$healthy"
  echo "report-file=$out"
} >> "$GITHUB_OUTPUT"

{
  echo "### mcp-probe"
  echo
  echo "- target: \`$target_label\`"
  echo "- result: $([ "$code" -eq 0 ] && echo 'healthy' || echo 'unhealthy')"
  echo "- exit code: \`$code\`"
  echo "- report: \`$out\`"
} >> "$GITHUB_STEP_SUMMARY"
