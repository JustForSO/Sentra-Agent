import neo4j from 'neo4j-driver';
import crypto from 'crypto';
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import embeddingService from '../services/embedding.js';
import emotionService from '../services/emotionService.js';

const logger = createLogger('MessageNeo4j');

/**
 * OpenAI 风格消息数据库（独立库）
 * - 节点：Msg(role: 'user'|'assistant'), Turn(一组user+assistant)
 * - 关系： (t:Turn)-[:HAS_USER]->(u:Msg), (t)-[:HAS_ASSISTANT]->(a:Msg)
 * - 向量索引：assistant 消息 embedding
 */
class MessageNeo4jStorage {
  constructor() {
    this.driver = null;
    this.isConnected = false;
  }

  get cfg() {
    // 若未单独配置，则复用主库连接，仅数据库名默认为 'messages'
    const fallback = config.neo4j || {};
    const msgCfg = config.messageNeo4j || {};
    return {
      uri: msgCfg.uri || fallback.uri,
      username: msgCfg.username || fallback.username,
      password: msgCfg.password || fallback.password,
      database: msgCfg.database || 'messages',
      maxConnectionPoolSize: msgCfg.maxConnectionPoolSize || fallback.maxConnectionPoolSize || 50,
      connectionTimeout: msgCfg.connectionTimeout || fallback.connectionTimeout || 30000
    };
  }

  async initialize() {
    try {
      const cfg = this.cfg;
      logger.info('正在连接到 Message Neo4j 数据库...');
      logger.debug('Message Neo4j 连接参数:', {
        uri: cfg.uri,
        username: cfg.username,
        passwordSet: !!cfg.password,
        database: cfg.database,
        connectionTimeout: cfg.connectionTimeout
      });

      if (!cfg.password) {
        logger.warn('MSG_NEO4J_PASSWORD 未设置，将尝试复用主库密码或匿名连接');
      }

      this.driver = neo4j.driver(
        cfg.uri,
        neo4j.auth.basic(cfg.username, cfg.password || ''),
        {
          maxConnectionPoolSize: cfg.maxConnectionPoolSize,
          connectionTimeout: cfg.connectionTimeout,
          disableLosslessIntegers: true
        }
      );

      await this.driver.verifyConnectivity();
      logger.info('✅ Message Neo4j 连接验证成功');

      await this.createIndexes();
      this.isConnected = true;
      logger.info('✅ Message Neo4j 初始化完成');
    } catch (error) {
      logger.error('❌ Message Neo4j 初始化失败', { error: error.message });
      throw error;
    }
  }

  getSession(database = this.cfg.database) {
    if (!this.isConnected) {
      throw new Error('消息数据库未连接，请先调用 initialize()');
    }
    return this.driver.session({ database });
  }

  async runQuery(query, params = {}) {
    const session = this.getSession();
    try {
      logger.debug('执行消息库查询', { query, params });
      return await session.run(query, params);
    } finally {
      await session.close();
    }
  }

  async ensureVectorIndex(session, { indexName, label, property, dim }) {
    try {
      const show = await session.run('SHOW INDEXES YIELD name, options RETURN name, options');
      const rows = show.records.map(r => ({ name: r.get('name'), options: r.get('options') }));
      const found = rows.find(r => r.name === indexName);
      let currentDim;
      if (found && found.options) {
        try {
          const cfg = found.options.indexConfig || found.options['indexConfig'];
          currentDim = cfg ? (cfg['vector.dimensions'] || cfg['vector.dimensions']) : undefined;
        } catch {}
      }

      if (found && Number.isFinite(currentDim) && Math.trunc(currentDim) === Math.trunc(dim)) {
        logger.info(`✅ 向量索引已存在且维度匹配: ${indexName} (dim=${currentDim})`);
        return;
      }

      if (found) {
        try {
          await session.run(`DROP INDEX ${indexName} IF EXISTS`);
          logger.warn(`🔧 已删除维度不匹配的索引: ${indexName} (was ${currentDim})`);
        } catch (e) {
          logger.warn(`⚠️ 删除索引失败: ${indexName} - ${e.message}`);
        }
      }

      try {
        await session.run(`
          CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
          FOR (m:${label}) ON (m.${property})
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: ${Math.trunc(dim)},
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `);
        logger.info(`✅ 向量索引创建成功: ${indexName} (dim=${dim})`);
      } catch (error1) {
        logger.warn(`⚠️ 无法创建向量索引: ${indexName} - ${error1.message}`);
      }
    } catch (err) {
      logger.warn(`⚠️ ensureVectorIndex 失败: ${indexName} - ${err.message}`);
    }
  }

