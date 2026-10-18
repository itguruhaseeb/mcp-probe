#!/usr/bin/env node
// An MCP server that accepts a connection and then never answers.
//
// This is the failure mcp-probe's --timeout exists for, and it is deliberately
// not the same as a crash: the process starts, the pipe stays open, and the
// framing is never violated. Nothing is written to stdout at all, so a probe
// pointed at it can only end by giving up. A server that exits instead would
// exercise the transport path and tell us nothing about the timer.
//
// Use it to see the timeout behaviour by hand:
//
//   node bin/mcp-probe.js --timeout 500 -- node examples/unresponsive-server.js
//   node bin/mcp-probe.js --json --timeout 500 -- node examples/unresponsive-server.js
//
// test/timeout.test.js probes it in CI.

// Read and discard whatever the client sends. Resuming the stream is what keeps
// this process alive; without it node would see no pending work and exit, which
// would turn a hang into a crash and defeat the point of the example.
process.stdin.resume();
process.stdin.on('data', () => {
  // Deliberately no reply.
});

// When the client closes stdin it has finished with us, so exit rather than
// waiting to be killed. A probe run should not leave this process behind.
process.stdin.on('end', () => {
  process.exit(0);
});
