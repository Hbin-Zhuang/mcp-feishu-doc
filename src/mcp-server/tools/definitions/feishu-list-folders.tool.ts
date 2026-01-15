/**
 * @fileoverview 飞书云空间文件夹列表工具.
 * 列出飞书云空间中的文件夹.
 * @module src/mcp-server/tools/definitions/feishu-list-folders.tool
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

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_list_folders';

/**
 * 工具标题.
 */
const TOOL_TITLE = '列出飞书文件夹';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '列出飞书云空间中的文件夹。可以指定父文件夹 ID 来列出子文件夹，不指定则列出根目录下的文件夹。';

/**
 * 工具注解.
 */
const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * 输入 Schema.
 */
const InputSchema = z
  .object({
    parentId: z
      .string()
      .optional()
      .describe('父文件夹 token。不提供则列出根目录下的文件夹。'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
  })
  .describe('列出飞书文件夹的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    folders: z
      .array(
        z.object({
          token: z.string().describe('文件夹 token。'),
          name: z.string().describe('文件夹名称。'),
          parentToken: z.string().optional().describe('父文件夹 token。'),
          createdAt: z.string().optional().describe('创建时间。'),
          modifiedAt: z.string().optional().describe('修改时间。'),
        }),
      )
      .describe('文件夹列表。'),
    total: z.number().describe('文件夹总数。'),
  })
  .describe('飞书文件夹列表结果。');

type ListFoldersInput = z.infer<typeof InputSchema>;
type ListFoldersOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function listFoldersLogic(
  input: ListFoldersInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<ListFoldersOutput> {
  logger.debug('列出飞书文件夹', {
    ...appContext,
    parentId: input.parentId ?? 'root',
    appId: input.appId ?? 'default',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  // 创建带有正确租户 ID 的上下文
  const ctx = requestContextService.createRequestContext({
    operation: 'feishu.listFolders',
    tenantId: 'feishu-service',
  });

  try {
    const folders = await feishuService.listFolders(
      ctx,
      input.parentId,
      input.appId,
    );

    logger.info('获取文件夹列表成功', {
      ...appContext,
      count: folders.length,
    });

    return {
      folders: folders.map((f) => ({
        token: f.token,
        name: f.name,
        parentToken: f.parentToken,
        createdAt: f.createdAt,
        modifiedAt: f.modifiedAt,
      })),
      total: folders.length,
    };
  } catch (error) {
    logger.error('获取文件夹列表失败', {
      ...appContext,
      error: error instanceof Error ? error.message : String(error),
    });

    // 重新抛出错误而不是返回空结果
    throw error;
  }
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: ListFoldersOutput): ContentBlock[] {
  const md = markdown();

  md.h2('📁 飞书文件夹列表').keyValue('文件夹数量', String(result.total));

  if (result.folders.length === 0) {
    md.blankLine().paragraph('当前目录下没有文件夹。');
  } else {
    md.blankLine();

    for (const folder of result.folders) {
      md.text(`📂 **${folder.name}**`).text(`   Token: \`${folder.token}\``);

      if (folder.modifiedAt) {
        md.text(`   修改时间: ${folder.modifiedAt}`);
      }

      md.blankLine();
    }
  }

  md.blockquote('使用文件夹 token 作为 targetId 可以将文档上传到指定文件夹。');

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书文件夹列表工具定义.
 */
export const feishuListFoldersTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:read'], listFoldersLogic),
  responseFormatter,
};
