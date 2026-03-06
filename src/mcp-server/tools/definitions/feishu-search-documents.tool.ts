/**
 * @fileoverview 飞书文档搜索工具.
 * 使用飞书 Drive 搜索 API 在云空间中搜索文档.
 * @module src/mcp-server/tools/definitions/feishu-search-documents.tool
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

const TOOL_NAME = 'feishu_search_documents';
const TOOL_TITLE = '搜索飞书文档';
const TOOL_DESCRIPTION = `在飞书云空间中搜索文档，支持关键词全文搜索。

功能特性：
- 使用飞书 Drive 搜索 API 进行全文搜索
- 返回文档 token、标题、URL 等信息
- 可限制返回数量（最多 50 条）
- 支持指定应用 ID`;

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
    query: z
      .string()
      .min(1, '搜索关键词不能为空')
      .describe('搜索关键词，支持标题和内容全文搜索。'),
    count: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('最多返回的文档数量，范围 1-50，默认 20。'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
  })
  .describe('搜索飞书文档的参数。');

const OutputSchema = z
  .object({
    total: z.number().describe('返回的文档数量。'),
    documents: z
      .array(
        z.object({
          token: z.string().describe('文档 token（即 documentId）。'),
          name: z.string().describe('文档标题。'),
          url: z.string().describe('文档访问 URL。'),
          type: z.string().describe('文档类型（docx/doc 等）。'),
          ownerName: z.string().describe('文档所有者 ID。'),
        }),
      )
      .describe('匹配的文档列表。'),
  })
  .describe('搜索结果。');

type SearchInput = z.infer<typeof InputSchema>;
type SearchOutput = z.infer<typeof OutputSchema>;

// ============================================================================
// 逻辑
// ============================================================================

async function searchDocumentsLogic(
  input: SearchInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<SearchOutput> {
  logger.debug('开始搜索飞书文档', {
    ...appContext,
    query: input.query,
    count: input.count,
  });

  const context = requestContextService.createRequestContext({
    operation: 'feishu.searchDocuments',
    tenantId: 'feishu-service',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  const results = await feishuService.searchDocuments(
    context,
    input.query,
    input.count,
    input.appId,
  );

  logger.info('飞书文档搜索完成', {
    ...context,
    query: input.query,
    resultCount: results.length,
  });

  return {
    total: results.length,
    documents: results,
  };
}

// ============================================================================
// 响应格式化
// ============================================================================

function responseFormatter(result: SearchOutput): ContentBlock[] {
  const md = markdown();
  md.h2(`🔍 搜索结果（共 ${result.total} 条）`);

  if (result.total === 0) {
    md.paragraph('未找到匹配的文档。');
  } else {
    for (const doc of result.documents) {
      md.blankLine()
        .h3(doc.name || '未知标题')
        .keyValue('文档 ID', doc.token)
        .keyValue('类型', doc.type)
        .text(`🔗 [点击查看文档](${doc.url})`);
    }
  }

  return [{ type: 'text', text: md.build() }];
}

// ============================================================================
// 导出
// ============================================================================

export const feishuSearchDocumentsTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:read'], searchDocumentsLogic),
  responseFormatter,
};
