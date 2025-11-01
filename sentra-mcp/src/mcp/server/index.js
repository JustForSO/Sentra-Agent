import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import logger from '../../logger/index.js';
import MCPCore from '../../mcpcore/index.js';
import { Metrics } from '../../metrics/index.js';

const mcpcore = new MCPCore();

// Some SDK versions may not export isInitializeRequest; define a minimal local predicate
function isInitialize(body) {
  return body && typeof body === 'object' && body.method === 'initialize';
}

function mapToolToSpec(t) {
  // Map MCPCore tool entry to MCP Tool schema
  return {
    name: t.aiName, // expose aiName to avoid collisions
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
    annotations: {
      scope: t.scope || 'global',
      tenant: t.tenant || 'default',
      provider: t.provider || t.providerType || 'local',
      cooldownMs: t.cooldownMs || 0,
    },
  };
}

function toCallToolResult(res) {
  if (res?.success) {
    const data = res.data ?? null;
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return {
      content: [{ type: 'text', text }],
      structuredContent: res,
      isError: false,
    };
  }
  const err = res?.error || { message: 'Unknown error' };
  const msg = err.message || String(err);
  return {
    content: [{ type: 'text', text: `Error: ${msg}` }],
    structuredContent: res,
    isError: true,
  };
}

async function buildServer() {
  await mcpcore.init();

  const server = new Server(
    { name: 'sentra-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = mcpcore.getAvailableTools().map(mapToolToSpec);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request?.params?.name;
    const args = request?.params?.arguments ?? {};
    if (!name) throw new Error('Missing tool name');
    const result = await mcpcore.callByAIName(name, args, { source: 'mcp' });
    return toCallToolResult(result);
  });

  return server;
}

async function startstdio() {
  const server = await buildServer();
  const transport = new StdioServerTransport();
  logger.info('Starting MCP server on stdio');
  await server.connect(transport);
}

async function starthttp() {
  // Dynamic import to avoid hard dependency on SDK versions without Streamable HTTP
  let StreamableHTTPServerTransport;
  try {
    ({ StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js'));
  } catch (e) {
    logger.error('Streamable HTTP transport not available in current SDK. Try upgrading @modelcontextprotocol/sdk or set MCP_SERVER_TRANSPORT=stdio.', { error: String(e) });
    process.exit(1);
  }
  const app = express();
  app.use(express.json());
  app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'], allowedHeaders: ['Content-Type', 'mcp-session-id'] }));

  // sessions
  const transports = {};

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitialize(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
        // enableDnsRebindingProtection: true,
        // allowedHosts: config.server.allowedHosts,
      });

      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };

      const server = await buildServer();
      await server.connect(transport);
    } else {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req, res) => {
    const sid = req.headers['mcp-session-id'];
    if (!sid || !transports[sid]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sid].handleRequest(req, res);
  };

  app.get('/mcp', handleSessionRequest);
  app.delete('/mcp', handleSessionRequest);

  // Optional metrics endpoints (not part of MCP spec)
  app.get('/metrics/summary', async (req, res) => {
    try {
      const tool = String(req.query.tool || 'echo');
      const provider = String(req.query.provider || 'local');
      const s = await Metrics.getSummary(tool, provider);
      res.json({ success: true, data: s });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });

  const port = config.server.httpPort;
  app.listen(port, () => logger.info(`MCP server (Streamable HTTP) listening on :${port}`));
}

if (config.server.transport === 'stdio') {
  startstdio().catch((e) => {
    logger.error('Failed to start stdio server', { error: String(e) });
    process.exit(1);
  });
} else if (config.server.transport === 'http') {
  starthttp().catch((e) => {
    logger.error('Failed to start http server', { error: String(e) });
    process.exit(1);
  });
} else {
  logger.error('Unknown MCP_SERVER_TRANSPORT, expected stdio|http', { transport: config.server.transport });
  process.exit(1);
}
