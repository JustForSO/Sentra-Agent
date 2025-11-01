import { DateTime } from 'luxon';
import { parse } from 'chrono-node';
import RecognizersDateTime from '@microsoft/recognizers-text-date-time';
import RecognizersSuite from '@microsoft/recognizers-text-suite';

// Simple sleep
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

// 时间解析工具类（参考用户提供的实现风格）
export class TimeParser {
  constructor(config = {}) {
    this.windowConfig = {
      strategy: 'auto', // auto | natural-only | adaptive-only
      preferRecognizerRange: true, // Microsoft 识别到区间时优先使用
      naturalGrains: ['day', 'week', 'month', 'year'],
      adapt: {
        base: 0.1,              // 最小比例
        range: 0.4,             // 变化幅度
        scale: 20,              // 时间差对窗口的影响尺度（越大越平缓）
        minFraction: 0.05,      // 半窗口的最小占比（相对粒度单位）
        confidenceWeight: 0.3   // 置信度对窗口的缩放权重（越大置信度越缩小）
      },
      caps: {
        minMs: 0,               // 窗口最小值（毫秒，0 表示不限定）
        maxMs: null             // 窗口最大值（毫秒，null 表示不限定）
      }
    };
    if (config && typeof config === 'object') {
      this.windowConfig = this._mergeDeep({}, this.windowConfig, config);
    }
  }

  setWindowConfig(partial = {}) {
    this.windowConfig = this._mergeDeep({}, this.windowConfig, partial);
  }

  getEffectiveConfig(overrides = {}) {
    return this._mergeDeep({}, this.windowConfig, overrides || {});
  }

  _mergeDeep(target, ...sources) {
    const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
    for (const src of sources) {
      if (!isObj(src)) continue;
      for (const [k, v] of Object.entries(src)) {
        if (isObj(v)) {
          if (!isObj(target[k])) target[k] = {};
          this._mergeDeep(target[k], v);
        } else if (Array.isArray(v)) {
          target[k] = v.slice();
        } else {
          target[k] = v;
        }
      }
    }
    return target;
  }

  buildEffectiveWindow(targetDt, nowDt, meta = {}, cfg = this.windowConfig) {
    const tz = meta.timezone || targetDt.zoneName || 'UTC';
    const target = targetDt.setZone(tz);
    const now = nowDt.setZone(tz);
    const timeDiff = Math.abs(target.toMillis() - now.toMillis());

    const preferRange = cfg?.preferRecognizerRange !== false;
    if (preferRange && meta.source === 'microsoft' && meta.primary) {
      const p = meta.primary;
      if (p.start && p.end && !/X/.test(p.start) && !/X/.test(p.end)) {
        const startDt = this.parseISOWithZone(p.start, tz);
        const endDt = this.parseISOWithZone(p.end, tz);
        if (startDt.isValid && endDt.isValid) {
          return this._windowPayload(startDt, endDt, timeDiff, 'range');
        }
      }
    }

    const grain = meta.source === 'microsoft'
      ? this.determineGrainFromMicrosoftPrimary(meta.primary)
      : this.determineGrainFromChrono(meta.chronoResult);

    const naturalSet = cfg?.naturalGrains || ['day', 'week', 'month', 'year'];
    const strategy = cfg?.strategy || 'auto';
    if (strategy !== 'adaptive-only' && naturalSet.includes(grain)) {
      const startDt = target.startOf(grain);
      let endDt;
      switch (grain) {
        case 'day':
          endDt = startDt.plus({ days: 1 });
          break;
        case 'week':
          endDt = startDt.plus({ weeks: 1 });
          break;
        case 'month':
          endDt = startDt.plus({ months: 1 });
          break;
        case 'year':
        default:
          endDt = startDt.plus({ years: 1 });
          break;
      }
      return this._windowPayload(startDt, endDt, timeDiff, `natural-${grain}`);
    }

    const unitMs = this.getUnitMsForGrain(grain);
    const halfWidthMs = this.computeAdaptiveHalfWidth(unitMs, timeDiff, meta?.confidence ?? 0.8, cfg);
    const startDt = target.minus({ milliseconds: halfWidthMs });
    const endDt = target.plus({ milliseconds: halfWidthMs });
    return this._windowPayload(startDt, endDt, timeDiff, `adaptive-${grain}`);
  }

  _windowPayload(startDt, endDt, timeDiff, kind) {
    return {
      kind,
      windowStart: startDt.toMillis(),
      windowEnd: endDt.toMillis(),
      windowSize: endDt.toMillis() - startDt.toMillis(),
      timeDiff
    };
  }