  async getEmbeddingDimension() {
    try {
      const probe = await embeddingService.getTextEmbedding('dimension_probe');
      const dim = Array.isArray(probe) ? probe.length : (Array.isArray(probe?.[0]) ? probe[0].length : undefined);
      return Number.isFinite(dim) && dim > 0 ? Math.trunc(dim) : 1536;
    } catch {
      return 1536;
    }
  }

  async createIndexes() {
    const session = this.driver.session({ database: this.cfg.database });
    try {
      const basic = [
        'CREATE INDEX IF NOT EXISTS FOR (m:Msg) ON (m.id)',
        'CREATE INDEX IF NOT EXISTS FOR (m:Msg) ON (m.role)',
        'CREATE INDEX IF NOT EXISTS FOR (m:Msg) ON (m.created_at)',
        'CREATE INDEX IF NOT EXISTS FOR (m:Msg) ON (m.group_id)',
        'CREATE INDEX IF NOT EXISTS FOR (m:Msg) ON (m.conversation_id)',
        'CREATE FULLTEXT INDEX msg_text IF NOT EXISTS FOR (m:Msg) ON EACH [m.content_text] ',
        'CREATE INDEX IF NOT EXISTS FOR (t:Turn) ON (t.id)',
        'CREATE INDEX IF NOT EXISTS FOR (t:Turn) ON (t.created_at)',
        'CREATE INDEX IF NOT EXISTS FOR (t:Turn) ON (t.conversation_id)'
      ];
      for (const q of basic) {
        try { await session.run(q); } catch (e) { logger.warn(`索引创建跳过: ${e.message}`); }
      }

      const dim = await this.getEmbeddingDimension();
      await this.ensureVectorIndex(session, {
        indexName: 'assistant_msg_embeddings',
        label: 'Msg',
        property: 'embedding',
        dim
      });
    } finally {
      await session.close();
    }
  }

  async close() {
    if (this.driver) {
      await this.driver.close();
      this.isConnected = false;
      logger.info('🔌 Message Neo4j 连接已关闭');
    }
  }

  /**
   * 保存一组 OpenAI 风格消息，按 user→assistant 成对落库为 Turn
   * @param {Array<{role:string, content:any}>} messages
   * @param {Object} options { conversationId?, userId?, metadata? }
   * @returns {Promise<Array>} 保存的 turn 数组
   */
  async saveOpenAIMessages(messages = [], options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const conversationId = options.conversationId || `conv_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;

    // 简化：仅处理 user/assistant；忽略 system/tool 等
    let lastUser = null;
    const turns = [];

    for (const msg of messages) {
      const role = String(msg.role || '').toLowerCase();
      const content = this._normalizeContent(msg.content);

      if (role === 'user') {
        lastUser = { role: 'user', content, raw: msg.content };
      } else if (role === 'assistant') {
        const userMsg = lastUser; // 绑定最近的 user
        const assistantMsg = { role: 'assistant', content, raw: msg.content };
        const saved = await this._saveTurn(userMsg, assistantMsg, { conversationId, metadata: options.metadata, userId: options.userId });
        turns.push(saved);
        lastUser = null; // 一个 user 对应一个 assistant
      }
    }

    return turns;
  }

  _normalizeContent(content) {
    if (content == null) return { text: '', textLength: 0, rawType: 'null', textForEmbedding: '' };
    if (typeof content === 'string') return { text: content, textLength: content.length, rawType: 'string', textForEmbedding: content };
    // OpenAI 多模态：content 可能是数组
    try {
      if (Array.isArray(content)) {
        const textParts = [];
        for (const part of content) {
          if (typeof part === 'string') textParts.push(part);
          else if (typeof part?.text === 'string') textParts.push(part.text);
          else if (typeof part?.content === 'string') textParts.push(part.content);
        }
        const text = textParts.join('\n');
        return { text, textLength: text.length, rawType: 'array', textForEmbedding: text };
      }
      const text = JSON.stringify(content);
      return { text, textLength: text.length, rawType: 'json', textForEmbedding: text };
    } catch {
      const s = String(content);
      return { text: s, textLength: s.length, rawType: typeof content, textForEmbedding: s };
    }
  }

  async _saveTurn(userMsg, assistantMsg, { conversationId, metadata, userId }) {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();

    // 以 assistant 文本为主做嵌入与情绪
    const aText = assistantMsg?.content?.textForEmbedding || '';
    const embedding = aText ? await embeddingService.getTextEmbedding(aText) : null;
    const emo = aText ? await emotionService.analyzeText(aText) : emotionService._empty();

    const params = {
      // Turn
      turnId,
      conversationId: conversationId || null,
      turnCreatedAt: now.toISOString(),
      turnTimestamp: now.getTime(),
      userId: userId || null,

      // User Msg
      uId: userMsg ? `msg_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}` : null,
      uRole: userMsg ? 'user' : null,
      uText: userMsg?.content?.text || null,
      uTextLen: userMsg?.content?.textLength || null,
      uRawType: userMsg?.content?.rawType || null,
      uCreatedAt: now.toISOString(),

      // Assistant Msg
      aId: `msg_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      aRole: 'assistant',
      aText: assistantMsg?.content?.text || '',
      aTextLen: assistantMsg?.content?.textLength || 0,
      aRawType: assistantMsg?.content?.rawType || null,
      aCreatedAt: now.toISOString(),
      aEmbedding: Array.isArray(embedding) ? embedding : null,

