/**
 * @fileoverview 飞书管理工具单元测试.
 * 测试文件夹、知识库、用户信息、应用配置等管理工具.
 * @module tests/unit/mcp-server/tools/feishu/management.test
 */

import { describe, it, expect } from 'vitest';

describe('飞书管理工具', () => {
  describe('feishu_list_folders 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuListFoldersTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-folders.tool.js');

      expect(feishuListFoldersTool.name).toBe('feishu_list_folders');
      expect(feishuListFoldersTool.title).toBe('列出飞书文件夹');
      expect(feishuListFoldersTool.description).toContain('文件夹');
    });

    it('应该有正确的输入 Schema', async () => {
      const { feishuListFoldersTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-folders.tool.js');

      const schema = feishuListFoldersTool.inputSchema;

      // 所有参数都是可选的
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(true);

      // 可以提供 parentId
      const result2 = schema.safeParse({ parentId: 'folder_token' });
      expect(result2.success).toBe(true);

      // 可以提供 appId
      const result3 = schema.safeParse({ appId: 'cli_xxx' });
      expect(result3.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuListFoldersTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-folders.tool.js');

      const schema = feishuListFoldersTool.outputSchema;

      const validOutput = {
        folders: [
          {
            token: 'folder_token_1',
            name: '文件夹1',
            parentToken: 'root',
          },
          {
            token: 'folder_token_2',
            name: '文件夹2',
          },
        ],
        total: 2,
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('应该有 readOnlyHint 注解', async () => {
      const { feishuListFoldersTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-folders.tool.js');

      expect(feishuListFoldersTool.annotations?.readOnlyHint).toBe(true);
    });
  });

  describe('feishu_list_wikis 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuListWikisTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-wikis.tool.js');

      expect(feishuListWikisTool.name).toBe('feishu_list_wikis');
      expect(feishuListWikisTool.title).toBe('列出飞书知识库');
      expect(feishuListWikisTool.description).toContain('知识库');
    });

    it('应该有正确的输入 Schema', async () => {
      const { feishuListWikisTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-wikis.tool.js');

      const schema = feishuListWikisTool.inputSchema;

      // 所有参数都是可选的
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuListWikisTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-wikis.tool.js');

      const schema = feishuListWikisTool.outputSchema;

      const validOutput = {
        wikis: [
          {
            spaceId: 'wiki_space_1',
            name: '知识库1',
            description: '描述',
          },
        ],
        total: 1,
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('应该有 readOnlyHint 注解', async () => {
      const { feishuListWikisTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-wikis.tool.js');

      expect(feishuListWikisTool.annotations?.readOnlyHint).toBe(true);
    });
  });

  describe('feishu_get_user_info 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuGetUserInfoTool } =
        await import('@/mcp-server/tools/definitions/feishu-get-user-info.tool.js');

      expect(feishuGetUserInfoTool.name).toBe('feishu_get_user_info');
      expect(feishuGetUserInfoTool.title).toBe('获取飞书用户信息');
      expect(feishuGetUserInfoTool.description).toContain('用户');
    });

    it('应该有正确的输入 Schema', async () => {
      const { feishuGetUserInfoTool } =
        await import('@/mcp-server/tools/definitions/feishu-get-user-info.tool.js');

      const schema = feishuGetUserInfoTool.inputSchema;

      // appId 是可选的
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuGetUserInfoTool } =
        await import('@/mcp-server/tools/definitions/feishu-get-user-info.tool.js');

      const schema = feishuGetUserInfoTool.outputSchema;

      const validOutput = {
        userId: 'user_id_xxx',
        name: '测试用户',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.png',
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('应该有 readOnlyHint 注解', async () => {
      const { feishuGetUserInfoTool } =
        await import('@/mcp-server/tools/definitions/feishu-get-user-info.tool.js');

      expect(feishuGetUserInfoTool.annotations?.readOnlyHint).toBe(true);
    });
  });

  describe('feishu_set_default_app 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuSetDefaultAppTool } =
        await import('@/mcp-server/tools/definitions/feishu-set-default-app.tool.js');

      expect(feishuSetDefaultAppTool.name).toBe('feishu_set_default_app');
      expect(feishuSetDefaultAppTool.title).toBe('设置默认飞书应用');
      expect(feishuSetDefaultAppTool.description).toContain('默认');
    });

    it('应该要求 appId', async () => {
      const { feishuSetDefaultAppTool } =
        await import('@/mcp-server/tools/definitions/feishu-set-default-app.tool.js');

      const schema = feishuSetDefaultAppTool.inputSchema;

      // 没有 appId
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(false);

      // 有 appId
      const result2 = schema.safeParse({ appId: 'cli_xxx' });
      expect(result2.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuSetDefaultAppTool } =
        await import('@/mcp-server/tools/definitions/feishu-set-default-app.tool.js');

      const schema = feishuSetDefaultAppTool.outputSchema;

      const validOutput = {
        success: true,
        appId: 'cli_xxx',
        message: '设置成功',
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });
  });

  describe('feishu_list_apps 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuListAppsTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-apps.tool.js');

      expect(feishuListAppsTool.name).toBe('feishu_list_apps');
      expect(feishuListAppsTool.title).toBe('列出飞书应用');
      expect(feishuListAppsTool.description).toContain('应用');
    });

    it('应该有正确的输入 Schema（无参数）', async () => {
      const { feishuListAppsTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-apps.tool.js');

      const schema = feishuListAppsTool.inputSchema;

      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuListAppsTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-apps.tool.js');

      const schema = feishuListAppsTool.outputSchema;

      const validOutput = {
        apps: [
          {
            appId: 'cli_xxx',
            isDefault: true,
            hasToken: true,
            userName: '测试用户',
          },
        ],
        total: 1,
        defaultAppId: 'cli_xxx',
      };

      const result = schema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('应该有 readOnlyHint 注解', async () => {
      const { feishuListAppsTool } =
        await import('@/mcp-server/tools/definitions/feishu-list-apps.tool.js');

      expect(feishuListAppsTool.annotations?.readOnlyHint).toBe(true);
    });
  });
});
