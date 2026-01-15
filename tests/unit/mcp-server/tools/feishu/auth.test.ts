/**
 * @fileoverview 飞书 OAuth 工具单元测试.
 * 测试 feishu_auth_url 和 feishu_auth_callback 工具.
 * @module tests/unit/mcp-server/tools/feishu/auth.test
 */

import { describe, it, expect } from 'vitest';

describe('飞书 OAuth 工具', () => {
  describe('feishu_auth_url 工具', () => {
    it('应该有正确的工具定义', async () => {
      // 动态导入以避免 DI 容器问题
      const { feishuAuthUrlTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-url.tool.js');

      expect(feishuAuthUrlTool.name).toBe('feishu_auth_url');
      expect(feishuAuthUrlTool.title).toBe('飞书授权链接');
      expect(feishuAuthUrlTool.description).toContain('OAuth 2.0');
    });

    it('应该有正确的输入 Schema', async () => {
      const { feishuAuthUrlTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-url.tool.js');

      const schema = feishuAuthUrlTool.inputSchema;

      // 验证 appId 是可选的
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(true);

      // 验证 appId 可以提供
      const result2 = schema.safeParse({ appId: 'test-app-id' });
      expect(result2.success).toBe(true);

      // 验证 redirectUri 必须是有效 URL
      const result3 = schema.safeParse({
        redirectUri: 'not-a-url',
      });
      expect(result3.success).toBe(false);

      // 验证有效的 redirectUri
      const result4 = schema.safeParse({
        redirectUri: 'https://example.com/callback',
      });
      expect(result4.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuAuthUrlTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-url.tool.js');

      const schema = feishuAuthUrlTool.outputSchema;

      // 验证输出结构
      const validOutput = {
        authUrl: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
        state: 'random-state-string',
        appId: 'cli_xxx',
        expiresIn: 300,
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('应该有正确的注解', async () => {
      const { feishuAuthUrlTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-url.tool.js');

      expect(feishuAuthUrlTool.annotations?.readOnlyHint).toBe(true);
      expect(feishuAuthUrlTool.annotations?.idempotentHint).toBe(true);
    });
  });

  describe('feishu_auth_callback 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuAuthCallbackTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-callback.tool.js');

      expect(feishuAuthCallbackTool.name).toBe('feishu_auth_callback');
      expect(feishuAuthCallbackTool.title).toBe('飞书授权回调');
      expect(feishuAuthCallbackTool.description).toContain('授权回调');
    });

    it('应该有正确的输入 Schema', async () => {
      const { feishuAuthCallbackTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-callback.tool.js');

      const schema = feishuAuthCallbackTool.inputSchema;

      // code 和 state 是必需的
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(false);

      // 只有 code 不够
      const result2 = schema.safeParse({ code: 'auth-code' });
      expect(result2.success).toBe(false);

      // code 和 state 都提供
      const result3 = schema.safeParse({
        code: 'auth-code',
        state: 'state-string',
      });
      expect(result3.success).toBe(true);

      // 可选的 appId
      const result4 = schema.safeParse({
        code: 'auth-code',
        state: 'state-string',
        appId: 'app-id',
      });
      expect(result4.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuAuthCallbackTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-callback.tool.js');

      const schema = feishuAuthCallbackTool.outputSchema;

      // 验证成功输出
      const validOutput = {
        success: true,
        appId: 'cli_xxx',
        expiresAt: Date.now() + 7200000,
        message: '授权成功！欢迎 测试用户',
        userInfo: {
          userId: 'user-id',
          name: '测试用户',
        },
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('应该有正确的注解', async () => {
      const { feishuAuthCallbackTool } =
        await import('@/mcp-server/tools/definitions/feishu-auth-callback.tool.js');

      expect(feishuAuthCallbackTool.annotations?.destructiveHint).toBe(false);
    });
  });
});
