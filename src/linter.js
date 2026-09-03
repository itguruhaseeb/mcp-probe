// JSON Schema and metadata linting for MCP tool definitions.
//
// MCP tools declare an `inputSchema` that is a JSON Schema object (draft 2020-12
// in practice, though servers vary). Clients and LLMs rely on that schema to
// construct valid tool calls, so a malformed schema is a real correctness bug.
// These checks catch the mistakes we see most often in the wild without pulling
// in a full JSON Schema validator.
//
// Every finding carries a stable `id` alongside its human-readable `message`.
// The id is the public contract: it is what `--json` consumers filter on, what
// counts a rule's hits across a corpus, and what a SARIF `ruleId` maps to.
// Messages are free to be reworded; ids are not. Renaming one is a breaking
// change, the same as changing an exit code.

const VALID_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

// Severity levels, ordered.
export const FAIL = 'fail';
export const WARN = 'warn';

/**
 * Every rule this linter can emit, keyed by its stable id.
 *
 * This registry is the source of truth. A test asserts the id set against a
 * literal list, so adding or removing a rule is a deliberate act rather than
 * something that happens by accident in a refactor.
 */
export const RULES = Object.freeze({
  // Tool descriptor rules.
  'tool/missing-name': { severity: FAIL, summary: 'tool has no name' },
  'tool/missing-description': { severity: WARN, summary: 'tool has no description' },
  'tool/missing-title': { severity: WARN, summary: 'tool has no title' },
  'tool/no-safety-hints': { severity: WARN, summary: 'tool declares no safety annotations' },

  // inputSchema rules.
  'schema/missing': { severity: FAIL, summary: 'inputSchema is absent' },
  'schema/not-an-object': { severity: FAIL, summary: 'inputSchema is not a JSON object' },
  'schema/no-type': { severity: WARN, summary: 'root schema declares no type' },
  'schema/invalid-type': { severity: FAIL, summary: 'type is not a valid JSON Schema type' },
  'schema/type-not-a-string': { severity: FAIL, summary: 'type is neither a string nor an array of strings' },
  'schema/non-object-root': { severity: WARN, summary: 'root schema type is not object' },
  'schema/properties-not-an-object': { severity: FAIL, summary: 'properties is not an object' },
  'schema/property-not-a-schema': { severity: FAIL, summary: 'a property value is not a schema object' },
  'schema/required-not-an-array': { severity: FAIL, summary: 'required is not an array' },
  'schema/required-non-string': { severity: FAIL, summary: 'required contains a non-string entry' },
  'schema/required-duplicate': { severity: WARN, summary: 'required lists the same key twice' },
  'schema/required-not-in-properties': { severity: FAIL, summary: 'required names a key absent from properties' },
  'schema/required-without-properties': { severity: FAIL, summary: 'required is set but properties is absent' },
  'schema/empty-contract': { severity: WARN, summary: 'object schema declares no properties' },
});

/** Stable, sorted list of every rule id. */
export const RULE_IDS = Object.freeze(Object.keys(RULES).sort());

function issue(id, severity, message) {
  // A typo in an id would silently produce an unfilterable finding, which is
  // exactly the failure mode ids exist to prevent. Catch it at the source.
  if (!Object.prototype.hasOwnProperty.call(RULES, id)) {
    throw new Error(`unknown lint rule id "${id}" (add it to RULES in src/linter.js)`);
  }
  return { id, severity, message };
}

/**
 * Lint a single JSON Schema object (an MCP inputSchema).
 * Returns an array of { id, severity, message } issues. Empty means clean.
 *
 * `path` is a human-readable prefix for nested reporting (e.g. "properties.foo").
 */
