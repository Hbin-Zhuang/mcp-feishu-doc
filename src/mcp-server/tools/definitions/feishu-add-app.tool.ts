/**
 * @fileoverview 飞书多应用配置工具.
 * 添加新的飞书应用配置（appId + appSecret），支持多应用场景.
 * @module src/mcp-server/tools/definitions/feishu-add-app.tool
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

const TOOL_NAME = 'feishu_add_app';
const TOOL_TITLE = '添加飞书应用配置';
const TOOL_DESCRIPTION = `添加或更新飞书应用的配置信息（appId + appSecret）。

功能特性：
- 将应用密钥（appSecret）持久化到存储中，供后续 Token 刷新使用
- 支持在环境变量之外动态配置多个飞书应用
- 配置成功后可通过 feishu_auth_url 为该应用发起 OAuth 授权

使用场景：
- 需要接入多个飞书应用时
- 不希望在环境变量中硬编码所有应用密钥时

注意：appSecret 属于敏感信息，将以明文存储在配置的 StorageService 中，请确保存储后端安全。`;

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ============================================================================
// Schema
// ============================================================================

const InputSchema = z
  .object({
    appId: z
      .string()
      .min(1, '应用 ID 不能为空')
      .describe('飞书应用 ID（App ID），可在飞书开放平台应用详情页获取。'),
    appSecret: z
      .string()
      .min(1, '应用密钥不能为空')
      .describe('飞书应用密钥（App Secret），可在飞书开放平台应用详情页获取。'),
  })
  .describe('添加飞书应用配置的参数。');

const OutputSchema = z
  .object({
    success: z.boolean().describe('是否配置成功。'),
    appId: z.string().describe('已配置的应用 ID。'),
    message: z.string().describe('操作结果说明。'),
  })
  .describe('飞书应用配置结果。');

type AddAppInput = z.infer<typeof InputSchema>;
type AddAppOutput = z.infer<typeof OutputSchema>;

// ============================================================================
// 逻辑
// ============================================================================

async function addAppLogic(
  input: AddAppInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<AddAppOutput> {
  logger.debug('开始添加飞书应用配置', {
    ...appContext,
    appId: input.appId,
  });

  const context = requestContextService.createRequestContext({
    operation: 'feishu.addApp',
    tenantId: 'feishu-service',
  });

  const feishuService = container.resolve<FeishuService>(
    FeishuServiceToken as symbol,
  );

  const result = await feishuService.addApp(
    context,
    input.appId,
    input.appSecret,
  );

  logger.info('飞书应用配置成功', { ...context, appId: input.appId });

  return {
    success: result.success,
    appId: result.appId,
    message: `应用 ${input.appId} 配置成功。请使用 feishu_auth_url 工具为该应用发起 OAuth 授权。`,
  };
}

// ============================================================================
// 响应格式化
// ============================================================================

function responseFormatter(result: AddAppOutput): ContentBlock[] {
  const md = markdown();

  if (result.success) {
    md.h2('✅ 应用配置成功')
      .keyValue('应用 ID', result.appId)
      .blankLine()
      .paragraph(result.message)
      .blankLine()
      .h3('后续步骤')
      .text('1. 使用 `feishu_auth_url` 工具生成该应用的 OAuth 授权链接')
      .text('2. 在浏览器中完成授权')
      .text('3. 使用 `feishu_auth_callback` 工具完成 Token 换取')
      .text('4. 使用 `feishu_set_default_app` 将该应用设为默认（可选）');
  } else {
    md.h2('❌ 应用配置失败')
      .keyValue('应用 ID', result.appId)
      .paragraph(result.message);
  }

  return [{ type: 'text', text: md.build() }];
}

// ============================================================================
// 导出
// ============================================================================

export const feishuAddAppTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:feishu:write'], addAppLogic),
  responseFormatter,
};
