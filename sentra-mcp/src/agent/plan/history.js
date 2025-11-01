import { HistoryStore } from '../../history/store.js';
import { clip } from '../../utils/text.js';

// 中文：构造“工具对话式上下文”，把所有已完成的步骤整理成一问一答：
// user: 现在该使用 <aiName> 了
// assistant: 参数(JSON): {...}\n结果(JSON): {...}

// 中文：返回可直接拼接到 user 消息末尾的依赖文本（而不是单独的 assistant 轮次），以保持 user/assistant 交替结构
export async function buildDependentContextText(runId, dependsOn = []) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return '';
  try {
    const indices = Array.from(new Set(dependsOn.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0))).sort((a, b) => a - b);
    if (indices.length === 0) return '';
    const history = await HistoryStore.list(runId, 0, -1);
    const plan = await HistoryStore.getPlan(runId);
    const items = [];
    for (const idx of indices) {
      const h = history.find((x) => x.type === 'tool_result' && Number(x.stepIndex) === idx);
      if (!h) continue;
      const r = (plan?.steps && plan.steps[Number(idx)]) ? plan.steps[Number(idx)].reason : '';
      items.push({
        stepIndex: idx,
        aiName: h.aiName,
        reason: clip(r),
        argsPreview: clip(h.args),
        resultPreview: clip(h.result?.data ?? h.result),
      });
    }
    if (!items.length) return '';
    return `\n依赖结果(JSON):\n${JSON.stringify(items, null, 2)}`;
  } catch {
    return '';
  }
}
export async function buildToolDialogueMessages(runId, upToStepIndex) {
  try {
    const history = await HistoryStore.list(runId, 0, -1);
    const plan = await HistoryStore.getPlan(runId);
    
    // 🔧 修复并发问题：只包含依赖链上的步骤，避免并发分支污染
    const currentStep = plan?.steps?.[upToStepIndex];
    const dependsOn = Array.isArray(currentStep?.dependsOn) ? currentStep.dependsOn : [];
    
    // 构建依赖链（包括间接依赖）
    const dependencyChain = new Set();
    const addDependencies = (stepIdx) => {
      if (dependencyChain.has(stepIdx)) return;
      dependencyChain.add(stepIdx);
      const step = plan?.steps?.[stepIdx];
      if (step && Array.isArray(step.dependsOn)) {
        step.dependsOn.forEach(dep => {
          const depNum = Number(dep);
          if (Number.isFinite(depNum) && depNum >= 0 && depNum < upToStepIndex) {
            addDependencies(depNum);
          }
        });
      }
    };
    dependsOn.forEach(dep => {
      const depNum = Number(dep);
      if (Number.isFinite(depNum) && depNum >= 0 && depNum < upToStepIndex) {
        addDependencies(depNum);
      }
    });
    
    // 只获取依赖链上的步骤历史
    const prev = history
      .filter((h) => h.type === 'tool_result' && Number(h.stepIndex) < upToStepIndex && dependencyChain.has(Number(h.stepIndex)))
      .sort((a, b) => (Number(a.stepIndex) - Number(b.stepIndex)));
    
    const msgs = [];
    for (const h of prev) {
      const aiName = h.aiName;
      const reason = clip(plan?.steps?.[Number(h.stepIndex)]?.reason || '');
      const argsPreview = clip(h.args);
      const resultPreview = clip(h.result?.data ?? h.result);
      msgs.push({ role: 'user', content: `现在该使用 ${aiName} 了。原因: ${reason || '(未提供)'}` });
      msgs.push({ role: 'assistant', content: [
        `参数(JSON): ${argsPreview}`,
        `结果(JSON): ${resultPreview}`
      ].join('\n') });
    }
    return msgs;
  } catch (e) {
    // 不要中断主流程
    return [];
  }
}

// 中文：将 dependsOn 指定的上游步骤结果，整理为一个“依赖结果(JSON)”的 assistant 消息，便于参数生成阶段作为证据使用
export async function buildDependentContextMessages(runId, dependsOn = []) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return [];
  try {
    const indices = Array.from(new Set(dependsOn.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0))).sort((a, b) => a - b);
    if (indices.length === 0) return [];
    const history = await HistoryStore.list(runId, 0, -1);
    const items = [];
    for (const idx of indices) {
      const h = history.find((x) => x.type === 'tool_result' && Number(x.stepIndex) === idx);
      if (!h) continue;
      items.push({
        stepIndex: idx,
        aiName: h.aiName,
        argsPreview: clip(h.args),
        resultPreview: clip(h.result?.data ?? h.result),
      });
    }
    if (!items.length) return [];
    const content = `依赖结果(JSON):\n${JSON.stringify(items, null, 2)}`;
    return [{ role: 'assistant', content }];
  } catch {
    return [];
  }
}

export default { buildToolDialogueMessages };
