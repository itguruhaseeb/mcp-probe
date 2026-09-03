// The rule id set is a public contract. These tests exist so that adding,
// removing or renaming an id is a deliberate act with a visible diff, rather
// than something that slips through a refactor and breaks every downstream
// consumer filtering on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lintSchema, lintTool, RULES, RULE_IDS, FAIL, WARN } from '../src/linter.js';

// Update this list ONLY when intentionally changing the rule set, and treat a
// rename as a breaking change.
const EXPECTED_RULE_IDS = [
  'schema/empty-contract',
  'schema/invalid-type',
  'schema/missing',
  'schema/no-type',
  'schema/non-object-root',
  'schema/not-an-object',
  'schema/properties-not-an-object',
  'schema/property-not-a-schema',
  'schema/required-duplicate',
  'schema/required-non-string',
  'schema/required-not-an-array',
  'schema/required-not-in-properties',
  'schema/required-without-properties',
  'schema/type-not-a-string',
  'tool/missing-description',
  'tool/missing-name',
  'tool/missing-title',
  'tool/no-safety-hints',
];

test('the rule id set is stable', () => {
  assert.deepEqual(RULE_IDS, EXPECTED_RULE_IDS);
});

test('every rule declares a severity and a summary', () => {
  for (const id of RULE_IDS) {
    const rule = RULES[id];
    assert.ok(rule, `${id} has no entry`);
    assert.ok(rule.severity === FAIL || rule.severity === WARN, `${id} has a bad severity`);
    assert.ok(rule.summary && rule.summary.length > 0, `${id} has no summary`);
  }
});

test('rule ids are namespaced', () => {
  for (const id of RULE_IDS) {
    assert.match(id, /^(tool|schema)\/[a-z0-9-]+$/, `${id} is not a valid namespaced id`);
  }
});

// A representative sample of inputs that between them trip most of the rules.
// The point is not exhaustive coverage, it is that nothing reaches a consumer
// without an id attached.
const SAMPLES = [
  () => lintSchema(undefined),
  () => lintSchema('nope'),
  () => lintSchema({ type: 'strong' }),
  () => lintSchema({ type: 42 }),
  () => lintSchema({ type: 'string' }),
  () => lintSchema({ type: 'object' }),
  () => lintSchema({ properties: { a: { type: 'string' } } }),
  () => lintSchema({ type: 'object', properties: [] }),
  () => lintSchema({ type: 'object', properties: { a: 'string' } }),
  () => lintSchema({ type: 'object', properties: {}, required: 'a' }),
  () => lintSchema({ type: 'object', properties: { a: { type: 'string' } }, required: [1] }),
  () => lintSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'a'] }),
  () => lintSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['ghost'] }),
  () => lintSchema({ type: 'object', required: ['a'] }),
  () => lintSchema({ type: ['string', 'bogus'] }),
  () => lintTool({}).issues,
  () => lintTool({ name: 'x', inputSchema: { type: 'object', properties: { a: { type: 'string' } } } }).issues,
];

test('every emitted issue carries a known rule id', () => {
  for (const sample of SAMPLES) {
    for (const found of sample()) {
      assert.ok(found.id, `an issue was emitted with no id: ${found.message}`);
      assert.ok(RULES[found.id], `issue used an unregistered id "${found.id}"`);
    }
  }
});

test("an issue's severity matches its rule's declared severity", () => {
  for (const sample of SAMPLES) {
    for (const found of sample()) {
      assert.equal(
        found.severity,
        RULES[found.id].severity,
        `${found.id} emitted severity ${found.severity} but declares ${RULES[found.id].severity}`
      );
    }
  }
});

test('ids identify the specific rule, not just the severity', () => {
  const issues = lintSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['ghost'] });
  assert.ok(issues.some((i) => i.id === 'schema/required-not-in-properties'));
});

test('ids survive into the tool-level result', () => {
  const { issues } = lintTool({ name: 'x', title: 'X', description: 'd', inputSchema: { type: 'object' } });
  assert.ok(issues.some((i) => i.id === 'tool/no-safety-hints'));
  assert.ok(issues.some((i) => i.id === 'schema/empty-contract'));
});
