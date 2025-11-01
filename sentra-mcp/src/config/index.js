import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// 获取当前模块的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量（从 sentra-mcp 目录）
const mcpRootDir = path.resolve(__dirname, '../..');
const envPath = path.join(mcpRootDir, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // 如果 sentra-mcp/.env 不存在，尝试加载父目录的 .env
  dotenv.config();
}

const bool = (v, d = false) => {
  if (v === undefined) return d;
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// Parse simple comma-separated strings to string array
function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Parse overrides from env: keys like PREFIX__SOME_KEY=2 -> { 'SOME_KEY': 2 }
function parseConcurrencyOverrides(prefix) {
  const out = {};
  const pfx = String(prefix || '').toUpperCase();
  for (const [k, v] of Object.entries(process.env)) {
    if (!k || !k.toUpperCase().startsWith(pfx + '__')) continue;
    const name = k.substring((pfx + '__').length);
    const num = int(v, NaN);
    if (name && Number.isFinite(num)) out[name] = num;
  }
  return out;
}

export const config = {
  llm: {
    baseURL: process.env.OPENAI_BASE_URL || 'https://yuanplus.cloud/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.OPENAI_TEMPERATURE || 0.2),
    maxTokens: int(process.env.OPENAI_MAX_TOKENS, 4096),
    toolChoice: process.env.OPENAI_TOOL_CHOICE || 'auto',
    toolStrategy: (process.env.TOOL_STRATEGY || 'auto').toLowerCase(),
  },
  // Run-level repair / diversification controls
  runner: {
    maxRepairs: int(process.env.RUN_MAX_REPAIRS, 1),
    retryDiversify: bool(process.env.RETRY_DIVERSIFY, true),
  },
  // 专用于 FC (<function_call>) 模式下的提供商配置；未设置时回退到 llm 配置
  fcLlm: {
    baseURL: process.env.FC_BASE_URL || process.env.OPENAI_BASE_URL || 'https://yuanplus.cloud/v1',
    apiKey: process.env.FC_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.FC_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.FC_TEMPERATURE || process.env.OPENAI_TEMPERATURE || 0.2),
    maxTokens: int(process.env.FC_MAX_TOKENS, -1), // -1 表示省略 max_tokens
    format: (process.env.FC_FORMAT || 'sentra').toLowerCase(),
    planMaxRetries: int(process.env.FC_PLAN_MAX_RETRIES, 3),
    argMaxRetries: int(process.env.FC_ARG_MAX_RETRIES, 3),
    evalMaxRetries: int(process.env.FC_EVAL_MAX_RETRIES, 3),
    summaryMaxRetries: int(process.env.FC_SUMMARY_MAX_RETRIES, 3),
    // Stage-specific sampling controls (optional; fall back to temperature/top_p defaults)
    planTemperature: Number(process.env.FC_PLAN_TEMPERATURE || 'NaN'),
    planTopP: Number(process.env.FC_PLAN_TOP_P || 'NaN'),
    evalTemperature: Number(process.env.FC_EVAL_TEMPERATURE || 'NaN'),
    evalTopP: Number(process.env.FC_EVAL_TOP_P || 'NaN'),
    summaryTemperature: Number(process.env.FC_SUMMARY_TEMPERATURE || 'NaN'),
    summaryTopP: Number(process.env.FC_SUMMARY_TOP_P || 'NaN'),
  },
  // 向量嵌入模型配置（默认复用 OPENAI_*，也可单独配置）
  embedding: {
    baseURL: process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://yuanplus.cloud/v1',
    apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  },
  // 记忆系统配置（启用后将把规划/工具调用摘要落库到 Redis，并支持相似检索）
  memory: {
    enable: bool(process.env.MEM_ENABLE, false),
    namespace: process.env.MEM_NAMESPACE || 'sentra-mcp',
    prefix: process.env.MEM_PREFIX || 'sentra:mcp:mem',
    topK: int(process.env.MEM_TOP_K, 5),
    toolTopK: int(process.env.MEM_TOOL_TOP_K, 3),
    minScore: Number(process.env.MEM_MIN_SCORE || 0.7),
    candidatePool: int(process.env.MEM_CANDIDATE_POOL, 200),
    onlySuccessful: bool(process.env.MEM_ONLY_SUCCESSFUL, true),
    // 高相似度复用参数：>= reuseThreshold 直接复用历史参数，跳过 LLM 参生
    enableReuse: bool(process.env.MEM_ENABLE_REUSE, true),
    reuseThreshold: Number(process.env.MEM_REUSE_THRESHOLD || 0.97),
    // RediSearch HNSW 向量索引
    enableRediSearch: bool(process.env.MEM_ENABLE_REDISEARCH, false),
    rsIndex: process.env.MEM_RS_INDEX || 'mem_idx',
    rsDim: int(process.env.MEM_RS_DIM, 0),
    rsDistance: process.env.MEM_RS_DISTANCE || 'COSINE', // COSINE | L2 | IP
    rsM: int(process.env.MEM_RS_M, 16),
    rsEfConstruction: int(process.env.MEM_RS_EF_CONSTRUCTION, 200),
    rsEfRuntime: int(process.env.MEM_RS_EF_RUNTIME, 200),
  },
  summarizer: {
    baseURL: process.env.SUMMARIZER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://yuanplus.cloud/v1',
    apiKey: process.env.SUMMARIZER_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.SUMMARIZER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.SUMMARIZER_TEMPERATURE || 0.1),
  },
  // 工具候选重排序（ReRank）配置
  rerank: {
    enable: !(String(process.env.RERANK_ENABLE || 'true').toLowerCase() === 'false'),
    baseURL: process.env.RERANK_BASE_URL || '',
    apiKey: process.env.RERANK_API_KEY || '',
    model: process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3',
    candidateK: int(process.env.RERANK_CANDIDATE_K, 50),
    topN: int(process.env.RERANK_TOP_N, 12),
    useDescFallback: String(process.env.RERANK_USE_DESC_FALLBACK || 'false').toLowerCase() === 'true',
    timeoutMs: int(process.env.RERANK_TIMEOUT_MS, 12000),
    maxSubqueries: int(process.env.RERANK_MAX_SUBQUERIES, 5),
    aggAlpha: Number(process.env.RERANK_AGG_ALPHA || 0.1),  // frequency weight
    aggBeta: Number(process.env.RERANK_AGG_BETA || 0.5),   // score weight
    aggGamma: Number(process.env.RERANK_AGG_GAMMA || 0.4), // reciprocal rank weight
  },
  // 工具调用判定模型（在计划与执行前判断是否需要调用工具）
  judge: {
    baseURL: process.env.JUDGE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://yuanplus.cloud/v1',
    apiKey: process.env.JUDGE_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.JUDGE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.JUDGE_TEMPERATURE || 0.1),
    maxTokens: int(process.env.JUDGE_MAX_TOKENS, -1),
  },
  // 中文：思考/预推演专用模型（与工具调用的 LLM 分离，避免相互覆盖）
  reasoner: {
    baseURL: process.env.REASONER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://yuanplus.cloud/v1',
    apiKey: process.env.REASONER_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.REASONER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.REASONER_TEMPERATURE || process.env.OPENAI_TEMPERATURE || 0.2),
    // -1 或未设置表示“不限制/由服务端决定”，调用时将省略 max_tokens
    maxTokens: int(process.env.REASONER_MAX_TOKENS, -1),
  },
  planner: {
    maxSteps: int(process.env.PLAN_MAX_STEPS, 8),
    maxConcurrency: int(process.env.PLAN_MAX_CONCURRENCY, 3),
    totalTimeBudgetMs: int(process.env.PLAN_TOTAL_TIME_BUDGET_MS, 60000),
    toolTimeoutMs: int(process.env.TOOL_TIMEOUT_MS, 15000),
    cooldownDefaultMs: int(process.env.TOOL_COOLDOWN_DEFAULT_MS, 2000),
    // Multi-plan generation controls
    multiEnable: bool(process.env.PLAN_MULTI_ENABLE, false),
    multiCandidates: int(process.env.PLAN_MULTI_CANDIDATES, 1),
    // Plan audit controls
    auditEnable: bool(process.env.PLAN_AUDIT_ENABLE, true),
    auditVoters: int(process.env.PLAN_AUDIT_VOTERS, 1),
    // Per-tool/provider concurrency
    toolConcurrencyDefault: int(process.env.PLANNER_TOOL_CONCURRENCY_DEFAULT, 1),
    providerConcurrencyDefault: int(process.env.PLANNER_PROVIDER_CONCURRENCY_DEFAULT, 4),
    toolConcurrency: parseConcurrencyOverrides('PLANNER_TOOL_CONCURRENCY'),
    providerConcurrency: parseConcurrencyOverrides('PLANNER_PROVIDER_CONCURRENCY'),
    // Call-level cooldown retry (prefer 0 to let scheduler handle delayed rescheduling)
    cooldownFunctionRetry: int(process.env.TOOL_COOLDOWN_FUNC_RETRY, 0),
    // Tool result cache: aiName + args hash -> result (success only)
    toolCache: {
      enable: bool(process.env.TOOL_CACHE_ENABLE, false),
      ttlSeconds: int(process.env.TOOL_CACHE_TTL_SEC, 600),
      allowlist: parseCsv(process.env.TOOL_CACHE_ALLOWLIST), // empty means no restriction
      denylist: parseCsv(process.env.TOOL_CACHE_DENYLIST),
    },
  },
  governance: {
    defaultScope: process.env.DEFAULT_SCOPE || 'global',
    defaultTenantId: process.env.DEFAULT_TENANT_ID || 'default',
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: int(process.env.REDIS_PORT, 6379),
    db: int(process.env.REDIS_DB, 0),
    password: process.env.REDIS_PASSWORD || undefined,
    metricsPrefix: process.env.REDIS_METRICS_PREFIX || 'sentra:mcp:metrics',
    contextPrefix: process.env.REDIS_CONTEXT_PREFIX || 'sentra:mcp:ctx',
  },
  server: {
    transport: (process.env.MCP_SERVER_TRANSPORT || 'stdio').toLowerCase(),
    httpPort: int(process.env.HTTP_PORT, 3000),
    allowedHosts: (process.env.ALLOWED_HOSTS || '127.0.0.1,localhost')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  flags: {
    enableToolStreaming: bool(process.env.ENABLE_TOOL_STREAMING, false),
    enableHistorySummary: bool(process.env.ENABLE_HISTORY_SUMMARY, true),
    historySummaryTrigger: int(process.env.HISTORY_SUMMARY_TRIGGER, 8000),
    enableVerboseSteps: bool(process.env.ENABLE_VERBOSE_STEPS, false),
    verbosePreviewMax: int(process.env.VERBOSE_PREVIEW_MAX, 400),
    // Context summarization controls for step argument generation
    contextMaxDepth: int(process.env.CONTEXT_MAX_DEPTH, 2),
    contextStringMax: int(process.env.CONTEXT_STRING_MAX, 160),
    contextPreviewKeys: int(process.env.CONTEXT_PREVIEW_KEYS, 8),
    contextPreviewArrayItems: int(process.env.CONTEXT_PREVIEW_ARRAY_ITEMS, 3),
    recentContextLimit: int(process.env.RECENT_CONTEXT_LIMIT, 5),
    // Evaluation & retry controls
    evalRetryOnFail: bool(process.env.EVAL_RETRY_ON_FAIL, true),
    evalMaxRetries: int(process.env.EVAL_MAX_RETRIES, 1),
    // Whether to inject preThought into evaluation/summarizer stages
    evalUsePreThought: bool(process.env.EVAL_USE_PRETHOUGHT, false),
    summaryUsePreThought: bool(process.env.SUMMARY_USE_PRETHOUGHT, false),
    // Whether to run preThought in planning stages (native & FC)
    planUsePreThought: bool(process.env.PLAN_USE_PRETHOUGHT, false),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
    // Console display options
    timestampLocal: bool(process.env.LOG_TIMESTAMP_LOCAL, true),
    colorMeta: bool(process.env.LOG_COLOR_META, true),
    dimMeta: bool(process.env.LOG_DIM_META, false),
    prettyLabels: (process.env.LOG_PRETTY_LABELS || 'PLAN,PLAN_STEP,STEP,ARGS,RESULT,PLUGIN,REDIS,MCP,RUN,EVAL,RETRY')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

export default config;
