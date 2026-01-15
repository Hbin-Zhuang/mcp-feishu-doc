/**
 * @fileoverview 飞书 OAuth 授权 URL 生成工具.
 * 生成飞书 OAuth 2.0 授权链接，用于用户授权.
 * @module src/mcp-server/tools/definitions/feishu-auth-url.tool
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
import { markdown, type RequestContext, logger } from '@/utils/index.js';

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_auth_url';

/**
 * 工具标题.
 */
const TOOL_TITLE = '飞书授权链接';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '生成飞书 OAuth 2.0 授权链接。用户访问此链接完成授权后，将获得访问飞书 API 的权限。返回授权 URL 和 state 参数。';

/**
 * 工具注解.
 */
const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
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
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
    redirectUri: z
      .string()
      .url()
      .optional()
      .describe('OAuth 回调地址。如果不提供，将使用默认配置的回调地址。'),
  })
  .describe('生成飞书 OAuth 授权链接的参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    authUrl: z
      .string()
      .url()
      .describe('飞书 OAuth 授权链接，用户需要访问此链接完成授权。'),
    state: z
      .string()
      .describe('OAuth state 参数，用于防止 CSRF 攻击，回调时需要验证。'),
    appId: z.string().describe('使用的飞书应用 ID。'),
    expiresIn: z.number().describe('state 参数的有效期（秒）。'),
  })
  .describe('飞书授权链接生成结果。');

type AuthUrlInput = z.infer<typeof InputSchema>;
type AuthUrlOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function authUrlLogic(
  input: AuthUrlInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<AuthUrlOutput> {
  logger.debug('生成飞书授权链接', {
    ...appContext,
    appId: input.appId ?? 'default',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );
  const { authUrl, state } = await feishuService.getAuthUrl(
    input.appId,
    input.redirectUri,
  );

  // 从 authUrl 中提取实际使用的 appId
  const urlParams = new URL(authUrl).searchParams;
  const usedAppId = urlParams.get('client_id') ?? input.appId ?? 'unknown';

  logger.info('飞书授权链接生成成功', {
    ...appContext,
    appId: usedAppId,
  });

  return {
    authUrl,
    state,
    appId: usedAppId,
    expiresIn: 300, // state 有效期 5 分钟
  };
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: AuthUrlOutput): ContentBlock[] {
  const md = markdown()
    .h2('飞书授权链接')
    .paragraph('请访问以下链接完成飞书授权：')
    .text(`🔗 [点击授权](${result.authUrl})`)
    .blankLine()
    .blankLine()
    .paragraph('或复制以下链接到浏览器：')
    .codeBlock(result.authUrl, 'text')
    .keyValue('应用 ID', result.appId)
    .keyValue('有效期', `${result.expiresIn} 秒`)
    .blankLine()
    .blockquote(
      '授权完成后，系统将自动获取访问令牌。请确保在有效期内完成授权。',
    );

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书授权链接工具定义.
 */
export const feishuAuthUrlTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:auth'], authUrlLogic),
  responseFormatter,
};