  parseISOWithZone(isoText, zone) {
    let dt = DateTime.fromISO(isoText, { zone });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(isoText, 'yyyy-MM-dd HH:mm:ss', { zone });
      if (!dt.isValid) dt = DateTime.fromFormat(isoText, 'yyyy-MM-dd', { zone });
    }
    return dt;
  }

  determineGrainFromMicrosoftPrimary(primary = {}) {
    const timex = primary.timex || '';
    const type = primary.type || '';
    if (/T\d{2}:\d{2}:\d{2}/.test(timex)) return 'second';
    if (/T\d{2}:\d{2}/.test(timex)) return 'minute';
    if (/T\d{2}/.test(timex) || /time/i.test(type)) return 'hour';
    if (/^\d{4}-W\d{2}/.test(timex)) return 'week';
    if (/^\d{4}-\d{2}-\d{2}$/.test(timex) || /date/i.test(type)) return 'day';
    if (/^\d{4}-\d{2}$/.test(timex)) return 'month';
    if (/^\d{4}$/.test(timex)) return 'year';
    if (primary.start && primary.end) return 'day';
    return 'hour';
  }

  determineGrainFromChrono(result = {}) {
    try {
      const comp = result.start;
      if (comp && typeof comp.isCertain === 'function') {
        if (comp.isCertain('second')) return 'second';
        if (comp.isCertain('minute')) return 'minute';
        if (comp.isCertain('hour')) return 'hour';
        if (comp.isCertain('day')) return 'day';
        if (comp.isCertain('month')) return 'month';
        if (comp.isCertain('year')) return 'year';
      }
    } catch {}
    try {
      const d = result.start?.date?.();
      if (d) {
        if (d.getSeconds() !== 0) return 'second';
        if (d.getMinutes() !== 0) return 'minute';
        if (d.getHours() !== 0) return 'hour';
      }
    } catch {}
    return 'day';
  }

  getUnitMsForGrain(grain) {
    switch (grain) {
      case 'second': return 1000;
      case 'minute': return 60 * 1000;
      case 'hour': return 60 * 60 * 1000;
      case 'day': return 24 * 60 * 60 * 1000;
      case 'week': return 7 * 24 * 60 * 60 * 1000;
      case 'month': return 30 * 24 * 60 * 60 * 1000; // approx
      case 'year': return 365 * 24 * 60 * 60 * 1000; // approx
      default: return 60 * 60 * 1000;
    }
  }

  computeAdaptiveHalfWidth(unitMs, timeDiff, confidence = 0.8, cfg = this.windowConfig) {
    const baseHalf = unitMs / 2;
    const base = cfg?.adapt?.base ?? 0.1;
    const range = cfg?.adapt?.range ?? 0.4;
    const scaleParam = cfg?.adapt?.scale ?? 20;
    const minFrac = cfg?.adapt?.minFraction ?? 0.05;
    const confW = cfg?.adapt?.confidenceWeight ?? 0.3;

    const scale = base + range * (1 - Math.exp(- timeDiff / (scaleParam * unitMs)));
    const confFactor = Math.max(0.5, Math.min(1.2, 1 - confW * (confidence - 0.5)));
    let half = baseHalf * scale * confFactor;

    const minHalf = unitMs * minFrac;
    half = Math.max(half, minHalf);

    const maxMs = cfg?.caps?.maxMs;
    if (typeof maxMs === 'number' && maxMs > 0) {
      half = Math.min(half, maxMs / 2);
    }
    const minMs = cfg?.caps?.minMs;
    if (typeof minMs === 'number' && minMs > 0) {
      half = Math.max(half, minMs / 2);
    }
    return half;
  }

  parseTimeExpression(text, options = {}) {
    const { timezone = 'Asia/Shanghai', language = 'en', windowOptions } = options;
    const cfg = this.getEffectiveConfig(windowOptions);

    const parseStartTime = DateTime.now();

    try {
      const useMicrosoft = typeof language === 'string' && /^(zh|zh-cn|zh_cn|cn)/i.test(language);
      if (useMicrosoft) {
        const chronoStart = DateTime.now();
        const msResults = RecognizersDateTime.recognizeDateTime(text, RecognizersSuite.Culture.Chinese);
        const chronoEnd = DateTime.now();

        if (msResults && msResults.length > 0) {
          const msResult = msResults[0];
          const matchedText = msResult.text || text;
          const values = (msResult.resolution && msResult.resolution.values) || [];

          const primary = values.find(v => v.value && !/X/.test(v.value))
            || values.find(v => v.start && !/X/.test(v.start))
            || values[0];

          if (primary) {
            let isoText = primary.value || primary.start || '';
            let parsedDateTime = DateTime.fromISO(isoText, { zone: timezone });
            if (!parsedDateTime.isValid && isoText) {
              parsedDateTime = DateTime.fromFormat(isoText, 'yyyy-MM-dd HH:mm:ss', { zone: timezone });
              if (!parsedDateTime.isValid) {
                parsedDateTime = DateTime.fromFormat(isoText, 'yyyy-MM-dd', { zone: timezone });
              }
            }

            if (parsedDateTime.isValid) {
              const parseEndTime = DateTime.now();
              const pseudoResult = { text: matchedText, ref: text, start: { isCertain: true } };
              const confidenceVal = this.calculateConfidence(pseudoResult);

              const nowDt = DateTime.now().setZone(timezone);
              const windowInfo = this.buildEffectiveWindow(parsedDateTime, nowDt, {
                source: 'microsoft',
                primary,
                timezone,
                confidence: confidenceVal
              }, cfg);

              return {
                success: true,
                original: text,
                parsed: parsedDateTime.toJSDate(),
                parsedDateTime,
                timezone,
                confidence: confidenceVal,
                method: 'microsoft-recognizers',
                timeExpression: matchedText,
                parseStartTimestamp: parseStartTime.toMillis(),
                parseEndTimestamp: parseEndTime.toMillis(),
                parseDuration: parseEndTime.diff(parseStartTime, 'milliseconds').milliseconds,
                chronoStartTimestamp: chronoStart.toMillis(),
                chronoEndTimestamp: chronoEnd.toMillis(),
                chronoDuration: chronoEnd.diff(chronoStart, 'milliseconds').milliseconds,
                parsedTimestamp: parsedDateTime.toMillis(),
                parsedISO: parsedDateTime.toISO(),
                parsedLocal: parsedDateTime.toLocaleString(DateTime.DATETIME_FULL),
                parsedChinaTime: parsedDateTime.setZone('Asia/Shanghai').toFormat('yyyy-MM-dd HH:mm:ss'),
                windowTimestamps: { start: windowInfo.windowStart, end: windowInfo.windowEnd },
                windowFormatted: {
                  start: DateTime.fromMillis(windowInfo.windowStart).setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss'),
                  end: DateTime.fromMillis(windowInfo.windowEnd).setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss')
                },
                windowMeta: windowInfo,
                parsedDetails: {
                  year: parsedDateTime.year,
                  month: parsedDateTime.month,
                  day: parsedDateTime.day,
                  hours: parsedDateTime.hour,
                  minutes: parsedDateTime.minute,
                  seconds: parsedDateTime.second,
                  milliseconds: parsedDateTime.millisecond,
                  dayOfWeek: parsedDateTime.weekday,
                  timezone: parsedDateTime.zoneName,
                  offset: parsedDateTime.offset
                }
              };
            }
          }
        }
      }

      const chronoStart = DateTime.now();
      const parsed = parse(text, new Date());
      const chronoEnd = DateTime.now();
      const parseEndTime = DateTime.now();

      if (parsed && parsed.length > 0) {
        const result = parsed[0];
        const parsedDateTime = DateTime.fromJSDate(result.start.date());
        const nowDt = DateTime.now().setZone(timezone);
        const confidenceVal = this.calculateConfidence(result);
        const windowInfo = this.buildEffectiveWindow(parsedDateTime, nowDt, {
          source: 'chrono',
          chronoResult: result,
          timezone,
          confidence: confidenceVal
        }, cfg);

        return {
          success: true,
          original: text,
          parsed: parsedDateTime.toJSDate(),
          parsedDateTime,
          timezone,
          confidence: confidenceVal,
          method: 'chrono-node',
          timeExpression: result.text,
          parseStartTimestamp: parseStartTime.toMillis(),
          parseEndTimestamp: parseEndTime.toMillis(),
          parseDuration: parseEndTime.diff(parseStartTime, 'milliseconds').milliseconds,
          chronoStartTimestamp: chronoStart.toMillis(),
          chronoEndTimestamp: chronoEnd.toMillis(),
          chronoDuration: chronoEnd.diff(chronoStart, 'milliseconds').milliseconds,
          parsedTimestamp: parsedDateTime.toMillis(),
          parsedISO: parsedDateTime.toISO(),
          parsedLocal: parsedDateTime.toLocaleString(DateTime.DATETIME_FULL),
          parsedChinaTime: parsedDateTime.setZone('Asia/Shanghai').toFormat('yyyy-MM-dd HH:mm:ss'),
          windowTimestamps: { start: windowInfo.windowStart, end: windowInfo.windowEnd },
          windowFormatted: {
            start: DateTime.fromMillis(windowInfo.windowStart).setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss'),
            end: DateTime.fromMillis(windowInfo.windowEnd).setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss')
          },
          windowMeta: windowInfo,
          parsedDetails: {
            year: parsedDateTime.year,
            month: parsedDateTime.month,
            day: parsedDateTime.day,
            hours: parsedDateTime.hour,
            minutes: parsedDateTime.minute,
            seconds: parsedDateTime.second,
            milliseconds: parsedDateTime.millisecond,
            dayOfWeek: parsedDateTime.weekday,
            timezone: parsedDateTime.zoneName,
            offset: parsedDateTime.offset
          }
        };
      } else {
        const parseEnd = DateTime.now();
        return {
          success: false,
          original: text,
          parseStartTimestamp: parseStartTime.toMillis(),
          parseEndTimestamp: parseEnd.toMillis(),
          parseDuration: parseEnd.diff(parseStartTime, 'milliseconds').milliseconds,
          error: '未找到可识别的时间表达式',
          method: 'chrono-node'
        };
      }
    } catch (error) {
      const currentTime = DateTime.now();
      return {
        success: false,
        original: text,
        parseStartTimestamp: parseStartTime.toMillis(),
        parseEndTimestamp: currentTime.toMillis(),
        parseDuration: currentTime.diff(parseStartTime, 'milliseconds').milliseconds,
        error: error?.message || String(error),
        method: 'chrono-node'
      };
    }
  }

  formatTime(date, format = 'full', timezone = 'UTC') {
    let dt;
    if (date && typeof date.isValid === 'boolean') {
      dt = date.setZone?.(timezone) || date; // Luxon DateTime
    } else if (date instanceof Date) {
      dt = DateTime.fromJSDate(date).setZone(timezone);
    } else if (typeof date === 'number') {
      dt = DateTime.fromMillis(date).setZone(timezone);
    } else if (typeof date === 'string') {
      dt = DateTime.fromISO(date).setZone(timezone);
    } else {
      return '无效时间';
    }

    if (!dt.isValid) return '无效时间';

    switch (format) {
      case 'iso': return dt.toISO();
      case 'date': return dt.toLocaleString(DateTime.DATE_FULL);
      case 'time': return dt.toLocaleString(DateTime.TIME_WITH_SECONDS);
      case 'datetime': return dt.toLocaleString(DateTime.DATETIME_FULL);
      case 'relative': return this.getRelativeTimeString(dt);
      case 'custom': return dt.toFormat('yyyy-MM-dd HH:mm:ss');
      case 'full':
      default: return dt.toLocaleString(DateTime.DATETIME_FULL);
    }
  }

  getRelativeTimeString(date) {
    let dt;
    if (date && typeof date.isValid === 'boolean') {
      dt = date;
    } else if (date instanceof Date) {
      dt = DateTime.fromJSDate(date);
    } else if (typeof date === 'number') {
      dt = DateTime.fromMillis(date);
    } else if (typeof date === 'string') {
      dt = DateTime.fromISO(date);
    } else {
      return '无效时间';
    }

    const now = DateTime.now();
    const diff = dt.diff(now, ['days', 'hours', 'minutes', 'seconds']);

    const diffMinutes = Math.floor(diff.as('minutes'));
    const diffHours = Math.floor(diff.as('hours'));
    const diffDays = Math.floor(diff.as('days'));

    if (Math.abs(diffMinutes) < 1) return '刚刚';
    if (Math.abs(diffMinutes) < 60) return diffMinutes > 0 ? `${diffMinutes}分钟后` : `${Math.abs(diffMinutes)}分钟前`;
    if (Math.abs(diffHours) < 24) return diffHours > 0 ? `${diffHours}小时后` : `${Math.abs(diffHours)}小时前`;
    if (Math.abs(diffDays) < 7) return diffDays > 0 ? `${diffDays}天后` : `${Math.abs(diffDays)}天前`;
    return this.formatTime(dt, 'date');
  }

  calculateConfidence(result) {
    if (!result || !result.start) return 0;
    const matchedText = result.text || '';
    const fullText = result.ref || String(matchedText);
    const matchLength = matchedText.length || 1;
    const totalLength = fullText.length || matchLength;
    const lengthScore = Math.min(matchLength / totalLength, 1);
    const positionScore = fullText.startsWith(matchedText) || fullText.endsWith(matchedText) ? 1 : 0.8;
    const baseConfidence = typeof result.start.isCertain === 'function' ? (result.start.isCertain() ? 0.9 : 0.7) : 0.8;
    return Math.min(baseConfidence * lengthScore * positionScore, 1);
  }

  getParseStats(results) {
    const total = results.length;
    const successful = results.filter(r => r.success).length;
    const failed = total - successful;

    const confidences = results
      .filter(r => r.success && r.confidence !== undefined)
      .map(r => r.confidence);

    const averageConfidence = confidences.length > 0
      ? confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length
      : 0;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      averageConfidence,
      results
    };
  }

  containsTimeExpression(text, options = {}) {
    const { language } = options;
    try {
      if (typeof language === 'string' && /^(zh|zh-cn|zh_cn|cn)/i.test(language)) {
        const res = RecognizersDateTime.recognizeDateTime(text, RecognizersSuite.Culture.Chinese);
        return res && res.length > 0;
      }
      const results = parse(text);
      return results && results.length > 0;
    } catch {
      return false;
    }
  }
}

