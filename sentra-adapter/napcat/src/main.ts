import 'dotenv/config';
import createSDK from './sdk';
import { createLogger } from './logger';
import { formatEventCompact, isMeaningfulMessage } from './events';
import type { MessageEvent } from './types/onebot';
import { loadConfig } from './config';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as https from 'https';

const log = createLogger(process.env.LOG_LEVEL as any || 'info');

async function main() {
  const cfg = loadConfig();
  const mode = cfg.connectMode;
  const isReverse = mode === 'reverse';

  log.info({ mode }, '启动配置');

  const sdk = createSDK();

  // 连接成功
  sdk.on.open(async () => {
    log.info('✅ 已连接到 NapCat');
    if (isReverse) {
      log.info(
        {
          port: cfg.reversePort,
          path: cfg.reversePath,
        },
        '反向 WS 服务器已启动'
      );
    } else {
      log.info({ url: cfg.wsUrl }, '正向 WS 已连接');
    }

    // 启动消息流服务（如果启用）
    if (sdk.stream) {
      try {
        await sdk.stream.start();
        log.info({ port: cfg.streamPort }, '✅ 消息流服务已启动');
      } catch (err) {
        log.error({ err }, '消息流服务启动失败');
      }
    }
  });

  // 监听所有消息（记录日志）
  sdk.on.message(async (ev) => {
    const summaryMode = (process.env.EVENT_SUMMARY || 'debug').toLowerCase();
    const line = formatEventCompact(ev, { withColor: true });
    if (summaryMode === 'always') {
      log.info(line);
    } else if (summaryMode === 'debug' && process.env.LOG_LEVEL === 'debug') {
      log.debug(line);
    }

    const meaningful = isMeaningfulMessage(ev as MessageEvent);
    if (!meaningful) {
      if (process.env.LOG_LEVEL === 'debug') {
        log.warn({ message_id: (ev as any).message_id }, '跳过推送：无有效内容');
      }
      return;
    }

    // 获取引用上下文（用于日志和流推送）
    let replyContext: any = undefined;
    const hasReply = Array.isArray((ev as any).message) && (ev as MessageEvent).message.some((s: any) => s.type === 'reply');
    if (hasReply) {
      try {
        replyContext = await (sdk as any).utils.getReplyContext(ev as MessageEvent);
        if (summaryMode === 'always' || process.env.LOG_LEVEL === 'debug') {
          const out = {
            reply_id: replyContext.reply?.id,
            referred_plain: replyContext.referredPlain,
            current_plain: replyContext.currentPlain,
            media: replyContext.media,
          };
          if (summaryMode === 'always') {
            log.info(out, '引用上下文');
          } else {
            log.debug(out, '引用上下文');
          }
        }
      } catch {}
    }

    // 推送到消息流（如果启用）
    if (sdk.stream) {
      try {
        const streamInstance = sdk.stream.getInstance();
        if (streamInstance) {
          // 准备图片缓存目录
          const imageCacheDir = process.env.IMAGE_CACHE_DIR || path.resolve(process.cwd(), 'cache', 'images');
          try { await fsp.mkdir(imageCacheDir, { recursive: true }); } catch {}

          // 简单的 https 下载到文件（用于无法直接复制本地文件时的兜底）
          const downloadToFile = (url: string, destPath: string): Promise<void> => new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(destPath);
            const req = https.get(url, (res) => {
              if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // 简单跟随一次重定向
                https.get(res.headers.location, (res2) => {
                  res2.pipe(fileStream);
                  fileStream.on('finish', () => fileStream.close(() => resolve()));
                }).on('error', reject);
                return;
              }
              if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
              }
              res.pipe(fileStream);
              fileStream.on('finish', () => fileStream.close(() => resolve()));
            });
            req.on('error', reject);
          });

          // 图片：快速转存到本地缓存，并在 segment 上写入 cache_path，供 summary 使用
          const imageSegments = (ev as MessageEvent).message.filter((s: any) => s.type === 'image');
          if (imageSegments.length > 0) {
            await Promise.all(imageSegments.map(async (seg: any) => {
              try {
                const fileParam = seg.data?.file || seg.data?.url;
                let detail: any;
                try {
                  const resp: any = await (sdk as any).call('get_image', { file: fileParam });
                  detail = resp?.data;
                } catch {}

                const origLocalPath: string | undefined = detail?.file; // NapCat 返回的本地原图路径
                const filenameFromDetail = detail?.file_name as string | undefined;
                const filenameFromSeg = (seg.data?.file as string | undefined) || (seg.data?.url ? String(seg.data.url).split('?')[0].split('/').pop() : undefined);
                const filename = (filenameFromDetail || filenameFromSeg || `image_${Date.now()}.jpg`).replace(/[\\/:*?"<>|]/g, '_');
                const destPath = path.resolve(imageCacheDir, filename);

                if (origLocalPath && fs.existsSync(origLocalPath)) {
                  try { await fsp.copyFile(origLocalPath, destPath); } catch {}
                  seg.data.cache_path = destPath;
                } else if (seg.data?.url) {
                  try { await downloadToFile(seg.data.url, destPath); seg.data.cache_path = destPath; } catch {}
                }
              } catch {}
            }));
          }

          // 获取当前消息中所有语音的详细信息（本地路径和文件大小）
          const recordSegments = (ev as MessageEvent).message.filter((s: any) => s.type === 'record');
          if (recordSegments.length > 0) {
            await Promise.all(recordSegments.map(async (seg: any) => {
              try {
                const response: any = await (sdk as any).call('get_record', { file: seg.data?.file, out_format: 'mp3' });
                const detail = response?.data;
                if (detail) {
                  // 添加本地路径和文件大小到 segment data
                  seg.data.path = detail.file;
                  seg.data.file_size = detail.file_size;
                }
              } catch (err) {
                // 忽略获取失败的情况
              }
            }));
          }
          
          // 获取当前消息中所有文件的下载链接
          const fileSegments = (ev as MessageEvent).message.filter((s: any) => s.type === 'file');
          if (fileSegments.length > 0) {
            await Promise.all(fileSegments.map(async (seg: any) => {
              try {
                const fileId = seg.data?.file_id;
                if (!fileId) return;
                
                let response: any;
                if ((ev as MessageEvent).message_type === 'group') {
                  // 群聊文件：使用 get_group_file_url
                  response = await (sdk as any).call('get_group_file_url', {
                    group_id: (ev as MessageEvent).group_id,
                    file_id: fileId,
                    busid: seg.data?.busid || 102
                  });
                } else {
                  // 私聊文件：使用 get_file
                  response = await (sdk as any).call('get_file', {
                    file_id: fileId
                  });
                }
                
                const detail = response?.data;
                if (detail) {
                  // 添加下载链接到 segment data（仅使用可公开访问的URL字段）
                  seg.data.url = detail.url || detail.file_url;
                  if (detail.file_size) {
                    seg.data.file_size = detail.file_size;
                  }
                  if (detail.file_name && !seg.data.file) {
                    seg.data.file = detail.file_name;
                  }
                }
              } catch (err) {
                // 忽略获取失败的情况
              }
            }));
          }
          
          // 如果文件仍没有可用链接/路径，则跳过推送（过滤掉该消息）
          if (fileSegments.length > 0) {
            // 仅当无法得到可用的 http(s) URL 时，视为未就绪
            const unresolved = fileSegments.some((seg: any) => {
              const u = seg.data?.url;
              return !(typeof u === 'string' && /^https?:\/\//i.test(u));
            });
            if (unresolved) {
              if (process.env.LOG_LEVEL === 'debug') {
                log.warn({ files: fileSegments.map((s: any) => s.data) }, '跳过推送：文件URL未就绪');
              }
              return; // 不推送该条消息
            }
          }
          
          await streamInstance.push(ev as MessageEvent, replyContext);
        }
      } catch (err) {
        log.error({ err }, '消息流推送失败');
      }
    }
  });

  // 监听通知事件
  sdk.on.notice(async (ev: any) => {
    if (process.env.LOG_LEVEL === 'debug') {
      log.debug({ notice_type: ev.notice_type }, '收到通知');
    }
  });

  // 监听请求事件
  sdk.on.request(async (ev: any) => {
    if (process.env.LOG_LEVEL === 'debug') {
      log.debug({ request_type: ev.request_type }, '收到请求');
    }
  });

  // 错误处理
  sdk.on.error((err) => {
    log.error({ err }, '❌ SDK 错误');
  });

  // 连接关闭
  sdk.on.close((code, reason) => {
    log.warn({ code, reason }, '❌ 连接关闭');
  });

  // 优雅退出
  const cleanup = async () => {
    log.info('正在关闭...');
    await sdk.dispose();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  log.info('🚀 NapCat 适配器已启动');
  log.info('按 Ctrl+C 退出');
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
