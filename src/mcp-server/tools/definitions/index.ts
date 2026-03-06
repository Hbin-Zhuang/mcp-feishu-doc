/**
 * @fileoverview Barrel file for all tool definitions.
 * This file re-exports all tool definitions for easy import and registration.
 * It also exports an array of all definitions for automated registration.
 * @module src/mcp-server/tools/definitions
 */

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
import { feishuGetDocumentTool } from './feishu-get-document.tool.js';
import { feishuSearchDocumentsTool } from './feishu-search-documents.tool.js';
import { feishuAddAppTool } from './feishu-add-app.tool.js';
import { feishuDeleteDocumentTool } from './feishu-delete-document.tool.js';

/**
 * An array containing all tool definitions for easy iteration.
 * Add your custom tools here after creating them in this directory.
 */
export const allToolDefinitions = [
  // 飞书 OAuth 认证工具
  feishuAuthUrlTool, // 飞书 OAuth：生成授权链接
  feishuAuthCallbackTool, // 飞书 OAuth：处理授权回调

  // 飞书文档操作工具
  feishuUploadMarkdownTool, // 飞书文档：上传 Markdown
  feishuUpdateDocumentTool, // 飞书文档：更新文档
  feishuBatchUploadTool, // 飞书文档：批量上传
  feishuGetDocumentTool, // 飞书文档：读取文档内容
  feishuDeleteDocumentTool, // 飞书文档：删除文档

  // 飞书管理工具
  feishuSearchDocumentsTool, // 飞书搜索：搜索文档
  feishuListFoldersTool, // 飞书管理：列出文件夹
  feishuListWikisTool, // 飞书管理：列出知识库
  feishuListWikiNodesTool, // 飞书管理：列出知识库节点
  feishuGetUserInfoTool, // 飞书管理：获取用户信息
  feishuSetDefaultAppTool, // 飞书管理：设置默认应用
  feishuListAppsTool, // 飞书管理：列出应用
  feishuAddAppTool, // 飞书管理：添加应用配置
];
