/**
 * @fileoverview 飞书默认应用设置工具.
 * 设置默认使用的飞书应用.
 * @module src/mcp-server/tools/definitions/feishu-set-default-app.tool
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
import { StorageService } from '@/container/tokens.js';
import type { StorageService as IStorageService } from '@/storage/core/StorageService.js';
import type { StoredFeishuAuth } from '@/services/feishu/types.js';
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
const TOOL_NAME = 'feishu_set_default_app';

/**
 * 工具标题.
 */
const TOOL_TITLE = '设置默认飞书应用';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '设置默认使用的飞书应用。设置后，其他飞书工具在不指定 appId 时将使用此应用。应用必须已完成 OAuth 认证。';

/**
 * 工具注解.
 */
const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * 输入 Schema.
 */
const InputSchema = z
  .object({
    appId: z
      .string()
      .min(1, '应用 ID 不能为空')
      .describe('要设置为默认的飞书应用 ID。该应用必须已完成 OAuth 认证。'),
  })
  .describe('设置默认飞书应用的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    success: z.boolean().describe('设置是否成功。'),
    appId: z.string().describe('设置的应用 ID。'),
    userName: z.string().optional().describe('应用关联的用户名。'),
    message: z.string().describe('操作结果消息。'),
  })
  .describe('设置默认应用结果。');

type SetDefaultAppInput = z.infer<typeof InputSchema>;
type SetDefaultAppOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function setDefaultAppLogic(
  input: SetDefaultAppInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<SetDefaultAppOutput> {
  logger.debug('设置默认飞书应用', {
    ...appContext,
    appId: input.appId,
  });

  const storage = container.resolve<IStorageService>(StorageService);
  const ctx = requestContextService.createRequestContext({
    operation: 'feishu.setDefaultApp',
    tenantId: 'feishu-service',
  });

  // 检查应用是否已认证
  const auth = await storage.get<StoredFeishuAuth>(
    `feishu/auth/${input.appId}`,
    ctx,
  );

  if (!auth) {
    throw new McpError(
      JsonRpcErrorCode.InvalidParams,
      `应用 ${input.appId} 未认证。请先使用 feishu_auth_url 和 feishu_auth_callback 完成 OAuth 认证。`,
    );
  }

  // 设置默认应用
  await storage.set('feishu/config/default_app', input.appId, ctx);

  logger.info('默认飞书应用设置成功', {
    ...appContext,
    appId: input.appId,
    userName: auth.userInfo?.name,
  });

  return {
    success: true,
    appId: input.appId,
    userName: auth.userInfo?.name,
    message: `已将 ${input.appId} 设置为默认应用`,
  };
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: SetDefaultAppOutput): ContentBlock[] {
  const md = markdown();

  if (result.success) {
    md.h2('✅ 默认应用设置成功').keyValue('应用 ID', result.appId);

    if (result.userName) {
      md.keyValue('关联用户', result.userName);
    }

    md.blankLine().blockquote(
      '现在其他飞书工具在不指定 appId 时将使用此应用。',
    );
  } else {
    md.h2('❌ 设置失败').paragraph(result.message);
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书默认应用设置工具定义.
 */
export const feishuSetDefaultAppTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:write'], setDefaultAppLogic),
  responseFormatter,
};
