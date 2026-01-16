/**
 * @fileoverview 飞书 Markdown 文档上传工具.
 * 将 Markdown 文档转换并上传到飞书云空间或知识库.
 * @module src/mcp-server/tools/definitions/feishu-upload-markdown.tool
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
const TOOL_NAME = 'feishu_upload_markdown';

/**
 * 工具标题.
 */
const TOOL_TITLE = '上传 Markdown 到飞书';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION = `将 Markdown 文档上传到飞书云空间或知识库。

支持两种输入方式：
1. 提供文件路径 (filePath) - 从本地文件读取内容
2. 提供内容字符串 (content) - 直接使用提供的 Markdown 内容

功能特性：
- 自动转换 Markdown 语法为飞书文档格式
- 支持上传本地图片和附件
- 支持 Front Matter 处理
- 支持上传到云空间文件夹或知识库空间`;

/**
 * 工具注解.
 */
const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/**
 * 输入 Schema.
 */
const InputSchema = z
  .object({
    filePath: z
      .string()
      .optional()
      .describe('Markdown 文件路径。与 content 二选一，优先使用 filePath。'),
    content: z
      .string()
      .optional()
      .describe('Markdown 内容字符串。与 filePath 二选一。'),
    title: z
      .string()
      .optional()
      .describe('文档标题。如果不提供，将从 Front Matter 或文件名中提取。'),
    workingDirectory: z
      .string()
      .optional()
      .describe(
        '工作目录，用于解析相对路径的图片和附件。默认使用文件所在目录或当前目录。',
      ),
    targetType: z
      .enum(['drive', 'wiki'])
      .default('wiki')
      .describe('目标类型：drive（云空间）或 wiki（知识库）。'),
    targetId: z
      .string()
      .optional()
      .describe(
        '目标 ID。drive 类型为文件夹 token，wiki 类型为空间 ID。不提供则上传到根目录。',
      ),
    parentNodeToken: z
      .string()
      .optional()
      .describe(
        '父节点 token。用于在云空间文档或知识库文档下创建子文档。如果提供，文档将作为该节点的子文档创建。',
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
  })
  .refine((data) => data.filePath || data.content, {
    message: '必须提供 filePath 或 content 其中之一',
  })
  .describe('上传 Markdown 文档到飞书的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    success: z.boolean().describe('上传是否成功。'),
    documentId: z.string().optional().describe('飞书文档 ID。'),
    url: z.string().optional().describe('飞书文档 URL。'),
    title: z.string().optional().describe('文档标题。'),
    uploadedFiles: z
      .array(
        z.object({
          originalPath: z.string().describe('原始文件路径。'),
          fileName: z.string().describe('文件名。'),
          fileKey: z.string().describe('飞书文件 key。'),
          isImage: z.boolean().describe('是否为图片。'),
        }),
      )
      .optional()
      .describe('已上传的本地文件列表。'),
    error: z.string().optional().describe('错误信息。'),
  })
  .describe('Markdown 文档上传结果。');

type UploadInput = z.infer<typeof InputSchema>;
type UploadOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function uploadLogic(
  input: UploadInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<UploadOutput> {
  logger.debug('开始上传 Markdown 文档', {
    ...appContext,
    hasFilePath: !!input.filePath,
    hasContent: !!input.content,
    targetType: input.targetType,
  });

  // 创建带有正确租户ID的上下文
  const context = requestContextService.createRequestContext({
    operation: 'feishu.uploadMarkdown',
    tenantId: 'feishu-service',
  });

  // 获取文档内容
  let content: string;
  let documentTitle = input.title;
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

    // 如果没有提供标题，从文件名提取
    if (!documentTitle) {
      documentTitle = path.basename(absolutePath, path.extname(absolutePath));
    }
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

  const result = await feishuService.uploadMarkdown(
    {
      title: documentTitle || 'Untitled',
      content,
      ...(input.filePath ? { filePath: input.filePath } : {}),
      workingDirectory,
    },
    {
      ...(input.appId ? { appId: input.appId } : {}),
      targetType: input.targetType,
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.parentNodeToken ? { parentNodeToken: input.parentNodeToken } : {}),
      uploadImages: input.uploadImages,
      uploadAttachments: input.uploadAttachments,
      removeFrontMatter: input.removeFrontMatter,
    },
  );

  if (result.success) {
    logger.info('Markdown 文档上传成功', {
      ...context,
      documentId: result.documentId,
      title: result.title,
    });
  } else {
    logger.warning('Markdown 文档上传失败', {
      ...context,
      error: result.error,
    });
  }

  return {
    success: result.success,
    documentId: result.documentId,
    url: result.url,
    title: result.title,
    uploadedFiles: result.uploadedFiles,
    error: result.error,
  };
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: UploadOutput): ContentBlock[] {
  const md = markdown();

  if (result.success) {
    md.h2('✅ 文档上传成功')
      .keyValue('文档标题', result.title ?? '未知')
      .keyValue('文档 ID', result.documentId ?? '未知');

    if (result.url) {
      md.blankLine()
        .paragraph('📎 文档链接：')
        .text(`[点击查看文档](${result.url})`);
    }

    if (result.uploadedFiles && result.uploadedFiles.length > 0) {
      md.blankLine().h3('已上传的文件');

      const images = result.uploadedFiles.filter((f) => f.isImage);
      const attachments = result.uploadedFiles.filter((f) => !f.isImage);

      if (images.length > 0) {
        md.paragraph(`🖼️ 图片: ${images.length} 个`);
        for (const img of images) {
          md.text(`  - ${img.fileName}`);
        }
      }

      if (attachments.length > 0) {
        md.paragraph(`📄 附件: ${attachments.length} 个`);
        for (const att of attachments) {
          md.text(`  - ${att.fileName}`);
        }
      }
    }

    md.blankLine().blockquote('文档已成功上传到飞书，可以通过链接访问。');
  } else {
    md.h2('❌ 文档上传失败').paragraph(result.error ?? '未知错误');

    md.blankLine().blockquote('请检查错误信息，确保已完成 OAuth 认证。');
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书 Markdown 上传工具定义.
 */
export const feishuUploadMarkdownTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:write'], uploadLogic),
  responseFormatter,
};
