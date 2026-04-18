/**
 * @fileoverview 飞书文档读取工具.
 * 通过 Block API 读取飞书文档内容并输出文本、图片与附件资源.
 * @module src/mcp-server/tools/definitions/feishu-get-document.tool
 */

import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
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
const TOOL_DESCRIPTION = `读取已存在的飞书文档内容，返回近似 Markdown 文本，以及按原文顺序拆分后的图片/附件资源。

功能特性：
- 通过 Block API 遍历文档结构，提取标题、正文、列表、代码块等
- 保留文档中图片与附件在正文中的原始顺序
- 图片下载后以内联 image content 返回，附件以下载后的 resource 预览返回
- 返回文档当前的 revision_id（可用于后续冲突检测）
- 支持指定应用 ID
`;

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
    blocks: z
      .array(
        z.object({
          blockId: z.string().describe('文档块 ID。'),
          type: z.enum(['text', 'image', 'file']).describe('文档块类型。'),
          text: z.string().optional().describe('文本块内容。'),
          fileToken: z.string().optional().describe('图片或附件的 file token。'),
          placeholderText: z
            .string()
            .optional()
            .describe('文本流中用于锚定媒体位置的占位文案。'),
        }),
      )
      .describe('按原文顺序排列的文档块列表。'),
    assets: z
      .array(
        z.object({
          fileToken: z.string().describe('飞书文件 token。'),
          type: z.enum(['image', 'file']).describe('资产类型。'),
          fileName: z.string().describe('文件名。'),
          mimeType: z.string().describe('文件 MIME 类型。'),
          byteLength: z.number().describe('文件字节数。'),
          localPath: z
            .string()
            .optional()
            .describe('下载到本地临时目录后的文件路径。'),
          base64Data: z
            .string()
            .optional()
            .describe('图片的 base64 数据，不含 data URI 前缀。'),
          previewText: z
            .string()
            .optional()
            .describe('附件的文本预览内容。'),
          deliveryMode: z
            .enum(['inline_base64', 'local_file_only'])
            .optional()
            .describe('媒体返回方式：内联 base64 或仅本地文件路径。'),
          status: z
            .enum(['downloaded', 'skipped_too_large', 'skipped_over_limit'])
            .optional()
            .describe('媒体处理状态。'),
          reason: z
            .string()
            .optional()
            .describe('媒体未内联或降级时的原因说明。'),
        }),
      )
      .describe('文档内解析出的图片与附件资产。'),
  })
  .describe('飞书文档内容。');

type GetDocInput = z.infer<typeof InputSchema>;
type GetDocOutput = z.infer<typeof OutputSchema>;
type GetDocBlock = GetDocOutput['blocks'][number];
type GetDocAsset = GetDocOutput['assets'][number];

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
    blocks: result.blocks,
    assets: result.assets,
  };
}

// ============================================================================
// 响应格式化
// ============================================================================

function buildAttachmentResourceText(asset: GetDocAsset): string {
  const lines = [
    `附件名: ${asset.fileName}`,
    `MIME 类型: ${asset.mimeType}`,
    `大小: ${asset.byteLength} bytes`,
  ];

  if (asset.localPath) {
    lines.push(`临时文件: ${asset.localPath}`);
  }

  if (asset.previewText) {
    lines.push('', '附件预览:', asset.previewText);
  }

  return lines.join('\n');
}

function buildAttachmentResourceUri(asset: GetDocAsset): string {
  if (asset.localPath) {
    return pathToFileURL(asset.localPath).toString();
  }

  return `feishu://attachment/${encodeURIComponent(asset.fileToken)}/${encodeURIComponent(asset.fileName)}`;
}

function buildAttachmentResourceMeta(asset: GetDocAsset): Record<string, unknown> {
  return {
    byteLength: asset.byteLength,
    deliveryMode: asset.deliveryMode,
    fileName: asset.fileName,
    fileToken: asset.fileToken,
    localPath: asset.localPath,
    reason: asset.reason,
    sourceMimeType: asset.mimeType,
    status: asset.status,
  };
}

function buildImageFallbackText(
  block: GetDocBlock,
  asset: GetDocAsset,
): string {
  const lines = [
    block.placeholderText || `图片资源：${asset.fileName}`,
    `文件名: ${asset.fileName}`,
    `MIME 类型: ${asset.mimeType}`,
    `大小: ${asset.byteLength} bytes`,
  ];

  if (asset.status) {
    lines.push(`状态: ${asset.status}`);
  }

  if (asset.reason) {
    lines.push(`原因: ${asset.reason}`);
  }

  if (asset.localPath) {
    lines.push(`临时文件: ${asset.localPath}`);
  }

  return lines.join('\n');
}

function toMultimodalContentBlocks(
  blocks: GetDocBlock[],
  assets: GetDocAsset[],
): ContentBlock[] {
  const assetsByToken = new Map(assets.map((asset) => [asset.fileToken, asset]));
  const contentBlocks: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      contentBlocks.push({
        type: 'text',
        text: block.text || '',
      });
      continue;
    }

    const asset = block.fileToken
      ? assetsByToken.get(block.fileToken)
      : undefined;
    if (!asset) {
      contentBlocks.push({
        type: 'text',
        text: block.placeholderText || '（媒体资源下载失败）',
      });
      continue;
    }

    if (block.type === 'image' && asset.base64Data) {
      contentBlocks.push({
        type: 'image',
        mimeType: asset.mimeType,
        data: asset.base64Data,
      } as ContentBlock);
      continue;
    }

    if (block.type === 'file') {
      contentBlocks.push({
        type: 'resource',
        resource: {
          uri: buildAttachmentResourceUri(asset),
          mimeType: 'text/plain',
          _meta: buildAttachmentResourceMeta(asset),
          text: buildAttachmentResourceText(asset),
        },
      } as ContentBlock);
      continue;
    }

    contentBlocks.push({
      type: 'text',
      text: buildImageFallbackText(block, asset),
    });
  }

  return contentBlocks;
}

function responseFormatter(result: GetDocOutput): ContentBlock[] {
  const md = markdown();
  md.h2(`📄 ${result.title}`)
    .keyValue('文档 ID', result.documentId)
    .keyValue('修订版本', String(result.revisionId))
    .blankLine()
    .h3('文档内容')
    .text(result.content || '（文档内容为空）');

  return [
    { type: 'text', text: md.build() },
    ...toMultimodalContentBlocks(result.blocks, result.assets),
  ];
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
