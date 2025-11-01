import wsCall from '../../src/utils/ws_rpc.js';

// 延迟函数（避免戳太快）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(args = {}, options = {}) {
  const penv = options?.pluginEnv || {};
  const url = String(penv.WS_SDK_URL || 'ws://localhost:6702');
  const timeoutMs = Math.max(1000, Number(penv.WS_SDK_TIMEOUT_MS || 15000));
  const path = 'user.sendPoke';
  
  // 从环境变量读取戳一戳行为配置
  const intervalMs = Math.max(100, Number(penv.POKE_INTERVAL_MS || 300));
  const randomInterval = String(penv.POKE_RANDOM_INTERVAL || 'false').toLowerCase() === 'true';
  const randomRangeMs = Math.max(0, Number(penv.POKE_RANDOM_RANGE_MS || 200));
  const retryOnFailure = String(penv.POKE_RETRY_ON_FAILURE || 'false').toLowerCase() === 'true';
  const maxRetries = Math.max(0, Number(penv.POKE_MAX_RETRIES || 1));
  
  const user_id = args.user_id;
  if (!user_id) return { success: false, code: 'INVALID', error: 'user_id 不能为空' };
  
  // 戳一戳次数（1-5次）
  let times = Number(args.times);
  if (!Number.isFinite(times) || times < 1) times = 1;
  if (times > 5) times = 5;
  
  const callArgs = [Number(user_id)];
  
  // group_id 和 target_id 是可选参数
  if (args.group_id !== undefined) {
    callArgs.push(Number(args.group_id));
    // 如果有 target_id，必须先有 group_id
    if (args.target_id !== undefined) {
      callArgs.push(Number(args.target_id));
    }
  } else if (args.target_id !== undefined) {
    // 没有 group_id 但有 target_id，传 undefined 占位
    callArgs.push(undefined);
    callArgs.push(Number(args.target_id));
  }
  
  const results = [];
  let successCount = 0;
  let totalAttempts = 0;
  
  // 循环戳一戳
  for (let i = 0; i < times; i++) {
    let roundSuccess = false;
    let lastError = null;
    
    // 重试逻辑（如果启用）
    const maxAttempts = retryOnFailure ? (maxRetries + 1) : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        totalAttempts++;
        const requestId = String(args.requestId || `${path}-${Date.now()}-${i + 1}-${attempt}`);
        const resp = await wsCall({ url, path, args: callArgs, requestId, timeoutMs });
        results.push({ 
          round: i + 1, 
          attempt: attempt + 1,
          success: true, 
          response: resp 
        });
        successCount++;
        roundSuccess = true;
        break; // 成功则跳出重试循环
      } catch (e) {
        lastError = String(e?.message || e);
        if (attempt < maxAttempts - 1 && retryOnFailure) {
          // 重试前等待一小段时间
          await sleep(100);
        }
      }
    }
    
    // 如果所有重试都失败，记录失败
    if (!roundSuccess && lastError) {
      results.push({ 
        round: i + 1, 
        success: false, 
        error: lastError,
        attempts: maxAttempts
      });
    }
    
    // 如果还有下一次，等待间隔时间
    if (i < times - 1) {
      const delay = randomInterval 
        ? intervalMs + Math.floor(Math.random() * randomRangeMs)
        : intervalMs;
      await sleep(delay);
    }
  }
  
  return {
    success: true,
    data: {
      总次数: times,
      成功次数: successCount,
      失败次数: times - successCount,
      总尝试数: totalAttempts,
      配置: {
        间隔时间: randomInterval ? `${intervalMs}-${intervalMs + randomRangeMs}ms (随机)` : `${intervalMs}ms`,
        失败重试: retryOnFailure ? `启用 (最多${maxRetries}次)` : '关闭'
      },
      request: { type: 'sdk', path, args: callArgs },
      results
    }
  };
}
