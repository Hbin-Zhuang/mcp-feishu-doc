/**
 * @fileoverview 飞书知识库节点列表工具定义.
 * @module src/mcp-server/tools/definitions/feishu-list-wiki-nodes.tool
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

const TOOL_NAME = 'feishu_list_wiki_nodes';
const TOOL_TITLE = '列出飞书知识库节点';
const TOOL_DESCRIPTION = `
列出指定飞书知识库空间中的节点（文档和文件夹）。

**功能：**
- 列出知识库根目录下的所有节点
- 支持列出指定父节点下的子节点
- 返回节点的详细信息（类型、标题、token等）

**使用场景：**
- 浏览知识库结构
- 查找特定文档或文件夹
- 获取节点 token 用于后续操作

**注意事项：**
- 需要先完成飞书 OAuth 授权
- 需要有知识库的访问权限
- 每次最多返回 50 个节点
`.trim();

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

// ============================================================================
// 输入/输出模式
// ============================================================================

const InputSchema = z
  .object({
    wikiId: z
      .string()
      .min(1)
      .describe('知识库空间 ID，可以通过 feishu_list_wikis 工具获取'),
    parentNodeToken: z
      .string()
      .optional()
      .describe('父节点 token，不提供则列出根目录下的节点'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID，不提供则使用默认应用'),
  })
  .describe('列出飞书知识库节点的参数。');

const OutputSchema = z
  .object({
    nodes: z
      .array(
        z.object({
          spaceId: z.string().describe('空间 ID'),
          nodeToken: z.string().describe('节点 token'),
          objToken: z.string().describe('对象 token'),
          objType: z.string().describe('对象类型（docx, sheet等）'),
          parentNodeToken: z.string().optional().describe('父节点 token'),
          title: z.string().describe('节点标题'),
          hasChild: z.boolean().describe('是否有子节点'),
        }),
      )
      .describe('节点列表'),
    count: z.number().describe('节点数量'),
  })
  .describe('飞书知识库节点列表结果。');

type ListWikiNodesInput = z.infer<typeof InputSchema>;
type ListWikiNodesOutput = z.infer<typeof OutputSchema>;

// ============================================================================
// 业务逻辑
// ============================================================================

async function listWikiNodesLogic(
  input: ListWikiNodesInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<ListWikiNodesOutput> {
  logger.debug('列出飞书知识库节点', {
    ...appContext,
    wikiId: input.wikiId,
    parentNodeToken: input.parentNodeToken,
    appId: input.appId ?? 'default',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  // 创建带有正确租户 ID 的上下文
  const ctx = requestContextService.createRequestContext({
    operation: 'feishu.listWikiNodes',
    tenantId: 'feishu-service',
  });

  const nodes = await feishuService.getWikiNodes(
    ctx,
    input.wikiId,
    input.parentNodeToken,
    input.appId,
  );

  logger.info('获取知识库节点列表成功', {
    ...appContext,
    count: nodes.length,
  });

  return {
    nodes: nodes.map((node) => ({
      spaceId: node.spaceId,
      nodeToken: node.nodeToken,
      objToken: node.objToken,
      objType: node.objType,
      parentNodeToken: node.parentNodeToken,
      title: node.title,
      hasChild: node.hasChild,
    })),
    count: nodes.length,
  };
}

// ============================================================================
// 响应格式化器
// ============================================================================

function responseFormatter(result: ListWikiNodesOutput): ContentBlock[] {
  const md = markdown();

  md.h2('📚 飞书知识库节点列表').keyValue('节点数量', String(result.count));

  if (result.nodes.length === 0) {
    md.blankLine().paragraph('该位置暂无节点。');
  } else {
    md.blankLine();

    for (const node of result.nodes) {
      const icon = node.hasChild ? '📁' : '📄';
      const typeLabel = node.objType === 'docx' ? '文档' : node.objType;

      md.h3(`${icon} ${node.title}`)
        .keyValue('类型', typeLabel)
        .keyValue('节点 Token', `\`${node.nodeToken}\``)
        .keyValue('对象 Token', `\`${node.objToken}\``);

      if (node.parentNodeToken) {
        md.keyValue('父节点', `\`${node.parentNodeToken}\``);
      }

      if (node.hasChild) {
        md.paragraph('💡 提示: 使用此节点 token 作为 parentNodeToken 可以查看子节点');
      }

      md.blankLine();
    }

    md.paragraph('使用节点 token 可以进行后续操作，如上传文档到指定位置。');
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

// ============================================================================
// 工具定义导出
// ============================================================================

export const feishuListWikiNodesTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  logic: withToolAuth(['tool:feishu:read'], listWikiNodesLogic),
  annotations: TOOL_ANNOTATIONS,
  responseFormatter,
};
