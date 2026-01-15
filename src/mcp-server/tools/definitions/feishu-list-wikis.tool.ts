/**
 * @fileoverview 飞书知识库列表工具.
 * 列出用户有权限访问的飞书知识库空间.
 * @module src/mcp-server/tools/definitions/feishu-list-wikis.tool
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
const TOOL_NAME = 'feishu_list_wikis';

/**
 * 工具标题.
 */
const TOOL_TITLE = '列出飞书知识库';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '列出用户有权限访问的飞书知识库空间。返回知识库的 ID、名称、描述等信息。';

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
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
  })
  .describe('列出飞书知识库的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    wikis: z
      .array(
        z.object({
          spaceId: z.string().describe('知识库空间 ID。'),
          name: z.string().describe('知识库名称。'),
          description: z.string().optional().describe('知识库描述。'),
          spaceType: z.string().optional().describe('空间类型。'),
          visibility: z.string().optional().describe('可见性。'),
        }),
      )
      .describe('知识库列表。'),
    total: z.number().describe('知识库总数。'),
  })
  .describe('飞书知识库列表结果。');

type ListWikisInput = z.infer<typeof InputSchema>;
type ListWikisOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function listWikisLogic(
  input: ListWikisInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<ListWikisOutput> {
  logger.debug('列出飞书知识库', {
    ...appContext,
    appId: input.appId ?? 'default',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  // 创建带有正确租户 ID 的上下文
  const ctx = requestContextService.createRequestContext({
    operation: 'feishu.listWikis',
    tenantId: 'feishu-service',
  });

  try {
    const wikis = await feishuService.listWikis(ctx, input.appId);

    logger.info('获取知识库列表成功', {
      ...appContext,
      count: wikis.length,
    });

    return {
      wikis: wikis.map((w) => ({
        spaceId: w.spaceId,
        name: w.name,
        description: w.description,
        spaceType: w.spaceType,
        visibility: w.visibility,
      })),
      total: wikis.length,
    };
  } catch (error) {
    logger.error('获取知识库列表失败', {
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
function responseFormatter(result: ListWikisOutput): ContentBlock[] {
  const md = markdown();

  md.h2('📚 飞书知识库列表').keyValue('知识库数量', String(result.total));

  if (result.wikis.length === 0) {
    md.blankLine().paragraph('没有可访问的知识库。');
  } else {
    md.blankLine();

    for (const wiki of result.wikis) {
      md.text(`📖 **${wiki.name}**`).text(`   空间 ID: \`${wiki.spaceId}\``);

      if (wiki.description) {
        md.text(`   描述: ${wiki.description}`);
      }

      if (wiki.visibility) {
        md.text(`   可见性: ${wiki.visibility}`);
      }

      md.blankLine();
    }
  }

  md.blockquote(
    '使用知识库空间 ID 作为 targetId，并设置 targetType 为 wiki，可以将文档上传到知识库。',
  );

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书知识库列表工具定义.
 */
export const feishuListWikisTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:read'], listWikisLogic),
  responseFormatter,
};
