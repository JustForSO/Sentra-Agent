// SDK entry: simple function-call API for plan-then-execute with streaming
// Consumers can import SentraMcpSDK and use runOnce() or stream()

import MCPCore from '../mcpcore/index.js';
import { planThenExecute, planThenExecuteStream } from '../agent/planners.js';
import fs from 'node:fs/promises';
import path from 'node:path';

function toMarkdownCatalog(items = []) {
  const lines = ['# Sentra MCP 工具清单', '', `**可用工具总数**: ${items.length}`, '---', ''];
  for (const t of items) {
    lines.push(`### ${t.name} (${t.aiName})`);
    
    if (t.meta?.realWorldAction) {
      lines.push(`**映射真实能力**: ${t.meta.realWorldAction}`);
    }
    
    lines.push(`**描述**: ${t.description || '(无描述)'}`);
    lines.push(`**提供者**: ${t.provider}${t.serverId ? ` | serverId: ${t.serverId}` : ''}`);
    
    const req = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required.join(', ') : '(无)';
    lines.push(`**必填参数**: ${req}`);
    
    lines.push(`**冷却(ms)**: ${t.cooldownMs}ms | **超时**: ${t.timeoutMs}ms`);
    
    // 元信息
    if (t.meta && Object.keys(t.meta).length) {
      if (t.meta.responseStyle) {
        lines.push(`**回复格式**: ${t.meta.responseStyle}`);
      }
      if (t.meta.responseExample) {
        lines.push('**示例回复**:');
        const ex = String(t.meta.responseExample).split('\n').map((l) => `  ${l}`);
        lines.push(...ex);
      }
    }
    
    lines.push('');
  }
  return lines.join('\n');
}
/**
 * Sentra SDK wrapper
 *
 * Usage:
 *   const sdk = new SentraMcpSDK();
 *   await sdk.init();
 *   const res = await sdk.runOnce({ objective, conversation, context });
 *   for await (const ev of sdk.stream({ objective, conversation, context })) { ... }
 */
export class SentraMcpSDK {
  /**
   * @param {{ mcpcore?: MCPCore }} [options]
   */
  constructor(options = {}) {
    this.mcpcore = options.mcpcore || new MCPCore();
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    await this.mcpcore.init();
    this._initialized = true;
  }

  /**
   * Run plan-then-execute once and return the final result.
   * @param {{ objective: string, conversation?: Array<{role:string,content:any}>, context?: object, overlays?: Record<string, any>, promptOverlays?: Record<string, any> }} params
   * overlays/promptOverlays: per-stage system overlays, e.g. { global: '...', plan: '...', emit_plan: '...', judge: '...', arggen: '...', final_judge: '...', final_summary: '...' }
   * @returns {Promise<import('../utils/result.js').Result>}
   */
  async runOnce({ objective, conversation, context = {}, overlays, promptOverlays }) {
    await this.init();
    const ov = promptOverlays || overlays;
    const ctx = ov ? { ...context, promptOverlays: { ...(context.promptOverlays || {}), ...ov } } : context;
    return planThenExecute({ objective, context: ctx, mcpcore: this.mcpcore, conversation });
  }

  /**
   * List available tools.
   * @param {{ detailed?: boolean }} [opts]
   * @returns {Promise<Array<object>>}
   */
  async listTools(opts = {}) {
    await this.init();
    const detailed = opts.detailed !== false;
    return detailed ? this.mcpcore.getAvailableToolsDetailed() : this.mcpcore.getAvailableTools();
  }

  /**
   * Export available tools to JSON or Markdown.
   * If outputPath is provided, writes to disk; otherwise returns content.
   * @param {{ format?: 'json'|'md'|'markdown', outputPath?: string, pretty?: number }} [opts]
   */
  async exportTools(opts = {}) {
    await this.init();
    const format = (opts.format || 'json').toLowerCase();
    const pretty = Number.isFinite(opts.pretty) ? Number(opts.pretty) : 2;
    const items = this.mcpcore.getAvailableToolsDetailed();
    let content;
    if (format === 'json') {
      content = JSON.stringify(items, null, pretty);
    } else if (format === 'md' || format === 'markdown') {
      content = toMarkdownCatalog(items);
    } else {
      throw new Error(`Unsupported format: ${opts.format}`);
    }
    if (opts.outputPath) {
      const abs = path.resolve(String(opts.outputPath));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
      return { outputPath: abs, count: items.length };
    }
    return { content, count: items.length };
  }

  /**
   * Stream events for a run as an async iterator.
   * @param {{ objective: string, conversation?: Array<{role:string,content:any}>, context?: object, overlays?: Record<string, any>, promptOverlays?: Record<string, any> }} params
   * @returns {AsyncIterable<any>}
   */
  stream({ objective, conversation, context = {}, overlays, promptOverlays }) {
    const self = this;
    async function* gen() {
      await self.init();
      const ov = promptOverlays || overlays;
      const ctx = ov ? { ...context, promptOverlays: { ...(context.promptOverlays || {}), ...ov } } : context;
      for await (const ev of planThenExecuteStream({ objective, context: ctx, mcpcore: self.mcpcore, conversation })) {
        yield ev;
      }
    }
    return gen();
  }

  /**
   * Stream with callback helper. Returns controller with stop() and a completion promise.
   * Note: stop() only stops event consumption; the underlying run will continue to finish.
   * @param {{ objective: string, conversation?: Array<{role:string,content:any}>, context?: object, overlays?: Record<string, any>, promptOverlays?: Record<string, any>, onEvent: (ev:any)=>void }} params
   */
  async streamWithCallback({ objective, conversation, context = {}, overlays, promptOverlays, onEvent }) {
    await this.init();
    let stopped = false;
    const done = (async () => {
      try {
        const ov = promptOverlays || overlays;
        const ctx = ov ? { ...context, promptOverlays: { ...(context.promptOverlays || {}), ...ov } } : context;
        for await (const ev of planThenExecuteStream({ objective, context: ctx, mcpcore: this.mcpcore, conversation })) {
          if (stopped) break;
          try { onEvent?.(ev); } catch {}
        }
      } catch (e) {
        // surface errors via rejection so callers can await .done
        throw e;
      }
    })();
    return {
      stop() { stopped = true; },
      done,
    };
  }
}

export default SentraMcpSDK;