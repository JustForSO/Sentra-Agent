import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import logger from '../../logger/index.js';

function readServersConfig(configPath = path.resolve(process.cwd(), 'mcp', 'servers.json')) {
  if (!fs.existsSync(configPath)) return [];
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) return [];
    return json;
  } catch (e) {
    logger.error('Failed to read mcp/servers.json', { error: String(e) });
    return [];
  }
}

export class MCPExternalManager {
  constructor() {
    this.clients = new Map(); // id -> { client, meta }
  }

  async connectAll() {
    const defs = readServersConfig();
    if (defs.length) {
      logger.info('外部 MCP 连接开始', { label: 'MCP', count: defs.length });
    }
    for (const def of defs) {
      try {
        await this.connect(def);
      } catch (e) {
        logger.warn('External MCP connect failed', { label: 'MCP', id: def?.id, error: String(e) });
      }
    }
    if (defs.length) {
      logger.info('外部 MCP 连接完成', { label: 'MCP', connected: this.clients.size });
    }
  }

  async connect(def) {
    const { id, type, command, args = [], url } = def;
    if (!id) throw new Error('External MCP server missing id');

    let transport;
    if (type === 'stdio') {
      if (!command) throw new Error(`MCP server ${id} stdio requires command`);
      transport = new StdioClientTransport({ command, args });
    } else if (type === 'websocket') {
      if (!url) throw new Error(`MCP server ${id} websocket requires url`);
      transport = new WebSocketClientTransport({ url });
    } else {
      throw new Error(`Unsupported MCP server type: ${type}`);
    }

    const client = new Client({ name: 'sentra-mcp-client', version: '0.1.0' });
    await client.connect(transport);
    this.clients.set(id, { client, meta: def });
    logger.info('Connected external MCP server', { label: 'MCP', id, type });
  }

  async listAllTools() {
    const result = [];
    for (const [id, { client }] of this.clients.entries()) {
      try {
        const r = await client.listTools();
        const tools = r.tools || [];
        for (const t of tools) {
          result.push({ ...t, __provider: `external:${id}` });
        }
      } catch (e) {
        logger.error('listTools failed for external server', { label: 'MCP', id, error: String(e) });
      }
    }
    if (this.clients.size) {
      logger.info('外部 MCP 工具列举完成', { label: 'MCP', servers: this.clients.size, tools: result.length });
    }
    return result;
  }

  async callTool(serverId, name, args) {
    const entry = this.clients.get(serverId);
    if (!entry) throw new Error(`External server not connected: ${serverId}`);
    const { client } = entry;
    return client.callTool({ name, arguments: args });
  }
}

export default MCPExternalManager;
