/**
 * @fileoverview 飞书文档更新工具.
 * 更新已存在的飞书文档内容，支持冲突检测.
 * @module src/mcp-server/tools/definitions/feishu-update-document.tool
 */

import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { container } from 'tsyringe';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_update_document';

/**
 * 工具标题.
 */
const TOOL_TITLE = '更新飞书文档';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION = `更新已存在的飞书文档内容。

功能特性：
- 支持从文件路径或内容字符串更新
- 自动检测文档冲突（文档在上次上传后被修改）
- 支持强制覆盖模式
- 支持上传新的本地图片和附件

冲突检测：
- 如果文档在上次上传后被其他人修改，将返回冲突警告
- 使用 force=true 可以强制覆盖`;

/**
 * 工具注解.
 */
const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/**
 * 输入 Schema.
 */
const InputSchema = z
  .object({
    documentId: z
      .string()
      .min(1, '文档 ID 不能为空')
      .describe('要更新的飞书文档 ID。'),
    filePath: z
      .string()
      .optional()
      .describe('Markdown 文件路径。与 content 二选一，优先使用 filePath。'),
    content: z
      .string()
      .optional()
      .describe('Markdown 内容字符串。与 filePath 二选一。'),
    workingDirectory: z
      .string()
      .optional()
      .describe(
        '工作目录，用于解析相对路径的图片和附件。默认使用文件所在目录或当前目录。',
      ),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
    uploadImages: z
      .boolean()
      .default(true)
      .describe('是否上传本地图片到飞书。'),
    uploadAttachments: z
      .boolean()
      .default(true)
      .describe('是否上传本地附件到飞书。'),
    removeFrontMatter: z
      .boolean()
      .default(true)
      .describe('是否移除 Front Matter。设为 false 将保留为代码块。'),
    force: z
      .boolean()
      .default(false)
      .describe('是否强制覆盖。设为 true 将忽略冲突检测。'),
  })
  .refine((data) => data.filePath || data.content, {
    message: '必须提供 filePath 或 content 其中之一',
  })
  .describe('更新飞书文档的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    success: z.boolean().describe('更新是否成功。'),
    documentId: z.string().describe('飞书文档 ID。'),
    url: z.string().optional().describe('飞书文档 URL。'),
    title: z.string().optional().describe('文档标题。'),
    conflictDetected: z.boolean().optional().describe('是否检测到冲突。'),
    error: z.string().optional().describe('错误信息。'),
  })
  .describe('飞书文档更新结果。');

type UpdateInput = z.infer<typeof InputSchema>;
type UpdateOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function updateLogic(
  input: UpdateInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<UpdateOutput> {
  logger.debug('开始更新飞书文档', {
    ...appContext,
    documentId: input.documentId,
    hasFilePath: !!input.filePath,
    hasContent: !!input.content,
    force: input.force,
  });

  // 创建带有正确租户ID的上下文
  const context = requestContextService.createRequestContext({
    operation: 'feishu.updateDocument',
    tenantId: 'feishu-service',
  });

  // 获取文档内容
  let content: string;
  let workingDirectory = input.workingDirectory;

  if (input.filePath) {
    // 从文件读取
    const absolutePath = path.isAbsolute(input.filePath)
      ? input.filePath
      : path.resolve(process.cwd(), input.filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `文件不存在: ${input.filePath}`,
      );
    }

    content = fs.readFileSync(absolutePath, 'utf-8');
    workingDirectory = workingDirectory || path.dirname(absolutePath);
  } else if (input.content) {
    content = input.content;
    workingDirectory = workingDirectory || process.cwd();
  } else {
    throw new McpError(
      JsonRpcErrorCode.InvalidParams,
      '必须提供 filePath 或 content',
    );
  }

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  const result = await feishuService.updateDocument(
    input.documentId,
    {
      title: '',
      content,
      ...(input.filePath ? { filePath: input.filePath } : {}),
      workingDirectory,
    },
    {
      ...(input.appId ? { appId: input.appId } : {}),
      targetType: 'drive',
      uploadImages: input.uploadImages,
      uploadAttachments: input.uploadAttachments,
      removeFrontMatter: input.removeFrontMatter,
    },
    input.force,
  );

  if (result.success) {
    logger.info('飞书文档更新成功', {
      ...context,
      documentId: result.documentId,
    });
  } else if (result.conflictDetected) {
    logger.warning('检测到文档冲突', {
      ...context,
      documentId: input.documentId,
    });
  } else {
    logger.warning('飞书文档更新失败', {
      ...context,
      error: result.error,
    });
  }

  return {
    success: result.success,
    documentId: result.documentId ?? input.documentId,
    url: result.url,
    title: result.title,
    conflictDetected: result.conflictDetected,
    error: result.error,
  };
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: UpdateOutput): ContentBlock[] {
  const md = markdown();

  if (result.success) {
    md.h2('✅ 文档更新成功').keyValue('文档 ID', result.documentId);

    if (result.title) {
      md.keyValue('文档标题', result.title);
    }

    if (result.url) {
      md.blankLine()
        .paragraph('📎 文档链接：')
        .text(`[点击查看文档](${result.url})`);
    }

    md.blankLine().blockquote('文档已成功更新。');
  } else if (result.conflictDetected) {
    md.h2('⚠️ 检测到文档冲突')
      .keyValue('文档 ID', result.documentId)
      .blankLine()
      .paragraph(result.error ?? '文档在上次上传后已被修改。')
      .blankLine()
      .h3('解决方案')
      .text('1. 查看飞书文档，确认是否需要保留远程修改')
      .text('2. 使用 `force: true` 参数强制覆盖')
      .blankLine()
      .blockquote('建议先查看远程文档的修改内容，避免覆盖重要更改。');
  } else {
    md.h2('❌ 文档更新失败')
      .keyValue('文档 ID', result.documentId)
      .paragraph(result.error ?? '未知错误')
      .blankLine()
      .blockquote('请检查错误信息，确保文档存在且已完成 OAuth 认证。');
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书文档更新工具定义.
 */
export const feishuUpdateDocumentTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:write'], updateLogic),
  responseFormatter,
};
