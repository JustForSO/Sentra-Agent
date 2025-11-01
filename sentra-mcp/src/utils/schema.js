import Ajv from 'ajv';

// Simple per-process validator cache by schema signature
const ajv = new Ajv({
  allErrors: true,
  coerceTypes: true,
  useDefaults: true,
  removeAdditional: false,
  strict: false,
});

// Keep a weak map if schema objects are reused; fall back to stringified key
const compiled = new Map();

function schemaKey(schema) {
  try { return JSON.stringify(schema); } catch { return String(schema); }
}

function shallowPickSchemaProps(schema = {}, data = {}) {
  try {
    const props = Object.keys((schema.properties || {}));
    if (!props.length || typeof data !== 'object' || data == null) return { ...data };
    const out = {};
    for (const k of Object.keys(data)) if (props.includes(k)) out[k] = data[k];
    return out;
  } catch {
    return { ...data };
  }
}

export function validateAndRepairArgs(schema = {}, args = {}) {
  const key = schemaKey(schema);
  let validate = compiled.get(key);
  if (!validate) {
    try {
      validate = ajv.compile(schema || { type: 'object' });
      compiled.set(key, validate);
    } catch (e) {
      // If schema can't compile, treat as pass-through
      return { valid: true, output: args, errors: [] };
    }
  }
  // 1) prune extras to reduce accidental noise
  const candidate = shallowPickSchemaProps(schema, args);
  // 2) run validation with coercion & defaults (mutates candidate)
  const data = JSON.parse(JSON.stringify(candidate)); // deep clone to avoid mutating callers
  const ok = validate(data);
  return { valid: !!ok, output: data, errors: validate.errors || [] };
}
