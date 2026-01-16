/**
 * @fileoverview 飞书批量上传 Markdown 工具.
 * 批量将多个 Markdown 文档上传到飞书.
 * @module src/mcp-server/tools/definitions/feishu-batch-upload.tool
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

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_batch_upload_markdown';

/**
 * 工具标题.
 */
const TOOL_TITLE = '批量上传 Markdown 到飞书';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION = `批量将多个 Markdown 文档上传到飞书云空间或知识库。

功能特性：
- 支持同时上传多个文档
- 并发控制，避免触发 API 限制
- 错误隔离，单个文档失败不影响其他文档
- 返回详细的成功/失败列表

使用场景：
- 批量迁移文档到飞书
- 同步多个笔记到飞书知识库`;

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
 * 单个文档 Schema.
 */
const DocumentSchema = z
  .object({
    filePath: z
      .string()
      .optional()
      .describe('Markdown 文件路径。与 content 二选一。'),
    content: z
      .string()
      .optional()
      .describe('Markdown 内容。与 filePath 二选一。'),
    title: z.string().optional().describe('文档标题。'),
    targetType: z
      .enum(['drive', 'wiki'])
      .default('wiki')
      .describe('目标类型。'),
    targetId: z.string().optional().describe('目标 ID。'),
  })
  .refine((data) => data.filePath || data.content, {
    message: '必须提供 filePath 或 content',
  });

/**
 * 输入 Schema.
 */
const InputSchema = z
  .object({
    documents: z
      .array(DocumentSchema)
      .min(1, '至少需要一个文档')
      .max(50, '单次最多上传 50 个文档')
      .describe('要上传的文档列表。'),
    workingDirectory: z
      .string()
      .optional()
      .describe('工作目录，用于解析相对路径。'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe('并发数量，默认 3，最大 5。'),
    uploadImages: z.boolean().default(true).describe('是否上传本地图片。'),
    uploadAttachments: z.boolean().default(true).describe('是否上传本地附件。'),
    removeFrontMatter: z
      .boolean()
      .default(true)
      .describe('是否移除 Front Matter。'),
  })
  .describe('批量上传 Markdown 文档的参数。');

/**
 * 单个结果 Schema.
 */
const ResultItemSchema = z.object({
  index: z.number().describe('文档索引。'),
  success: z.boolean().describe('是否成功。'),
  documentId: z.string().optional().describe('飞书文档 ID。'),
  url: z.string().optional().describe('飞书文档 URL。'),
  title: z.string().optional().describe('文档标题。'),
  error: z.string().optional().describe('错误信息。'),
});

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    total: z.number().describe('总文档数。'),
    succeeded: z.number().describe('成功数量。'),
    failed: z.number().describe('失败数量。'),
    results: z.array(ResultItemSchema).describe('详细结果列表。'),
  })
  .describe('批量上传结果。');

type BatchUploadInput = z.infer<typeof InputSchema>;
type BatchUploadOutput = z.infer<typeof OutputSchema>;
type ResultItem = z.infer<typeof ResultItemSchema>;

/**
 * 并发控制器.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    const index = i;
    const promise = (async () => {
      const result = await fn(item, index);
      results[index] = result;
    })();

    const wrappedPromise = promise.finally(() => {
      executing.delete(wrappedPromise);
    });

    executing.add(wrappedPromise);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * 工具逻辑.
 */
async function batchUploadLogic(
  input: BatchUploadInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<BatchUploadOutput> {
  logger.debug('开始批量上传 Markdown 文档', {
    ...appContext,
    documentCount: input.documents.length,
    concurrency: input.concurrency,
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  // 创建带有正确租户ID的上下文
  const context = requestContextService.createRequestContext({
    operation: 'feishu.batchUploadMarkdown',
    tenantId: 'feishu-service',
  });

  const baseWorkingDirectory = input.workingDirectory || process.cwd();

  const uploadDocument = async (
    doc: (typeof input.documents)[0],
    index: number,
  ): Promise<ResultItem> => {
    try {
      // 获取文档内容
      let content: string;
      let documentTitle = doc.title;
      let workingDirectory = baseWorkingDirectory;

      if (doc.filePath) {
        const absolutePath = path.isAbsolute(doc.filePath)
          ? doc.filePath
          : path.resolve(baseWorkingDirectory, doc.filePath);

        if (!fs.existsSync(absolutePath)) {
          return {
            index,
            success: false,
            title: doc.title,
            error: `文件不存在: ${doc.filePath}`,
          };
        }

        content = fs.readFileSync(absolutePath, 'utf-8');
        workingDirectory = path.dirname(absolutePath);

        if (!documentTitle) {
          documentTitle = path.basename(
            absolutePath,
            path.extname(absolutePath),
          );
        }
      } else if (doc.content) {
        content = doc.content;
      } else {
        return {
          index,
          success: false,
          title: doc.title,
          error: '必须提供 filePath 或 content',
        };
      }

      const result = await feishuService.uploadMarkdown(
        {
          title: documentTitle || `Document ${index + 1}`,
          content,
          ...(doc.filePath ? { filePath: doc.filePath } : {}),
          workingDirectory,
        },
        {
          ...(input.appId ? { appId: input.appId } : {}),
          targetType: doc.targetType,
          ...(doc.targetId ? { targetId: doc.targetId } : {}),
          uploadImages: input.uploadImages,
          uploadAttachments: input.uploadAttachments,
          removeFrontMatter: input.removeFrontMatter,
        },
      );

      if (result.success) {
        return {
          index,
          success: true,
          documentId: result.documentId,
          url: result.url,
          title: result.title,
        };
      } else {
        return {
          index,
          success: false,
          title: documentTitle,
          error: result.error ?? '上传失败',
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        index,
        success: false,
        title: doc.title,
        error: errorMessage,
      };
    }
  };

  // 使用并发控制执行上传
  const results = await runWithConcurrency(
    input.documents,
    input.concurrency,
    uploadDocument,
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  logger.info('批量上传完成', {
    ...context,
    total: input.documents.length,
    succeeded,
    failed,
  });

  return {
    total: input.documents.length,
    succeeded,
    failed,
    results,
  };
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: BatchUploadOutput): ContentBlock[] {
  const md = markdown();

  const allSuccess = result.failed === 0;
  const allFailed = result.succeeded === 0;

  if (allSuccess) {
    md.h2('✅ 批量上传完成');
  } else if (allFailed) {
    md.h2('❌ 批量上传失败');
  } else {
    md.h2('⚠️ 批量上传部分完成');
  }

  md.keyValue('总数', String(result.total))
    .keyValue('成功', String(result.succeeded))
    .keyValue('失败', String(result.failed));

  // 成功的文档
  const successResults = result.results.filter((r) => r.success);
  if (successResults.length > 0) {
    md.blankLine().h3('✅ 成功上传的文档');

    for (const item of successResults) {
      md.text(`${item.index + 1}. **${item.title ?? '未知'}**`);
      if (item.url) {
        md.text(`   [查看文档](${item.url})`);
      }
    }
  }

  // 失败的文档
  const failedResults = result.results.filter((r) => !r.success);
  if (failedResults.length > 0) {
    md.blankLine().h3('❌ 上传失败的文档');

    for (const item of failedResults) {
      md.text(`${item.index + 1}. **${item.title ?? '未知'}**`).text(
        `   错误: ${item.error}`,
      );
    }
  }

  if (result.failed > 0) {
    md.blankLine().blockquote('部分文档上传失败，请检查错误信息后重试。');
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书批量上传工具定义.
 */
export const feishuBatchUploadTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:write'], batchUploadLogic),
  responseFormatter,
};
