/**
 * @fileoverview 飞书应用列表工具.
 * 列出所有已配置的飞书应用.
 * @module src/mcp-server/tools/definitions/feishu-list-apps.tool
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

/**
 * 工具名称.
 */
const TOOL_NAME = 'feishu_list_apps';

/**
 * 工具标题.
 */
const TOOL_TITLE = '列出飞书应用';

/**
 * 工具描述.
 */
const TOOL_DESCRIPTION =
  '列出所有已配置的飞书应用，包括认证状态、关联用户等信息。可以查看哪个应用是默认应用。';

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
const InputSchema = z.object({}).describe('列出飞书应用的参数（无需参数）。');

/**
 * 输出 Schema.
 */
const OutputSchema = z
  .object({
    apps: z
      .array(
        z.object({
          appId: z.string().describe('应用 ID。'),
          isDefault: z.boolean().describe('是否为默认应用。'),
          hasToken: z.boolean().describe('是否有有效的访问令牌。'),
          userName: z.string().optional().describe('关联的用户名。'),
          userEmail: z.string().optional().describe('关联的用户邮箱。'),
          expiresAt: z.number().optional().describe('令牌过期时间戳。'),
        }),
      )
      .describe('应用列表。'),
    total: z.number().describe('应用总数。'),
    defaultAppId: z.string().optional().describe('默认应用 ID。'),
  })
  .describe('飞书应用列表结果。');

type ListAppsInput = z.infer<typeof InputSchema>;
type ListAppsOutput = z.infer<typeof OutputSchema>;

/**
 * 工具逻辑.
 */
async function listAppsLogic(
  _input: ListAppsInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<ListAppsOutput> {
  logger.debug('列出飞书应用', appContext);

  try {
    const storage = container.resolve<IStorageService>(StorageService);
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.listApps',
      tenantId: 'feishu-service',
    });

    // 获取默认应用 ID
    const defaultAppId = await storage.get<string>(
      'feishu/config/default_app',
      ctx,
    );

    // 获取所有已认证的应用
    // 注意：这里需要遍历存储来查找所有 feishu/auth/* 的键
    // 由于 StorageService 可能不支持 list 操作，我们使用一个已知应用列表
    // 在实际实现中，可以维护一个应用列表键
    const appListKey = 'feishu/config/app_list';
    const appIds = (await storage.get<string[]>(appListKey, ctx)) ?? [];

    // 如果有默认应用但不在列表中，添加它
    if (defaultAppId && !appIds.includes(defaultAppId)) {
      appIds.push(defaultAppId);
    }

    const apps: ListAppsOutput['apps'] = [];

    for (const appId of appIds) {
      const auth = await storage.get<StoredFeishuAuth>(
        `feishu/auth/${appId}`,
        ctx,
      );

      if (auth) {
        const now = Date.now();
        const hasValidToken = auth.expiresAt > now;

        apps.push({
          appId,
          isDefault: appId === defaultAppId,
          hasToken: hasValidToken,
          userName: auth.userInfo?.name,
          userEmail: auth.userInfo?.email,
          expiresAt: auth.expiresAt,
        });
      }
    }

    logger.info('获取应用列表成功', {
      ...appContext,
      count: apps.length,
    });

    const result: ListAppsOutput = {
      apps,
      total: apps.length,
    };

    if (defaultAppId) {
      result.defaultAppId = defaultAppId;
    }

    return result;
  } catch (error) {
    logger.error(
      '获取应用列表失败',
      error instanceof Error ? error : new Error(String(error)),
      appContext,
    );

    // 返回空列表而不是抛出错误
    return {
      apps: [],
      total: 0,
    };
  }
}

/**
 * 响应格式化器.
 */
function responseFormatter(result: ListAppsOutput): ContentBlock[] {
  const md = markdown();

  md.h2('🔧 飞书应用列表').keyValue('应用数量', String(result.total));

  if (result.defaultAppId) {
    md.keyValue('默认应用', result.defaultAppId);
  }

  if (result.apps.length === 0) {
    md.blankLine()
      .paragraph('暂无已配置的应用。')
      .blankLine()
      .blockquote(
        '使用 feishu_auth_url 生成授权链接，完成 OAuth 认证后即可添加应用。',
      );
  } else {
    md.blankLine();

    for (const app of result.apps) {
      const statusIcon = app.hasToken ? '✅' : '⚠️';
      const defaultBadge = app.isDefault ? ' [默认]' : '';

      md.text(`${statusIcon} **${app.appId}**${defaultBadge}`);

      if (app.userName) {
        md.text(`   用户: ${app.userName}`);
      }

      if (app.userEmail) {
        md.text(`   邮箱: ${app.userEmail}`);
      }

      if (app.expiresAt) {
        const expiresDate = new Date(app.expiresAt);
        const isExpired = app.expiresAt < Date.now();
        const status = isExpired ? '已过期' : '有效';
        md.text(`   令牌状态: ${status} (${expiresDate.toLocaleString()})`);
      }

      md.blankLine();
    }

    md.blockquote(
      '使用 feishu_set_default_app 可以更改默认应用。令牌过期后需要重新认证。',
    );
  }

  return [
    {
      type: 'text',
      text: md.build(),
    },
  ];
}

/**
 * 飞书应用列表工具定义.
 */
export const feishuListAppsTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:read'], listAppsLogic),
  responseFormatter,
};
