/**
 * @fileoverview 飞书文档读取工具.
 * 通过 Block API 读取飞书文档内容并转换为 Markdown 文本.
 * @module src/mcp-server/tools/definitions/feishu-get-document.tool
 */

import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { container } from 'tsyringe';

import type {
  SdkContext,
  ToolAnnotations,
  ToolDefinition,
} from '@/mcp-server/tools/utils/index.js';
import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
import { FeishuServiceToken } from '@/container/tokens.js';
import type { FeishuService } from '@/services/feishu/index.js';
import {
  markdown,
  type RequestContext,
  logger,
  requestContextService,
} from '@/utils/index.js';

// ============================================================================
// 元数据
// ============================================================================

const TOOL_NAME = 'feishu_get_document';
const TOOL_TITLE = '读取飞书文档内容';
const TOOL_DESCRIPTION = `读取已存在的飞书文档内容，返回近似 Markdown 格式的文本。

功能特性：
- 通过 Block API 遍历文档结构，提取标题、正文、列表、代码块等
- 返回文档当前的 revision_id（可用于后续冲突检测）
- 支持指定应用 ID

图片会尝试下载为 base64 data URI；超出限制（最多 15 张、单张 ≤2.5MB、总 ≤10MB）或下载失败时用占位符 ![image](feishu-image)。`;

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// ============================================================================
// Schema
// ============================================================================

const InputSchema = z
  .object({
    documentId: z
      .string()
      .min(1, '文档 ID 不能为空')
      .describe('飞书文档 ID（documentId）。可从上传结果或文档 URL 中获取。'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
  })
  .describe('读取飞书文档的参数。');

const OutputSchema = z
  .object({
    documentId: z.string().describe('飞书文档 ID。'),
    title: z.string().describe('文档标题。'),
    content: z.string().describe('文档内容（近似 Markdown 格式）。'),
    revisionId: z.number().describe('文档当前修订版本号（用于冲突检测）。'),
  })
  .describe('飞书文档内容。');

type GetDocInput = z.infer<typeof InputSchema>;
type GetDocOutput = z.infer<typeof OutputSchema>;

// ============================================================================
// 逻辑
// ============================================================================

async function getDocumentLogic(
  input: GetDocInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<GetDocOutput> {
  logger.debug('开始读取飞书文档', {
    ...appContext,
    documentId: input.documentId,
  });

  const context = requestContextService.createRequestContext({
    operation: 'feishu.getDocument',
    tenantId: 'feishu-service',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  const result = await feishuService.getDocumentContent(
    context,
    input.documentId,
    input.appId,
  );

  logger.info('飞书文档读取成功', {
    ...context,
    documentId: input.documentId,
    revisionId: result.revisionId,
  });

  return {
    documentId: input.documentId,
    title: result.title,
    content: result.content,
    revisionId: result.revisionId,
  };
}

// ============================================================================
// 响应格式化
// ============================================================================

function responseFormatter(result: GetDocOutput): ContentBlock[] {
  const md = markdown();
  md.h2(`📄 ${result.title}`)
    .keyValue('文档 ID', result.documentId)
    .keyValue('修订版本', String(result.revisionId))
    .blankLine()
    .h3('文档内容')
    .text(result.content || '（文档内容为空）');

  return [{ type: 'text', text: md.build() }];
}

// ============================================================================
// 导出
// ============================================================================

export const feishuGetDocumentTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:read'], getDocumentLogic),
  responseFormatter,
};
