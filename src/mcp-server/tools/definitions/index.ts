/**
 * @fileoverview Barrel file for all tool definitions.
 * This file re-exports all tool definitions for easy import and registration.
 * It also exports an array of all definitions for automated registration.
 * @module src/mcp-server/tools/definitions
 */

import { echoTool } from './template-echo-message.tool.js';
import { catFactTool } from './template-cat-fact.tool.js';

// 如需添加更多工具，请参考以下示例：
// - template-madlibs-elicitation.tool.ts - Elicitation 交互示例
// - template-code-review-sampling.tool.ts - LLM Sampling 示例
// - template-image-test.tool.ts - 图片返回示例
// - template-async-countdown.task-tool.ts - 异步任务示例（实验性）

/**
 * An array containing all tool definitions for easy iteration.
 * Add your custom tools here after creating them in this directory.
 */
export const allToolDefinitions = [
  echoTool, // 基础示例：消息回显
  catFactTool, // 网络请求示例：获取猫咪趣闻
];