export const timeParser = new TimeParser();

function detectLanguage(text) {
  if (/[\u4e00-\u9fa5]/.test(String(text || ''))) return 'zh';
  return 'en';
}

// 泛用等待函数：支持字符串或对象形式的 schedule
// schedule: string | { when: string, language?: string, timezone?: string, windowOptions?: object, maxWaitMs?: number, allowPastWindowMs?: number, preferWindowStart?: boolean }
export async function waitForSchedule(schedule, opts = {}) {
  if (!schedule) return { scheduled: false, reason: 'no_schedule' };

  let when = null;
  let language = undefined;
  let timezone = undefined;
  let windowOptions = undefined;
  let maxWaitMs = undefined;
  let allowPastWindowMs = 0;
  let preferWindowStart = true;

  if (typeof schedule === 'string') {
    when = schedule;
    language = detectLanguage(when);
  } else if (typeof schedule === 'object') {
    when = schedule.when || schedule.text || schedule.expression || '';
    language = schedule.language || detectLanguage(when);
    timezone = schedule.timezone;
    windowOptions = schedule.windowOptions;
    maxWaitMs = typeof schedule.maxWaitMs === 'number' ? schedule.maxWaitMs : undefined;
    allowPastWindowMs = typeof schedule.allowPastWindowMs === 'number' ? schedule.allowPastWindowMs : 0;
    preferWindowStart = schedule.preferWindowStart !== false; // default true
  }

  if (!when || typeof when !== 'string') {
    return { scheduled: false, reason: 'invalid_schedule' };
  }

  const parsed = timeParser.parseTimeExpression(when, { language, timezone, windowOptions });
  if (!parsed.success) {
    return { scheduled: false, reason: 'parse_failed', error: parsed.error };
  }

  const now = DateTime.now().setZone(parsed.timezone || timezone || 'local');
  const target = parsed.parsedDateTime?.setZone(parsed.timezone || timezone || now.zoneName) || now;

  // window handling
  const wStart = parsed.windowTimestamps?.start ? DateTime.fromMillis(parsed.windowTimestamps.start).setZone(now.zoneName) : null;
  const wEnd = parsed.windowTimestamps?.end ? DateTime.fromMillis(parsed.windowTimestamps.end).setZone(now.zoneName) : null;

  let runAt = target;
  if (wStart && wEnd) {
    if (now < wStart) {
      runAt = preferWindowStart ? wStart : target;
    } else if (now >= wStart && now <= wEnd) {
      // Already inside window: run immediately
      runAt = now;
    } else if (now > wEnd) {
      if (allowPastWindowMs > 0 && now.toMillis() - wEnd.toMillis() <= allowPastWindowMs) {
        runAt = now; // allow slight delay past the window
      } else {
        return { scheduled: false, reason: 'window_passed', window: { start: wStart.toISO(), end: wEnd.toISO() } };
      }
    }
  }

  const waitMs = Math.max(0, runAt.toMillis() - now.toMillis());
  if (typeof maxWaitMs === 'number' && maxWaitMs >= 0 && waitMs > maxWaitMs) {
    return { scheduled: false, reason: 'exceeds_max_wait', waitMs, maxWaitMs };
  }

  if (waitMs > 0) {
    await sleep(waitMs);
    return { scheduled: true, waitedMs: waitMs, runAt: runAt.toISO(), timezone: runAt.zoneName };
  }
  return { scheduled: true, waitedMs: 0, runAt: runAt.toISO(), timezone: runAt.zoneName };
}
