/**
 * @fileoverview Barrel file for all tool definitions.
 * This file re-exports all tool definitions for easy import and registration.
 * It also exports an array of all definitions for automated registration.
 * @module src/mcp-server/tools/definitions
 */

import { echoTool } from './template-echo-message.tool.js';
import { catFactTool } from './template-cat-fact.tool.js';
import { feishuAuthUrlTool } from './feishu-auth-url.tool.js';
import { feishuAuthCallbackTool } from './feishu-auth-callback.tool.js';
import { feishuUploadMarkdownTool } from './feishu-upload-markdown.tool.js';
import { feishuUpdateDocumentTool } from './feishu-update-document.tool.js';
import { feishuListFoldersTool } from './feishu-list-folders.tool.js';
import { feishuListWikisTool } from './feishu-list-wikis.tool.js';
import { feishuListWikiNodesTool } from './feishu-list-wiki-nodes.tool.js';
import { feishuGetUserInfoTool } from './feishu-get-user-info.tool.js';
import { feishuSetDefaultAppTool } from './feishu-set-default-app.tool.js';
import { feishuListAppsTool } from './feishu-list-apps.tool.js';
import { feishuBatchUploadTool } from './feishu-batch-upload.tool.js';

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
  // 飞书 OAuth 认证工具
  feishuAuthUrlTool, // 飞书 OAuth：生成授权链接
  feishuAuthCallbackTool, // 飞书 OAuth：处理授权回调
  // 飞书文档操作工具
  feishuUploadMarkdownTool, // 飞书文档：上传 Markdown
  feishuUpdateDocumentTool, // 飞书文档：更新文档
  feishuBatchUploadTool, // 飞书文档：批量上传
  // 飞书管理工具
  feishuListFoldersTool, // 飞书管理：列出文件夹
  feishuListWikisTool, // 飞书管理：列出知识库
  feishuListWikiNodesTool, // 飞书管理：列出知识库节点
  feishuGetUserInfoTool, // 飞书管理：获取用户信息
  feishuSetDefaultAppTool, // 飞书管理：设置默认应用
  feishuListAppsTool, // 飞书管理：列出应用
];
