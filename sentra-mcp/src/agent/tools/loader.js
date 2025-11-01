import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Load a tool definition (.tool.json) and its JSON schema, then override the tool's parameters with the schema.
 * Paths are resolved relative to baseDir. If a schemaPath is not provided, will try to resolve from tool.parameters.$ref.
 * mutateSchema(schema) can be provided to inject runtime constraints (e.g., enum for aiName).
 */
export async function loadToolDef({ baseDir, toolPath, schemaPath, mutateSchema, fallbackTool, fallbackSchema }) {
  const resolveFrom = (p) => path.isAbsolute(p) ? p : path.resolve(baseDir, p);
  let toolDef = fallbackTool || null;
  let schemaDef = fallbackSchema || null;

  try {
    if (toolPath) {
      const rawTool = await fs.readFile(resolveFrom(toolPath), 'utf-8');
      toolDef = JSON.parse(rawTool);
    }
  } catch {}

  try {
    if (schemaPath) {
      const rawSchema = await fs.readFile(resolveFrom(schemaPath), 'utf-8');
      schemaDef = JSON.parse(rawSchema);
    } else if (toolDef?.function?.parameters?.$ref) {
      const ref = String(toolDef.function.parameters.$ref);
      const toolAbs = resolveFrom(toolPath || baseDir);
      const base = toolPath ? path.dirname(toolAbs) : baseDir;
      const refAbs = path.isAbsolute(ref) ? ref : path.resolve(base, ref);
      const rawSchema2 = await fs.readFile(refAbs, 'utf-8');
      schemaDef = JSON.parse(rawSchema2);
    }
  } catch {}

  if (!toolDef) {
    toolDef = { type: 'function', function: { name: 'unknown_tool', description: '', parameters: schemaDef || { type: 'object', properties: {} } } };
  }
  if (!schemaDef) {
    schemaDef = toolDef?.function?.parameters || { type: 'object', properties: {} };
  }

  try { if (typeof mutateSchema === 'function') mutateSchema(schemaDef); } catch {}
  try { if (toolDef?.function) toolDef.function.parameters = schemaDef; } catch {}
  return toolDef;
}

export default { loadToolDef };
