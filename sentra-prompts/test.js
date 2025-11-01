import SentraPromptsSDK from 'sentra-prompts';

// 解析单个模板字符串
const text = await SentraPromptsSDK('{{sandbox_system_prompt}}\n{{MCP_TOOLS}}\n\n现在时间：{{time}}\n\n平台：WeChat\n{{wechat_system_prompt}}');
console.log(text);