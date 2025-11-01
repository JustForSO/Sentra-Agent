/**
 * Schedule 延迟反馈功能演示
 * 
 * 使用场景：
 * 1. 图片生成：立刻开始生成，但2分钟后再通知用户
 * 2. 应用打包：立刻开始打包，但5分钟后再通知用户
 * 3. 定时提醒：30秒后提醒用户
 */

// ====================================
// 示例 1: 简单的延迟反馈（字符串形式）
// ====================================
const example1 = {
  aiName: 'local__image_draw',
  args: {
    prompt: '1girl, Raiden Shogun, beautiful anime style',
    schedule: 'in 2 minutes'  // 2分钟后反馈结果
  }
};

/**
 * 执行流程：
 * T+0s:   参数确定，插件立刻开始执行
 * T+45s:  插件完成（假设45秒就生成好了）
 * T+120s: 向用户反馈结果（等待到2分钟）
 * 
 * 日志：
 * INFO  Schedule 延迟反馈启用 { scheduleText: "in 2 minutes", delayMs: 120000 }
 * INFO  Schedule 延迟反馈: 工具已提前完成，延迟后反馈 { delayMs: 120000, actualMs: 45000 }
 */


// ====================================
// 示例 2: 中文自然语言
// ====================================
const example2 = {
  aiName: 'local__html_to_app',
  args: {
    description: '创建一个计算器应用',
    app_name: 'calculator',
    details: '背景渐变色，按钮圆角，现代风格',
    schedule: '5分钟后'  // 5分钟后反馈结果
  }
};

/**
 * 执行流程：
 * T+0s:   参数确定，插件立刻开始执行（安装依赖、打包）
 * T+300s: 5分钟到了，但插件还在运行
 *         发送中间状态: tool_choice { status: 'in_progress', message: '工具正在执行中...' }
 * T+420s: 插件完成（总耗时7分钟）
 *         发送最终结果: tool_result { success: true, data: '...' }
 * 
 * 日志：
 * INFO  Schedule 延迟反馈启用 { scheduleText: "5分钟后", delayMs: 300000 }
 * INFO  Schedule 延迟反馈: 发送中间状态 { delayMs: 300000 }
 * INFO  Schedule 延迟反馈: 工具延迟完成 { totalMs: 420000 }
 */


// ====================================
// 示例 3: 对象形式（更精确的控制）
// ====================================
const example3 = {
  aiName: 'local__image_draw',
  args: {
    prompt: '1boy, handsome anime style',
    schedule: {
      when: 'in 30 seconds',
      language: 'en',
      timezone: 'Asia/Shanghai'
    }
  }
};

/**
 * 执行流程：
 * T+0s:  参数确定，插件立刻开始执行
 * T+20s: 插件完成（提前10秒）
 * T+30s: 向用户反馈结果
 */


// ====================================
// 示例 4: 绝对时间（明天早上9点）
// ====================================
const example4 = {
  aiName: 'local__weather',
  args: {
    location: '北京',
    schedule: 'tomorrow 9am'  // 明天早上9点反馈天气
  }
};

/**
 * 执行流程：
 * T+0s:        参数确定，插件立刻开始执行
 * T+1s:        插件完成（天气查询很快）
 * T+明天9点:    向用户反馈结果（等待到明天早上9点）
 * 
 * 适用场景：定时提醒、每日报告
 */


// ====================================
// 示例 5: 批量任务的节奏控制
// ====================================
const example5_plan = {
  plan: {
    steps: [
      {
        aiName: 'local__image_draw',
        reason: '生成第一张图片',
        draftArgs: {
          prompt: '1girl, style A',
          schedule: '1分钟后'
        }
      },
      {
        aiName: 'local__image_draw',
        reason: '生成第二张图片',
        draftArgs: {
          prompt: '1girl, style B',
          schedule: '2分钟后'
        },
        dependsOn: [0]
      },
      {
        aiName: 'local__image_draw',
        reason: '生成第三张图片',
        draftArgs: {
          prompt: '1girl, style C',
          schedule: '3分钟后'
        },
        dependsOn: [1]
      }
    ]
  }
};

/**
 * 执行流程（假设每张图30秒生成完）：
 * 
 * T+0s:   步骤0开始执行
 * T+30s:  步骤0完成，但等待到1分钟
 * T+60s:  步骤0反馈结果，步骤1开始执行
 * T+90s:  步骤1完成，但等待到2分钟
 * T+120s: 步骤1反馈结果，步骤2开始执行
 * T+150s: 步骤2完成，但等待到3分钟
 * T+180s: 步骤2反馈结果
 * 
 * 效果：每分钟反馈一张图片，节奏可控
 */


// ====================================
// 事件流对比
// ====================================

/**
 * 无 schedule 参数（正常流程）
 * ===============================
 * 1. args              { type: 'args', aiName: '...', args: {...} }
 * 2. tool_result       { type: 'tool_result', result: {...}, elapsedMs: 1000 }
 */

/**
 * 有 schedule 参数 - 提前完成
 * ===============================
 * 1. args              { type: 'args', aiName: '...', args: { schedule: 'in 2 minutes' } }
 * 2. [等待2分钟]
 * 3. tool_result       { type: 'tool_result', result: {...}, elapsedMs: 45000 }
 *    注意：elapsedMs 是实际耗时（45秒），不是等待时间（2分钟）
 */

/**
 * 有 schedule 参数 - 超时未完成
 * ===============================
 * 1. args              { type: 'args', aiName: '...', args: { schedule: 'in 2 minutes' } }
 * 2. [等待2分钟]
 * 3. tool_choice       { type: 'tool_choice', status: 'in_progress', message: '工具正在执行中...' }
 * 4. [继续等待完成]
 * 5. tool_result       { type: 'tool_result', result: {...}, elapsedMs: 180000 }
 */


// ====================================
// 最佳实践
// ====================================

/**
 * 1. 相对时间 vs 绝对时间
 * 
 * 相对时间（推荐）：
 * - "in 2 minutes"
 * - "2分钟后"
 * - 适用于：控制反馈节奏、避免打扰
 * 
 * 绝对时间：
 * - "tomorrow 9am"
 * - "明天早上9点"
 * - 适用于：定时提醒、每日报告
 */

/**
 * 2. 合理设置延迟时间
 * 
 * 太短（< 30秒）：
 * - 可能插件还没完成就发中间状态
 * - 体验不佳
 * 
 * 太长（> 10分钟）：
 * - 用户可能忘记任务
 * - 建议配合中间状态提醒
 * 
 * 推荐：
 * - 快速任务（< 1分钟）：30秒 - 2分钟
 * - 中等任务（1-5分钟）：2分钟 - 5分钟
 * - 长任务（> 5分钟）：5分钟 - 10分钟
 */

/**
 * 3. 配合依赖使用
 * 
 * ✅ 好的做法：
 * 步骤0: schedule: "1分钟后"
 * 步骤1: schedule: "2分钟后", dependsOn: [0]
 * 
 * ❌ 不好的做法：
 * 步骤0: schedule: "5分钟后"
 * 步骤1: schedule: "1分钟后", dependsOn: [0]  // 依赖步骤反而更晚反馈
 */

export {
  example1,
  example2,
  example3,
  example4,
  example5_plan
};