export function lintSchema(schema, path = 'inputSchema') {
  const issues = [];

  if (schema === undefined || schema === null) {
    issues.push(issue('schema/missing', FAIL, `${path} is missing`));
    return issues;
  }
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    issues.push(
      issue('schema/not-an-object', FAIL, `${path} must be a JSON object, got ${describe(schema)}`)
    );
    return issues;
  }

  // `type` is not strictly required by JSON Schema, but MCP input schemas
  // should be objects. A missing type on the root is worth a warning.
  const type = schema.type;
  if (type === undefined) {
    if (path === 'inputSchema') {
      issues.push(issue('schema/no-type', WARN, `${path} has no "type" (expected "object")`));
    }
  } else if (typeof type === 'string') {
    if (!VALID_TYPES.has(type)) {
      issues.push(
        issue('schema/invalid-type', FAIL, `${path}.type "${type}" is not a valid JSON Schema type`)
      );
    }
    if (path === 'inputSchema' && type !== 'object') {
      issues.push(
        issue(
          'schema/non-object-root',
          WARN,
          `${path}.type is "${type}"; MCP input schemas are conventionally objects`
        )
      );
    }
  } else if (Array.isArray(type)) {
    for (const t of type) {
      if (!VALID_TYPES.has(t)) {
        issues.push(
          issue('schema/invalid-type', FAIL, `${path}.type contains invalid entry "${t}"`)
        );
      }
    }
  } else {
    issues.push(
      issue('schema/type-not-a-string', FAIL, `${path}.type must be a string or array of strings`)
    );
  }

  // properties must be an object-of-schemas when present.
  const props = schema.properties;
  let propKeys = [];
  if (props !== undefined) {
    if (typeof props !== 'object' || Array.isArray(props) || props === null) {
      issues.push(
        issue('schema/properties-not-an-object', FAIL, `${path}.properties must be an object`)
      );
    } else {
      propKeys = Object.keys(props);
      for (const key of propKeys) {
        const sub = props[key];
        if (typeof sub !== 'object' || sub === null || Array.isArray(sub)) {
          issues.push(
            issue(
              'schema/property-not-a-schema',
              FAIL,
              `${path}.properties.${key} must be a schema object`
            )
          );
          continue;
        }
        // Recurse one level for object/array property schemas.
        for (const sublint of lintSchema(sub, `${path}.properties.${key}`)) {
          // Downgrade the "no type" root-only rule; nested is only warned when clearly wrong.
          issues.push(sublint);
        }
        if (sub.description === undefined && sub.type !== 'object') {
          // Missing per-property descriptions hurt LLM tool use but are common;
          // keep this quiet to avoid noise. Intentionally not reported.
        }
      }
    }
  }

  // required[] must be an array of strings that all exist in properties.
  const required = schema.required;
  if (required !== undefined) {
    if (!Array.isArray(required)) {
      issues.push(issue('schema/required-not-an-array', FAIL, `${path}.required must be an array`));
    } else {
      const seen = new Set();
      for (const r of required) {
        if (typeof r !== 'string') {
          issues.push(
            issue('schema/required-non-string', FAIL, `${path}.required contains a non-string entry`)
          );
          continue;
        }
        if (seen.has(r)) {
          issues.push(
            issue('schema/required-duplicate', WARN, `${path}.required lists "${r}" more than once`)
          );
        }
        seen.add(r);
        if (props !== undefined && !propKeys.includes(r)) {
          issues.push(
            issue(
              'schema/required-not-in-properties',
              FAIL,
              `${path}.required references "${r}" which is not in properties`
            )
          );
        }
      }
      if (required.length > 0 && props === undefined) {
        issues.push(
          issue(
            'schema/required-without-properties',
            FAIL,
            `${path}.required is set but there are no properties to require`
          )
        );
      }
    }
  }

  // An object schema with neither properties nor a permissive marker is an
  // empty contract. Common but worth flagging on the root.
  if (
    path === 'inputSchema' &&
    (type === 'object' || type === undefined) &&
    props === undefined &&
    schema.additionalProperties === undefined
  ) {
    issues.push(
      issue(
        'schema/empty-contract',
        WARN,
        `${path} declares no properties (tool takes no structured input)`
      )
    );
  }

  return issues;
}

/**
 * Lint a full MCP tool descriptor: { name, description, inputSchema, ... }.
 * Returns { name, issues, fails, warns }.
 */
export function lintTool(tool) {
  const issues = [];
  const name = typeof tool?.name === 'string' ? tool.name : '(unnamed)';

  if (typeof tool?.name !== 'string' || tool.name.trim() === '') {
    issues.push(issue('tool/missing-name', FAIL, 'tool is missing a "name"'));
  }

  if (typeof tool?.description !== 'string' || tool.description.trim() === '') {
    issues.push(
      issue(
        'tool/missing-description',
        WARN,
        'tool has no "description" (LLMs rely on it to choose the tool)'
      )
    );
  }

  // `title` is an optional human-facing label in recent MCP revisions.
  if (tool?.title === undefined && tool?.annotations?.title === undefined) {
    issues.push(issue('tool/missing-title', WARN, 'tool has no "title" annotation'));
  }

  // Safety hints (2025-03-26 revision): readOnlyHint / destructiveHint /
  // idempotentHint / openWorldHint tell a client whether a tool has side
  // effects BEFORE it is invoked. Warn when none of them is declared.
  const ann = tool?.annotations;
  const hasSafetyHint = ann !== undefined && ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']
    .some((h) => ann[h] !== undefined);
  if (!hasSafetyHint) {
    issues.push(
      issue(
        'tool/no-safety-hints',
        WARN,
        'tool declares no safety hints (readOnlyHint/destructiveHint/idempotentHint/openWorldHint)'
      )
    );
  }

  issues.push(...lintSchema(tool?.inputSchema, 'inputSchema'));

  return {
    name,
    issues,
    fails: issues.filter((i) => i.severity === FAIL).length,
    warns: issues.filter((i) => i.severity === WARN).length,
  };
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Decide whether a tool can be safely round-tripped with empty/minimal args.
 * A tool is "safe to call" for our purposes when it has no required parameters,
 * so we never fabricate values. Returns { safe: boolean, args: object }.
 */
export function safeCallArgs(tool) {
  const schema = tool?.inputSchema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.length === 0) {
    return { safe: true, args: {} };
  }
  return { safe: false, args: null };
}
