// Tests for the JSON Schema / tool linter. Uses node's built-in test runner.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSchema, lintTool, safeCallArgs, FAIL, WARN } from '../src/linter.js';

function fails(issues) {
  return issues.filter((i) => i.severity === FAIL);
}
function warns(issues) {
  return issues.filter((i) => i.severity === WARN);
}

test('a clean object schema produces no failures', () => {
  const issues = lintSchema({
    type: 'object',
    properties: { a: { type: 'string', description: 'x' } },
    required: ['a'],
  });
  assert.equal(fails(issues).length, 0);
});

test('missing schema is a hard failure', () => {
  const issues = lintSchema(undefined);
  assert.equal(fails(issues).length, 1);
});

test('non-object schema is a hard failure', () => {
  assert.equal(fails(lintSchema('nope')).length, 1);
  assert.equal(fails(lintSchema([])).length, 1);
});

test('invalid type value fails', () => {
  const issues = lintSchema({ type: 'strong' });
  assert.equal(fails(issues).length, 1);
});

test('required referencing an unknown property fails', () => {
  const issues = lintSchema({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a', 'ghost'],
  });
  const f = fails(issues);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /ghost/);
});

test('required present but no properties fails', () => {
  const issues = lintSchema({ type: 'object', required: ['a'] });
  assert.ok(fails(issues).length >= 1);
});

test('required must be an array', () => {
  const issues = lintSchema({ type: 'object', properties: {}, required: 'a' });
  assert.equal(fails(issues).length, 1);
});

test('duplicate required entry is a warning', () => {
  const issues = lintSchema({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a', 'a'],
  });
  assert.ok(warns(issues).some((w) => /more than once/.test(w.message)));
});

test('properties must be an object', () => {
  assert.equal(fails(lintSchema({ type: 'object', properties: [] })).length, 1);
});

test('a property that is not a schema object fails', () => {
  const issues = lintSchema({ type: 'object', properties: { a: 'string' } });
  assert.equal(fails(issues).length, 1);
});

test('root schema without type warns', () => {
  const issues = lintSchema({ properties: { a: { type: 'string' } } });
  assert.ok(warns(issues).some((w) => /no "type"/.test(w.message)));
});

test('empty object schema warns about no properties', () => {
  const issues = lintSchema({ type: 'object' });
  assert.ok(warns(issues).some((w) => /no properties/.test(w.message)));
});

test('root type other than object warns', () => {
  const issues = lintSchema({ type: 'string' });
  assert.ok(warns(issues).some((w) => /conventionally objects/.test(w.message)));
});

test('lintTool flags missing name as failure', () => {
  const { issues, fails: f } = lintTool({ inputSchema: { type: 'object', properties: {} } });
  assert.ok(f >= 1);
  assert.ok(issues.some((i) => /missing a "name"/.test(i.message)));
});

test('lintTool warns on missing description and title', () => {
  const { issues } = lintTool({
    name: 'x',
    inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
  });
  assert.ok(issues.some((i) => /description/.test(i.message)));
  assert.ok(issues.some((i) => /title/.test(i.message)));
});

test('lintTool accepts a fully specified tool', () => {
  const { fails: f, warns: w } = lintTool({
    name: 'echo',
    title: 'Echo',
    description: 'echo text back',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 't' } },
      required: ['text'],
    },
  });
  assert.equal(f, 0);
  assert.equal(w, 0);
});

test('safeCallArgs marks no-required-params tools safe', () => {
  assert.deepEqual(safeCallArgs({ inputSchema: { type: 'object', properties: {} } }), {
    safe: true,
    args: {},
  });
});

test('safeCallArgs marks required-params tools unsafe', () => {
  const r = safeCallArgs({
    inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  });
  assert.equal(r.safe, false);
});
