// Function-call fallback utilities: parse <sentra-tools> blocks and build instructions
// Prompts are loaded from JSON under src/agent/prompts/ via loader.
import { loadPrompt, renderTemplate } from '../agent/prompts/loader.js';

/**
 * Extract <function_call> ... </function_call> blocks from text and parse to calls
 * Returns array of { name: string, arguments: any }
 * - Accepts shapes: { name, arguments } | { function: { name, arguments } } | { function_call: { name, arguments } }
 */
export function parseFunctionCalls(text = '', opts = {}) {
  if (!text || typeof text !== 'string') return [];
  // Relaxed <sentra-tools> matching: allow spaces/dashes/underscores and attributes, case-insensitive
  const reSentra = /<\s*sentra[-_\s]*tools\b[^>]*>([\s\S]*?)<\s*\/\s*sentra[-_\s]*tools\s*>/gi;
  const out = [];
  let m;
  while ((m = reSentra.exec(text)) !== null) {
    const raw = (m[1] || '').trim();
    const call = parseSentraBlock(raw);
    if (call) out.push(call);
  }
  return out;
}

/**
 * Build instruction text to ask the model to emit a single <function_call> block for a given function
 */
export async function buildFunctionCallInstruction({ name, parameters, locale = 'zh-CN' } = {}) {
  const prettySchema = parameters ? JSON.stringify(parameters, null, 2) : '{}';
  const req = Array.isArray(parameters?.required) ? parameters.required : [];
  const reqHintZh = req.length ? `- 必须包含必填字段: ${req.join(', ')}` : '- 如 schema 未列出必填字段：仅包含必要字段，避免冗余';
  const reqHintEn = req.length ? `- Must include required fields: ${req.join(', ')}` : '- If no required fields: include only necessary fields, avoid extras';
  const pf = await loadPrompt('fc_function_sentra');
  const tpl = String(locale).toLowerCase().startsWith('zh') ? pf.zh : pf.en;
  const vars = {
    name,
    schema: prettySchema,
    req_hint: String(locale).toLowerCase().startsWith('zh') ? reqHintZh : reqHintEn,
  };
  return renderTemplate(tpl, vars);
}

/**
 * Build planning instruction to emit emit_plan function call with plan schema and allowed tool names.
 */
export async function buildPlanFunctionCallInstruction({ allowedAiNames = [], locale = 'zh-CN' } = {}) {
  const allow = Array.isArray(allowedAiNames) && allowedAiNames.length ? allowedAiNames.join(', ') : '(无)';
  const hasAllow = Array.isArray(allowedAiNames) && allowedAiNames.length > 0;
  const schemaHint = JSON.stringify({
    plan: {
      overview: 'string (可选)',
      steps: [
        {
          aiName: 'string (必须在允许列表中)',
          reason: 'string',
          nextStep: 'string',
          draftArgs: { '...': '...' },
          dependsOn: ['number 索引数组，可省略']
        }
      ]
    }
  }, null, 2);
  const pf = await loadPrompt('fc_plan_sentra');
  const tpl = String(locale).toLowerCase().startsWith('zh') ? pf.zh : pf.en;
  const vars = {
    allowed_list: allow,
    require_line: hasAllow
      ? (String(locale).toLowerCase().startsWith('zh') ? '- 允许列表非空：steps 至少包含 1 步；若无法直接完成，请选择最接近的工具用于信息收集/授权/诊断等前置步骤。' : '- When allowed tools exist: include at least 1 step; if direct completion is not possible, pick the closest tool to gather info/request authorization/diagnose.')
      : (String(locale).toLowerCase().startsWith('zh') ? '- 若确无合适工具，可输出空 steps 数组。' : '- If truly no tool fits, you may output an empty steps array.'),
    schema_hint: schemaHint,
  };
  return renderTemplate(tpl, vars);
}

/**
 * Build policy text describing usage & constraints for function_call markers.
 */
export async function buildFCPolicy({ locale = 'zh-CN' } = {}) {
  const pf = await loadPrompt('fc_policy_sentra');
  const tpl = String(locale).toLowerCase().startsWith('zh') ? pf.zh : pf.en;
  return renderTemplate(tpl, { tag: '<sentra-tools>' });
}

function safeParseJson(s) {
  if (typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch {
    // naive fallback: try best-effort extract from first { to last }
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      const t = s.slice(i, j + 1);
      try { return JSON.parse(t); } catch {}
    }
  }
  return null;
}

// Parse a <sentra-tools> ReAct block into { name, arguments }
function parseSentraBlock(raw) {
  if (!raw) return null;
  const withoutFences = stripCodeFences(raw);
  // Allow Chinese colon, varying spaces/cases
  const mName = withoutFences.match(/^\s*Action\s*[:：]\s*(.+)$/mi);
  if (!mName) return null;
  const name = String(mName[1] || '').trim();
  // Find start of Action Input
  const reInput = /^\s*Action\s*[-_]*\s*Input\s*[:：]\s*/mi;
  const mi = withoutFences.match(reInput);
  if (!mi) return null;
  const idx = withoutFences.search(reInput);
  const start = idx + mi[0].length;
  const jsonText = String(withoutFences.slice(start)).trim();
  const args = (typeof jsonText === 'string') ? safeParseJson(jsonText) : null;
  if (!args || typeof args !== 'object') return null;
  return { name, arguments: args };
}

function stripCodeFences(s) {
  const t = String(s || '').trim();
  if (t.startsWith('```')) {
    // remove starting fence line
    const firstNl = t.indexOf('\n');
    if (firstNl >= 0) {
      const rest = t.slice(firstNl + 1);
      // remove ending fence if present
      const endIdx = rest.lastIndexOf('```');
      return endIdx >= 0 ? rest.slice(0, endIdx).trim() : rest.trim();
    }
  }
  return t;
}

export default { parseFunctionCalls, buildFunctionCallInstruction, buildPlanFunctionCallInstruction, buildFCPolicy };
