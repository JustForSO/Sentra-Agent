import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('EmotionService');

class EmotionService {
  constructor() {
    this.enabled = !!config.emotion?.enabled;
    this.baseUrl = (config.emotion?.apiBaseUrl || '').replace(/\/$/, '');
    this.path = config.emotion?.analyzePath || '/analyze';
    this.timeout = Number(config.emotion?.timeout) || 10000;
    this.minLen = Number(config.emotion?.minTextLength) || 8;
  }

  isEnabled() { return this.enabled && !!this.baseUrl; }

  async analyzeText(text) {
    try {
      const content = String(text || '').trim();
      if (!this.isEnabled()) {
        return this._empty();
      }
      if (!content || content.length < this.minLen) {
        return this._empty();
      }

      const url = `${this.baseUrl}${this.path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
        signal: controller.signal
      }).catch(err => { throw new Error(`请求失败: ${err.message}`); });
      clearTimeout(timer);

      if (!resp.ok) {
        const msg = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${resp.statusText} ${msg}`);
      }

      const data = await resp.json();
      return this._normalize(data);
    } catch (error) {
      logger.warn('情绪分析失败，返回空结果', { error: error.message });
      return this._empty();
    }
  }

  _normalize(apiData) {
    const sentiment = {
      label: apiData?.sentiment?.label || null,
      scores: {
        negative: Number(apiData?.sentiment?.scores?.negative) || 0,
        positive: Number(apiData?.sentiment?.scores?.positive) || 0,
        neutral: Number(apiData?.sentiment?.scores?.neutral) || 0
      }
    };

    const rawEmos = Array.isArray(apiData?.emotions) ? apiData.emotions : [];
    const sorted = rawEmos
      .map(e => ({ label: String(e?.label || '').trim(), score: Number(e?.score) || 0 }))
      .filter(e => e.label)
      .sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, 8);

    const vad = {
      valence: Number(apiData?.vad?.valence),
      arousal: Number(apiData?.vad?.arousal),
      dominance: Number(apiData?.vad?.dominance)
    };

    const stress = {
      score: Number(apiData?.stress?.score) || 0,
      level: apiData?.stress?.level || null
    };

    return {
      sentiment,
      emotions: top,
      emotion_labels: top.map(e => e.label),
      emotion_values: top.map(e => e.score),
      vad,
      stress
    };
  }

  _empty() {
    return {
      sentiment: { label: null, scores: { negative: 0, positive: 0, neutral: 0 } },
      emotions: [],
      emotion_labels: [],
      emotion_values: [],
      vad: { valence: null, arousal: null, dominance: null },
      stress: { score: 0, level: null }
    };
  }
}

const emotionService = new EmotionService();
export default emotionService;