      // 情绪/情感
      sentiment_label: emo?.sentiment?.label ?? null,
      sentiment_positive: Number.isFinite(emo?.sentiment?.scores?.positive) ? emo.sentiment.scores.positive : null,
      sentiment_negative: Number.isFinite(emo?.sentiment?.scores?.negative) ? emo.sentiment.scores.negative : null,
      sentiment_neutral: Number.isFinite(emo?.sentiment?.scores?.neutral) ? emo.sentiment.scores.neutral : null,
      primary_emotion_label: Array.isArray(emo?.emotions) && emo.emotions[0] ? emo.emotions[0].label : null,
      primary_emotion_score: Array.isArray(emo?.emotions) && emo.emotions[0] ? emo.emotions[0].score : null,
      emotion_labels: Array.isArray(emo?.emotion_labels) ? emo.emotion_labels : null,
      emotion_values: Array.isArray(emo?.emotion_values) ? emo.emotion_values : null,
      vad_valence: Number.isFinite(emo?.vad?.valence) ? emo.vad.valence : null,
      vad_arousal: Number.isFinite(emo?.vad?.arousal) ? emo.vad.arousal : null,
      vad_dominance: Number.isFinite(emo?.vad?.dominance) ? emo.vad.dominance : null,
      stress_score: Number.isFinite(emo?.stress?.score) ? emo.stress.score : null,
      stress_level: emo?.stress?.level ?? null,

