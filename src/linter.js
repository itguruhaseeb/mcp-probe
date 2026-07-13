// JSON Schema and metadata linting for MCP tool definitions.
//
// MCP tools declare an `inputSchema` that is a JSON Schema object (draft 2020-12
// in practice, though servers vary). Clients and LLMs rely on that schema to
// construct valid tool calls, so a malformed schema is a real correctness bug.
// These checks catch the mistakes we see most often in the wild without pulling
// in a full JSON Schema validator.

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

function issue(severity, message) {
  return { severity, message };
}

/**
 * Lint a single JSON Schema object (an MCP inputSchema).
 * Returns an array of { severity, message } issues. Empty means clean.
 *
 * `path` is a human-readable prefix for nested reporting (e.g. "properties.foo").
 */
export function lintSchema(schema, path = 'inputSchema') {
  const issues = [];

  if (schema === undefined || schema === null) {
    issues.push(issue(FAIL, `${path} is missing`));
    return issues;
  }
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    issues.push(issue(FAIL, `${path} must be a JSON object, got ${describe(schema)}`));
    return issues;
  }

  // `type` is not strictly required by JSON Schema, but MCP input schemas
  // should be objects. A missing type on the root is worth a warning.
  const type = schema.type;
  if (type === undefined) {
    if (path === 'inputSchema') {
      issues.push(issue(WARN, `${path} has no "type" (expected "object")`));
    }
  } else if (typeof type === 'string') {
    if (!VALID_TYPES.has(type)) {
      issues.push(issue(FAIL, `${path}.type "${type}" is not a valid JSON Schema type`));
    }
    if (path === 'inputSchema' && type !== 'object') {
      issues.push(
        issue(WARN, `${path}.type is "${type}"; MCP input schemas are conventionally objects`)
      );
    }
  } else if (Array.isArray(type)) {
    for (const t of type) {
      if (!VALID_TYPES.has(t)) {
        issues.push(issue(FAIL, `${path}.type contains invalid entry "${t}"`));
      }
    }
  } else {
    issues.push(issue(FAIL, `${path}.type must be a string or array of strings`));
  }

  // properties must be an object-of-schemas when present.
  const props = schema.properties;
  let propKeys = [];
  if (props !== undefined) {
    if (typeof props !== 'object' || Array.isArray(props) || props === null) {
      issues.push(issue(FAIL, `${path}.properties must be an object`));
    } else {
      propKeys = Object.keys(props);
      for (const key of propKeys) {
        const sub = props[key];
        if (typeof sub !== 'object' || sub === null || Array.isArray(sub)) {
          issues.push(issue(FAIL, `${path}.properties.${key} must be a schema object`));
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
      issues.push(issue(FAIL, `${path}.required must be an array`));
    } else {
      const seen = new Set();
      for (const r of required) {
        if (typeof r !== 'string') {
          issues.push(issue(FAIL, `${path}.required contains a non-string entry`));
          continue;
        }
        if (seen.has(r)) {
          issues.push(issue(WARN, `${path}.required lists "${r}" more than once`));
        }
        seen.add(r);
        if (props !== undefined && !propKeys.includes(r)) {
          issues.push(
            issue(FAIL, `${path}.required references "${r}" which is not in properties`)
          );
        }
      }
      if (required.length > 0 && props === undefined) {
        issues.push(
          issue(FAIL, `${path}.required is set but there are no properties to require`)
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
      issue(WARN, `${path} declares no properties (tool takes no structured input)`)
    );
  }

  return issues;
}

/**
 * Lint a full MCP tool descriptor: { name, description, inputSchema, ... }.
 * Returns { name, issues, schemaIssueCount, ... }.
 */
export function lintTool(tool) {
  const issues = [];
  const name = typeof tool?.name === 'string' ? tool.name : '(unnamed)';

  if (typeof tool?.name !== 'string' || tool.name.trim() === '') {
    issues.push(issue(FAIL, 'tool is missing a "name"'));
  }

  if (typeof tool?.description !== 'string' || tool.description.trim() === '') {
    issues.push(issue(WARN, 'tool has no "description" (LLMs rely on it to choose the tool)'));
  }

  // `title` is an optional human-facing label in recent MCP revisions.
  if (tool?.title === undefined && tool?.annotations?.title === undefined) {
    issues.push(issue(WARN, 'tool has no "title" annotation'));
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
