import { config } from '../../config/index.js';

// 中文：仅保留必填字段的 schema 视图，供“规划期清单展示”，避免上下文噪音
export function requiredOnlySchema(schema = {}) {
  try {
    const props = schema.properties || {};
    const req = Array.isArray(schema.required) ? schema.required : [];
    const picked = {};
    for (const k of req) {
      if (props[k] != null) picked[k] = props[k];
      else picked[k] = {}; // 保留占位，提示为必填
    }
    return {
      type: 'object',
      properties: picked,
      required: req,
      additionalProperties: schema.additionalProperties !== undefined ? schema.additionalProperties : true,
    };
  } catch {
    return { type: 'object', properties: {}, required: [], additionalProperties: true };
  }
}

// 中文：将“工具上下文”组织为 system 文本，供预思考阶段使用（避免一次性传入过多 schema 细节导致 token 暴涨）
export function buildToolContextSystem(manifest = []) {
  const maxDescLen = 140;
  const lines = ['可用工具上下文（仅概要）：'];
  for (const m of manifest) {
    const req = Array.isArray(m?.inputSchema?.required) ? m.inputSchema.required : [];
    let desc = String(m.description || '');
    if (desc.length > maxDescLen) desc = desc.slice(0, maxDescLen) + ` ..(+${desc.length - maxDescLen})`;
    lines.push(`- ${m.name} (${m.aiName}) | required: [${req.join(', ')}] | ${desc}`);
  }
  return lines.join('\n');
}

// 中文：构造“规划期”使用的工具清单（只展示必填字段的 schema）
export function buildPlanningManifest(mcpcore) {
  const tools = mcpcore.getAvailableTools();
  return tools.map((t) => ({
    aiName: t.aiName,
    name: t.name,
    description: t.description || '',
    inputSchema: requiredOnlySchema(t.inputSchema || {}),
    meta: t.meta || {},
  }));
}

// 中文：将 manifest 渲染为简洁的项目符号文本（仅显示必填字段名）
export function manifestToBulletedText(manifest = []) {
  const lines = [];
  for (const m of manifest) {
    const req = Array.isArray(m?.inputSchema?.required) ? m.inputSchema.required : [];
    lines.push(`- aiName: ${m.aiName} | name: ${m.name} | required: [${req.join(', ')}]`);
    if (m.description) lines.push(`  描述: ${m.description}`);
  }
  return lines.join('\n');
}

// 中文：将“必填字段”的类型与枚举约束输出为易读文本，帮助模型严格遵循 schema
export function summarizeRequiredFieldsDetail(schema = {}) {
  try {
    const req = Array.isArray(schema.required) ? schema.required : [];
    const props = schema.properties || {};
    const out = [];
    for (const k of req) {
      const p = props[k] || {};
      const t = p.type ? String(p.type) : 'any';
      let extra = '';
      if (Array.isArray(p.enum) && p.enum.length) {
        extra += ` | enum: [${p.enum.join(', ')}]`;
      }
      out.push(`- ${k}: type=${t}${extra}`);
    }
    return out.join('\n');
  } catch {
    return '';
  }
}
