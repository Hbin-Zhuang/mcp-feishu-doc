/**
 * @fileoverview 飞书文档删除工具.
 * 删除飞书云空间中的文档（移入回收站）.
 * @module src/mcp-server/tools/definitions/feishu-delete-document.tool
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

const TOOL_NAME = 'feishu_delete_document';
const TOOL_TITLE = '删除飞书文档';
const TOOL_DESCRIPTION = `删除飞书云空间中的文档（移入回收站，可在飞书回收站恢复）。

⚠️ 注意事项：
- 此操作会将文档移入飞书回收站
- 可通过飞书客户端的回收站进行恢复
- 同时会清除本地存储的文档元数据（冲突检测数据）
- 仅支持删除云空间（drive）类型的文档，Wiki 文档需在飞书客户端中删除

适用场景：
- 清理测试文档
- 删除已废弃的文档`;

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
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
      .describe('要删除的飞书文档 ID（documentId）。'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
  })
  .describe('删除飞书文档的参数。');

const OutputSchema = z
  .object({
    success: z.boolean().describe('是否删除成功。'),
    documentId: z.string().describe('被删除的文档 ID。'),
    message: z.string().describe('操作结果说明。'),
  })
  .describe('飞书文档删除结果。');

type DeleteInput = z.infer<typeof InputSchema>;
type DeleteOutput = z.infer<typeof OutputSchema>;

// ============================================================================
// 逻辑
// ============================================================================

async function deleteDocumentLogic(
  input: DeleteInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<DeleteOutput> {
  logger.debug('开始删除飞书文档', {
    ...appContext,
    documentId: input.documentId,
  });

  const context = requestContextService.createRequestContext({
    operation: 'feishu.deleteDocument',
    tenantId: 'feishu-service',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  await feishuService.deleteDocumentFile(
    context,
    input.documentId,
    input.appId,
  );

  logger.info('飞书文档删除成功', {
    ...context,
    documentId: input.documentId,
  });

  return {
    success: true,
    documentId: input.documentId,
    message: `文档 ${input.documentId} 已移入飞书回收站，可在飞书客户端中恢复。`,
  };
}

// ============================================================================
// 响应格式化
// ============================================================================

function responseFormatter(result: DeleteOutput): ContentBlock[] {
  const md = markdown();

  if (result.success) {
    md.h2('🗑️ 文档已删除')
      .keyValue('文档 ID', result.documentId)
      .blankLine()
      .paragraph(result.message)
      .blankLine()
      .blockquote('文档已移入回收站，若需恢复请在飞书客户端的「回收站」中操作。');
  } else {
    md.h2('❌ 文档删除失败')
      .keyValue('文档 ID', result.documentId)
      .paragraph(result.message);
  }

  return [{ type: 'text', text: md.build() }];
}

// ============================================================================
// 导出
// ============================================================================

export const feishuDeleteDocumentTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:write'], deleteDocumentLogic),
  responseFormatter,
};
