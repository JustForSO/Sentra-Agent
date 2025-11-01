#!/usr/bin/env node

import { Agent, AgentConfig, defaultAgent } from './agent.js';
import { tokenCounter } from './token-counter.js';
import { textSegmentation } from './segmentation.js';
import { translator } from './translation.js';
import { timeParser, TimeParser } from './time-parser.js';
import { getConfigFromEnv, Config, defaultConfig } from './config.js';

// 导出主要组件
export {
  Agent,
  AgentConfig,
  defaultAgent,
  tokenCounter,
  textSegmentation,
  translator,
  timeParser,
  TimeParser,
  getConfigFromEnv,
  Config,
  defaultConfig
};

// 默认导出Agent类
export default Agent;
