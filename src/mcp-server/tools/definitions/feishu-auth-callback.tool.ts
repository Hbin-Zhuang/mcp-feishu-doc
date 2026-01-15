/**
 * @fileoverview 飞书 OAuth 授权回调处理工具.
 * 处理飞书 OAuth 2.0 授权回调，交换授权码获取访问令牌.
 * @module src/mcp-server/tools/definitions/feishu-auth-callback.tool
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
import { FEISHU_CONFIG } from '@/services/feishu/constants.js';
import {
  markdown,
  type RequestContext,
  logger,
  requestContextService,
} from '@/utils/index.js';

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_auth_callback';

/**
 * 工具标题.
 */
const TOOL_TITLE = '飞书授权回调';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '处理飞书 OAuth 2.0 授权回调。使用授权码交换访问令牌，并存储认证信息。通常由 OAuth 回调端点自动调用，也可手动调用处理授权码。';

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
    code: z
      .string()
      .min(1, '授权码不能为空')
      .describe('飞书 OAuth 授权码，从授权回调 URL 中获取。'),
    state: z
      .string()
      .min(1, 'state 参数不能为空')
      .describe('OAuth state 参数，用于验证请求来源，防止 CSRF 攻击。'),
    appId: z
      .string()
      .optional()
      .describe('飞书应用 ID。如果不提供，将使用默认配置的应用。'),
  })
  .describe('飞书 OAuth 授权回调参数。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    success: z.boolean().describe('授权是否成功。'),
    userInfo: z
      .object({
        userId: z.string().describe('飞书用户 ID。'),
        name: z.string().describe('用户名称。'),
        email: z.string().optional().describe('用户邮箱。'),
        avatarUrl: z.string().optional().describe('用户头像 URL。'),
      })
      .optional()
      .describe('授权用户信息。'),
    appId: z.string().describe('使用的飞书应用 ID。'),
    expiresAt: z.number().optional().describe('访问令牌过期时间戳（毫秒）。'),
    message: z.string().describe('操作结果消息。'),
  })
  .describe('飞书授权回调处理结果。');

type AuthCallbackInput = z.infer<typeof InputSchema>;
type AuthCallbackOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function authCallbackLogic(
  input: AuthCallbackInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<AuthCallbackOutput> {
  logger.debug('处理飞书授权回调', {
    ...appContext,
    appId: input.appId ?? 'default',
    hasCode: !!input.code,
    hasState: !!input.state,
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  try {
    // 创建带有正确租户ID的上下文
    const context = requestContextService.createRequestContext({
      operation: 'feishu.handleAuthCallback',
      tenantId: 'feishu-service',
    });

    const result = await feishuService.handleAuthCallback(
      input.code,
      input.state,
      input.appId,
    );

    if (!result.success) {
      // 获取实际使用的 appId
      const usedAppId =
        input.appId ?? FEISHU_CONFIG.DEFAULT_APP_ID ?? 'unknown';

      return {
        success: false,
        appId: usedAppId,
        message: '授权回调处理失败',
      };
    }

    // 获取实际使用的 appId
    const usedAppId = input.appId ?? FEISHU_CONFIG.DEFAULT_APP_ID ?? 'unknown';

    logger.info('飞书授权成功', {
      ...context,
      appId: usedAppId,
      userName: result.userInfo?.name,
    });

    return {
      success: true,
      userInfo: result.userInfo,
      appId: usedAppId,
      expiresAt: result.expiresAt,
      message: `授权成功！欢迎 ${result.userInfo?.name ?? '用户'}`,
    };
  } catch (error) {
    logger.error(
      '飞书授权失败',
      error instanceof Error ? error : new Error(String(error)),
      appContext,
    );

    // 获取实际使用的 appId
    const usedAppId = input.appId ?? FEISHU_CONFIG.DEFAULT_APP_ID ?? 'unknown';

    return {
      success: false,
      appId: usedAppId,
      message: `授权失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: AuthCallbackOutput): ContentBlock[] {
  const md = markdown();

  if (result.success) {
    md.h2('✅ 飞书授权成功').paragraph(result.message);

    if (result.userInfo) {
      md.h3('用户信息')
        .keyValue('用户名', result.userInfo.name)
        .keyValue('用户 ID', result.userInfo.userId);

      if (result.userInfo.email) {
        md.keyValue('邮箱', result.userInfo.email);
      }
    }

    md.blankLine().keyValue('应用 ID', result.appId);

    if (result.expiresAt) {
      const expiresDate = new Date(result.expiresAt);
      md.keyValue('令牌有效期至', expiresDate.toLocaleString());
    }

    md.blankLine().blockquote('现在可以使用飞书相关功能了！');
  } else {
    md.h2('❌ 飞书授权失败')
      .paragraph(result.message)
      .keyValue('应用 ID', result.appId)
      .blankLine()
      .blockquote('请重新尝试授权，或检查应用配置是否正确。');
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书授权回调工具定义.
 */
export const feishuAuthCallbackTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:auth'], authCallbackLogic),
  responseFormatter,
};