      // metadata
      uMetadata: userMsg?.raw ? JSON.stringify(userMsg.raw) : null,
      aMetadata: assistantMsg?.raw ? JSON.stringify(assistantMsg.raw) : null,
      turnMetadata: metadata ? JSON.stringify(metadata) : null
    };

    const query = `
      CREATE (t:Turn {
        id: $turnId,
        created_at: datetime($turnCreatedAt),
        timestamp: $turnTimestamp,
        conversation_id: $conversationId,
        user_id: $userId,
        metadata: $turnMetadata
      })
      WITH t
      CALL {
        WITH t
        WITH t WHERE $uId IS NOT NULL
        CREATE (u:Msg {
          id: $uId,
          role: $uRole,
          content_text: $uText,
          content_length: $uTextLen,
          content_type: $uRawType,
          created_at: datetime($uCreatedAt)
        })
        CREATE (t)-[:HAS_USER]->(u)
        RETURN u
      }
      CALL {
        WITH t
        CREATE (a:Msg {
          id: $aId,
          role: $aRole,
          content_text: $aText,
          content_length: $aTextLen,
          content_type: $aRawType,
          created_at: datetime($aCreatedAt),
          embedding: $aEmbedding,
          sentiment_label: $sentiment_label,
          sentiment_positive: $sentiment_positive,
          sentiment_negative: $sentiment_negative,
          sentiment_neutral: $sentiment_neutral,
          primary_emotion_label: $primary_emotion_label,
          primary_emotion_score: $primary_emotion_score,
          emotion_labels: $emotion_labels,
          emotion_values: $emotion_values,
          vad_valence: $vad_valence,
          vad_arousal: $vad_arousal,
          vad_dominance: $vad_dominance,
          stress_score: $stress_score,
          stress_level: $stress_level
        })
        CREATE (t)-[:HAS_ASSISTANT]->(a)
        RETURN a
      }
      RETURN t, $uId as uid, $aId as aid
    `;

    const res = await this.runQuery(query, params);
    const record = res.records[0];
    const t = record.get('t').properties;
    const uid = record.get('uid');
    const aid = record.get('aid');

    // 取出刚创建的消息
    const detail = await this.runQuery(`
      MATCH (t:Turn {id: $turnId})
      OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
      OPTIONAL MATCH (t)-[:HAS_ASSISTANT]->(a:Msg)
      RETURN t,u,a
    `, { turnId });

    const row = detail.records[0];
    return {
      turn: row.get('t')?.properties || t,
      user: row.get('u')?.properties || null,
      assistant: row.get('a')?.properties || null
    };
  }

  /**
   * 按文本检索 assistant 消息并返回成对的 Turn
   * 支持可选过滤：userId 与 conversationId
   */
  async searchAssistantByText(queryText, { limit = 10, threshold = 0.7, userId = null, conversationId = null } = {}) {
    const embedding = await embeddingService.getTextEmbedding(queryText);
    try {
      const res = await this.runQuery(`
        CALL db.index.vector.queryNodes('assistant_msg_embeddings', $limit, $embedding)
        YIELD node, score
        MATCH (node)<-[:HAS_ASSISTANT]-(t:Turn)
        WHERE score >= $threshold
          AND ($userId IS NULL OR t.user_id = $userId)
          AND ($conversationId IS NULL OR t.conversation_id = $conversationId)
        OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
        RETURN node AS a, t, u, score
        ORDER BY score DESC
      `, {
        limit: neo4j.int(Math.trunc(limit)),
        embedding,
        threshold,
        userId,
        conversationId
      });

      return res.records.map(r => ({
        score: r.get('score'),
        turn: r.get('t')?.properties,
        assistant: r.get('a')?.properties,
        user: r.get('u')?.properties || null
      }));
    } catch (error) {
      // 回退：在 JS 层计算余弦相似度
      const where = [
        'a.embedding IS NOT NULL',
        userId ? 't.user_id = $userId' : null,
        conversationId ? 't.conversation_id = $conversationId' : null
      ].filter(Boolean).join(' AND ');

      const q = `
        MATCH (t:Turn)-[:HAS_ASSISTANT]->(a:Msg)
        ${where ? 'WHERE ' + where : ''}
        OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
        RETURN t, a, u
        LIMIT 2000
      `;
      const res = await this.runQuery(q, { userId, conversationId });
      const rows = res.records.map(r => ({
        t: r.get('t')?.properties,
        a: r.get('a')?.properties,
        u: r.get('u')?.properties || null
      })).filter(x => Array.isArray(x.a?.embedding));

      const scored = rows.map(x => ({
        score: this.cosineSimilarity(embedding, x.a.embedding),
        turn: x.t,
        assistant: x.a,
        user: x.u
      })).filter(x => x.score >= threshold);

      scored.sort((p, q) => q.score - p.score);
      return scored.slice(0, Math.max(1, Math.trunc(limit)));
    }
  }

  /** 列出会话的所有 Turn（按时间倒序） */
  async getConversationTurns(conversationId, { limit = 100 } = {}) {
    const res = await this.runQuery(`
      MATCH (t:Turn {conversation_id: $cid})
      OPTIONAL MATCH (t)-[:HAS_ASSISTANT]->(a:Msg)
      OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
      RETURN t,a,u
      ORDER BY t.timestamp DESC
      LIMIT $limit
    `, { cid: conversationId, limit: neo4j.int(Math.trunc(limit)) });
    return res.records.map(r => ({
      turn: r.get('t')?.properties,
      assistant: r.get('a')?.properties,
      user: r.get('u')?.properties || null
    }));
  }

  /** 最近的若干 Turn */
  async listRecentTurns({ limit = 50 } = {}) {
    const res = await this.runQuery(`
      MATCH (t:Turn)
      OPTIONAL MATCH (t)-[:HAS_ASSISTANT]->(a:Msg)
      OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
      RETURN t,a,u
      ORDER BY t.timestamp DESC
      LIMIT $limit
    `, { limit: neo4j.int(Math.trunc(limit)) });
    return res.records.map(r => ({
      turn: r.get('t')?.properties,
      assistant: r.get('a')?.properties,
      user: r.get('u')?.properties || null
    }));
  }

  /**
   * 按 userId 获取会话 Turn（可选限定 conversationId），倒序
   */
  async getUserTurns(userId, { limit = 100, conversationId = null } = {}) {
    const res = await this.runQuery(`
      MATCH (t:Turn)
      WHERE t.user_id = $userId
        AND ($conversationId IS NULL OR t.conversation_id = $conversationId)
      OPTIONAL MATCH (t)-[:HAS_ASSISTANT]->(a:Msg)
      OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
      RETURN t,a,u
      ORDER BY t.timestamp DESC
      LIMIT $limit
    `, { userId, conversationId, limit: neo4j.int(Math.trunc(limit)) });
    return res.records.map(r => ({
      turn: r.get('t')?.properties,
      assistant: r.get('a')?.properties,
      user: r.get('u')?.properties || null
    }));
  }

  /**
   * 全文检索消息（默认仅 assistant，可选 role='user'|'assistant'|'both'）
   * 返回匹配消息 m，以及所在 turn 的成对消息
   */
  async searchMessagesByText(keyword, { role = 'assistant', userId = null, conversationId = null, limit = 10 } = {}) {
    const q = String(keyword || '').trim();
    if (!q) return [];
    const roleNorm = ['assistant', 'user', 'both'].includes(String(role)) ? String(role) : 'assistant';

    const res = await this.runQuery(`
      CALL db.index.fulltext.queryNodes('msg_text', $q) YIELD node, score
      WHERE ($role = 'both' OR node.role = $role)
      OPTIONAL MATCH (t1:Turn)-[:HAS_ASSISTANT]->(node)
      OPTIONAL MATCH (t2:Turn)-[:HAS_USER]->(node)
      WITH node, score, coalesce(t1, t2) AS t
      WHERE t IS NOT NULL
        AND ($userId IS NULL OR t.user_id = $userId)
        AND ($conversationId IS NULL OR t.conversation_id = $conversationId)
      OPTIONAL MATCH (t)-[:HAS_ASSISTANT]->(a:Msg)
      OPTIONAL MATCH (t)-[:HAS_USER]->(u:Msg)
      RETURN t, a, u, node AS m, score
      ORDER BY score DESC
      LIMIT $limit
    `, {
      q,
      role: roleNorm,
      userId,
      conversationId,
      limit: neo4j.int(Math.trunc(limit))
    });

    return res.records.map(r => ({
      score: r.get('score'),
      turn: r.get('t')?.properties,
      assistant: r.get('a')?.properties,
      user: r.get('u')?.properties || null,
      matched: r.get('m')?.properties
    }));
  }

  /** 消息库统计信息 */
  async getStats() {
    const stats = {};
    const q1 = await this.runQuery('MATCH (m:Msg) RETURN count(m) as messages');
    const q2 = await this.runQuery("MATCH (m:Msg {role:'assistant'}) RETURN count(m) as assistant");
    const q3 = await this.runQuery("MATCH (m:Msg {role:'user'}) RETURN count(m) as users");
    const q4 = await this.runQuery('MATCH (t:Turn) RETURN count(t) as turns');
    const num = v => (v && typeof v.toNumber === 'function') ? v.toNumber() : Number(v || 0);
    stats.messages = num(q1.records[0]?.get('messages'));
    stats.assistant = num(q2.records[0]?.get('assistant'));
    stats.users = num(q3.records[0]?.get('users'));
    stats.turns = num(q4.records[0]?.get('turns'));
    return stats;
  }
}

const messageStorage = new MessageNeo4jStorage();
export default messageStorage;
