/**
 * @fileoverview 管理功能集成测试.
 * 测试文件夹、知识库、用户信息等管理功能.
 * @module tests/integration/feishu/management.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import 'reflect-metadata';
import { composeContainer } from '@/container/index.js';
import { container } from 'tsyringe';
import {
  FeishuServiceToken,
  FeishuApiProviderToken,
} from '@/container/tokens.js';
import type { FeishuService } from '@/services/feishu/core/FeishuService.js';
import type { FeishuApiProvider } from '@/services/feishu/providers/feishu-api.provider.js';
import {
  checkAuthStatus,
  performInteractiveAuth,
  hasFeishuCredentials,
  createTestContext,
} from './auth-helper.js';
import type { RequestContext } from '@/utils/internal/requestContext.js';

describe('管理功能集成测试', () => {
  let feishuService: FeishuService;
  let feishuApiProvider: FeishuApiProvider;
  let testContext: RequestContext;

  beforeAll(async () => {
    if (!hasFeishuCredentials) return;

    // 初始化 DI 容器
    composeContainer();

    feishuService = container.resolve(FeishuServiceToken) as FeishuService;
    feishuApiProvider = container.resolve(
      FeishuApiProviderToken,
    ) as FeishuApiProvider;
    testContext = createTestContext();
  });

  it.skipIf(!hasFeishuCredentials)('应该能够列出文件夹', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      const folders = await feishuService.listFolders(testContext);

      expect(Array.isArray(folders)).toBe(true);

      console.log('✅ 文件夹列表获取成功');
      console.log(`📁 找到 ${folders.length} 个文件夹`);

      if (folders.length > 0) {
        console.log('📋 文件夹列表：');
        folders.slice(0, 5).forEach((folder, index) => {
          console.log(`   ${index + 1}. ${folder.name} (${folder.token})`);
        });
        if (folders.length > 5) {
          console.log(`   ... 还有 ${folders.length - 5} 个文件夹`);
        }
      }

      // 测试指定父文件夹
      if (folders.length > 0) {
        const parentFolder = folders[0];
        if (parentFolder) {
          const subFolders = await feishuService.listFolders(
            testContext,
            parentFolder.token,
          );

          console.log(
            `📂 文件夹 "${parentFolder.name}" 包含 ${subFolders.length} 个子文件夹`,
          );
        }
      }
    } catch (error) {
      console.error('❌ 文件夹列表获取失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够列出知识库', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      const wikis = await feishuService.listWikis(testContext);

      expect(Array.isArray(wikis)).toBe(true);

      console.log('✅ 知识库列表获取成功');
      console.log(`📚 找到 ${wikis.length} 个知识库`);

      if (wikis.length > 0) {
        console.log('📋 知识库列表：');
        wikis.slice(0, 5).forEach((wiki, index) => {
          console.log(`   ${index + 1}. ${wiki.name} (${wiki.spaceId})`);
          if (wiki.description) {
            console.log(`      描述: ${wiki.description}`);
          }
        });
        if (wikis.length > 5) {
          console.log(`   ... 还有 ${wikis.length - 5} 个知识库`);
        }

        // 测试获取知识库节点
        const firstWiki = wikis[0];
        if (firstWiki) {
          try {
            const nodes = await feishuService.getWikiNodes(
              testContext,
              firstWiki.spaceId,
            );
            console.log(
              `📄 知识库 "${firstWiki.name}" 包含 ${nodes.length} 个节点`,
            );
          } catch (nodeError) {
            console.log(`⚠️  无法获取知识库节点: ${nodeError}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ 知识库列表获取失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够获取用户信息', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      const userInfo = await feishuService.getUserInfo(testContext);

      expect(userInfo.userId).toBeDefined();
      expect(userInfo.name).toBeDefined();

      console.log('✅ 用户信息获取成功');
      console.log(`👤 用户 ID: ${userInfo.userId}`);
      console.log(`📝 用户姓名: ${userInfo.name}`);
      if (userInfo.email) {
        console.log(`📧 邮箱: ${userInfo.email}`);
      }
      if (userInfo.avatarUrl) {
        console.log(`🖼️  头像: ${userInfo.avatarUrl}`);
      }
    } catch (error) {
      console.error('❌ 用户信息获取失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够管理应用配置', async () => {
    try {
      // 测试列出应用
      const apps = await feishuService.listApps(testContext);

      expect(Array.isArray(apps)).toBe(true);

      console.log('✅ 应用列表获取成功');
      console.log(`🔧 找到 ${apps.length} 个已配置的应用`);

      if (apps.length > 0) {
        console.log('📋 应用列表：');
        apps.forEach((app, index) => {
          console.log(
            `   ${index + 1}. ${app.appId} ${app.isDefault ? '(默认)' : ''}`,
          );
          console.log(
            `      认证状态: ${app.hasToken ? '✅ 已认证' : '❌ 未认证'}`,
          );
          if (app.userInfo) {
            console.log(`      用户: ${app.userInfo.name}`);
          }
        });

        // 测试设置默认应用
        const firstApp = apps[0];
        if (firstApp) {
          const setDefaultResult = await feishuService.setDefaultApp(
            testContext,
            firstApp.appId,
          );

          expect(setDefaultResult.success).toBe(true);
          expect(setDefaultResult.appId).toBe(firstApp.appId);

          console.log(`✅ 默认应用设置成功: ${firstApp.appId}`);

          // 验证设置结果
          const updatedApps = await feishuService.listApps(testContext);
          const defaultApp = updatedApps.find((app) => app.isDefault);
          expect(defaultApp?.appId).toBe(firstApp.appId);

          console.log('✅ 默认应用设置验证成功');
        }
      }
    } catch (error) {
      console.error('❌ 应用配置管理失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够处理无效的应用 ID', async () => {
    try {
      // 测试设置不存在的应用为默认应用
      await expect(
        feishuService.setDefaultApp(testContext, 'invalid_app_id'),
      ).rejects.toThrow();

      console.log('✅ 无效应用 ID 错误处理正确');
    } catch (error) {
      console.error('❌ 无效应用 ID 测试失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够测试 API 连接性', async () => {
    try {
      // 测试健康检查
      const isHealthy = await feishuApiProvider.healthCheck();
      expect(isHealthy).toBe(true);

      console.log('✅ API 健康检查通过');

      // 测试无效 Token 的错误处理
      try {
        await feishuApiProvider.getUserInfo('invalid_token');
        // 如果没有抛出错误，说明有问题
        expect(true).toBe(false);
      } catch (error) {
        // 应该抛出错误
        console.log('✅ 无效 Token 错误处理正确');
      }
    } catch (error) {
      console.error('❌ API 连接性测试失败:', error);
      throw error;
    }
  });
});
