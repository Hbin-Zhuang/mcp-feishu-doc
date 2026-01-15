/**
 * @fileoverview 飞书用户信息获取工具.
 * 获取当前授权用户的飞书账号信息.
 * @module src/mcp-server/tools/definitions/feishu-get-user-info.tool
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

import type { StoredFeishuAuth } from '@/services/feishu/types.js';
import type { StorageService as IStorageService } from '@/storage/core/StorageService.js';
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';
import {
  markdown,
  type RequestContext,
  logger,
  requestContextService,
} from '@/utils/index.js';

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_get_user_info';

/**
 * 工具标题.
 */
const TOOL_TITLE = '获取飞书用户信息';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '获取当前授权用户的飞书账号信息，包括用户 ID、名称、邮箱和头像。需要先完成 OAuth 认证。';

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
  .describe('获取飞书用户信息的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    userId: z.string().describe('飞书用户 ID。'),
    name: z.string().describe('用户名称。'),
    email: z.string().optional().describe('用户邮箱。'),
    avatarUrl: z.string().optional().describe('用户头像 URL。'),
  })
  .describe('飞书用户信息。');

type GetUserInfoInput = z.infer<typeof InputSchema>;
type GetUserInfoOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function getUserInfoLogic(
  input: GetUserInfoInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<GetUserInfoOutput> {
  logger.debug('获取飞书用户信息', {
    ...appContext,
    appId: input.appId ?? 'default',
  });

  // 直接从存储中获取用户信息，避免通过 FeishuService
  const storage = container.resolve<IStorageService>(StorageService);
  const ctx = requestContextService.createRequestContext({
    operation: 'feishu.getUserInfo',
    tenantId: 'feishu-service',
  });

  const appId = input.appId || 'cli_a9e211f948381bdf';
  const auth = await storage.get<StoredFeishuAuth>(`feishu/auth/${appId}`, ctx);

  if (!auth) {
    throw new McpError(JsonRpcErrorCode.InvalidParams, `应用 ${appId} 未认证`);
  }

  if (!auth.userInfo) {
    throw new McpError(JsonRpcErrorCode.InvalidParams, '用户信息不存在');
  }

  logger.info('获取用户信息成功', {
    ...appContext,
    userName: auth.userInfo.name,
  });

  return {
    userId: auth.userInfo.userId,
    name: auth.userInfo.name,
    email: auth.userInfo.email,
    avatarUrl: auth.userInfo.avatarUrl,
  };
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: GetUserInfoOutput): ContentBlock[] {
  const md = markdown();

  md.h2('👤 飞书用户信息')
    .keyValue('用户名', result.name)
    .keyValue('用户 ID', result.userId);

  if (result.email) {
    md.keyValue('邮箱', result.email);
  }

  if (result.avatarUrl) {
    md.blankLine().paragraph(`头像: ![头像](${result.avatarUrl})`);
  }

  md.blankLine().blockquote('已成功获取当前授权用户的信息。');

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书用户信息工具定义.
 */
export const feishuGetUserInfoTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:read'], getUserInfoLogic),
  responseFormatter,
};
