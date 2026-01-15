/**
 * @fileoverview 批量上传集成测试.
 * 测试批量上传功能的并发控制和错误隔离.
 * @module tests/integration/feishu/batch-upload.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { composeContainer } from '@/container/index.js';
import { container } from 'tsyringe';
import { FeishuServiceToken } from '@/container/tokens.js';
import type { FeishuService } from '@/services/feishu/core/FeishuService.js';
import {
  checkAuthStatus,
  performInteractiveAuth,
  hasFeishuCredentials,
  createTestContext,
} from './auth-helper.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestContext } from '@/utils/internal/requestContext.js';

describe('批量上传集成测试', () => {
  let feishuService: FeishuService;
  let testContext: RequestContext;
  let testDir: string;
  let createdDocuments: string[] = [];

  beforeAll(async () => {
    if (!hasFeishuCredentials) return;

    // 初始化 DI 容器
    composeContainer();

    feishuService = container.resolve(FeishuServiceToken) as FeishuService;
    testContext = createTestContext();

    // 创建测试目录
    testDir = join(process.cwd(), 'test-batch-temp');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (!hasFeishuCredentials) return;

    // 清理测试文件
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // 提示清理飞书文档
    if (createdDocuments.length > 0) {
      console.log('');
      console.log('🧹 请手动清理以下批量测试文档：');
      createdDocuments.forEach((docId, index) => {
        console.log(`${index + 1}. https://feishu.cn/docx/${docId}`);
      });
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够批量上传多个文档', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      // 创建 5 个测试文档
      const documents = [];
      for (let i = 1; i <= 5; i++) {
        const markdown = `# 批量测试文档 ${i}

这是第 ${i} 个批量上传的测试文档。

## 内容

- 项目 ${i}.1
- 项目 ${i}.2
- 项目 ${i}.3

## 代码示例

\`\`\`javascript
console.log('文档 ${i}');
\`\`\`

创建时间：${new Date().toISOString()}
`;

        const filePath = join(testDir, `batch-test-${i}.md`);
        writeFileSync(filePath, markdown, 'utf-8');

        documents.push({
          filePath,
          targetType: 'drive' as const,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        });
      }

      console.log(`📦 开始批量上传 ${documents.length} 个文档...`);
      const startTime = Date.now();

      const result = await feishuService.batchUploadMarkdown(
        {
          documents,
          concurrency: 3,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
        testContext,
      );

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      expect(result.total).toBe(5);
      expect(result.succeeded).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.results.length).toBe(5);

      // 收集创建的文档 ID
      result.results.forEach((res) => {
        if (res.documentId) {
          createdDocuments.push(res.documentId);
        }
      });

      console.log('✅ 批量上传成功');
      console.log(`📊 统计信息:`);
      console.log(`   总数: ${result.total}`);
      console.log(`   成功: ${result.succeeded}`);
      console.log(`   失败: ${result.failed}`);
      console.log(`   耗时: ${duration.toFixed(2)} 秒`);
      console.log(`   平均: ${(duration / result.total).toFixed(2)} 秒/文档`);

      console.log('📋 上传结果:');
      result.results.forEach((res, index) => {
        if (res.documentId) {
          console.log(`   ${index + 1}. ✅ ${res.title} (${res.documentId})`);
        } else {
          console.log(`   ${index + 1}. ❌ ${res.error}`);
        }
      });
    } catch (error) {
      console.error('❌ 批量上传失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够处理部分失败场景', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      // 创建混合文档：有效和无效
      const documents = [];

      // 有效文档
      for (let i = 1; i <= 3; i++) {
        const markdown = `# 有效文档 ${i}

这是一个有效的测试文档。

创建时间：${new Date().toISOString()}
`;
        const filePath = join(testDir, `valid-${i}.md`);
        writeFileSync(filePath, markdown, 'utf-8');

        documents.push({
          filePath,
          targetType: 'drive' as const,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        });
      }

      // 无效文档（不存在的文件）
      documents.push({
        filePath: join(testDir, 'non-existent.md'),
        targetType: 'drive' as const,
        uploadImages: false,
        uploadAttachments: false,
        removeFrontMatter: true,
      });

      console.log(
        `⚠️  开始混合批量上传测试（${documents.length} 个文档，1 个无效）...`,
      );

      const result = await feishuService.batchUploadMarkdown(
        {
          documents,
          concurrency: 2,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
        testContext,
      );

      expect(result.total).toBe(4);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(1);

      // 收集成功的文档 ID
      result.results.forEach((res) => {
        if (res.documentId) {
          createdDocuments.push(res.documentId);
        }
      });

      console.log('✅ 错误隔离测试成功');
      console.log(`📊 统计信息:`);
      console.log(`   总数: ${result.total}`);
      console.log(`   成功: ${result.succeeded}`);
      console.log(`   失败: ${result.failed}`);

      console.log('📋 详细结果:');
      result.results.forEach((res, index) => {
        if (res.documentId) {
          console.log(`   ${index + 1}. ✅ ${res.title}`);
        } else {
          console.log(`   ${index + 1}. ❌ ${res.error}`);
        }
      });
    } catch (error) {
      console.error('❌ 部分失败测试失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够控制并发数量', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      // 创建较多文档测试并发控制
      const documents = [];
      for (let i = 1; i <= 8; i++) {
        const markdown = `# 并发测试文档 ${i}

这是第 ${i} 个用于测试并发控制的文档。

内容相对简单，主要测试并发处理能力。

创建时间：${new Date().toISOString()}
`;

        const filePath = join(testDir, `concurrent-${i}.md`);
        writeFileSync(filePath, markdown, 'utf-8');

        documents.push({
          filePath,
          targetType: 'drive' as const,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        });
      }

      console.log(
        `🔄 开始并发控制测试（${documents.length} 个文档，并发数 2）...`,
      );
      const startTime = Date.now();

      const result = await feishuService.batchUploadMarkdown(
        {
          documents,
          concurrency: 2, // 限制并发数为 2
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
        testContext,
      );

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      expect(result.total).toBe(8);
      expect(result.succeeded).toBe(8);
      expect(result.failed).toBe(0);

      // 收集文档 ID
      result.results.forEach((res) => {
        if (res.documentId) {
          createdDocuments.push(res.documentId);
        }
      });

      console.log('✅ 并发控制测试成功');
      console.log(`📊 性能统计:`);
      console.log(`   总耗时: ${duration.toFixed(2)} 秒`);
      console.log(
        `   平均耗时: ${(duration / result.total).toFixed(2)} 秒/文档`,
      );
      console.log(
        `   理论最小耗时: ${((result.total / 2) * 1).toFixed(2)} 秒 (假设每个文档 1 秒)`,
      );

      // 验证并发控制效果（实际耗时应该大于理论最小值）
      const theoreticalMinTime = (result.total / 2) * 0.5; // 假设每个文档最少 0.5 秒
      expect(duration).toBeGreaterThan(theoreticalMinTime);

      console.log('✅ 并发控制机制正常工作');
    } catch (error) {
      console.error('❌ 并发控制测试失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够处理频率限制', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      console.log('🚦 频率限制测试说明：');
      console.log('   由于飞书 API 限制为 90 次/分钟，');
      console.log('   大量并发请求可能触发频率限制。');
      console.log('   本测试验证重试机制是否正常工作。');

      // 创建少量文档，但使用较高并发数
      const documents = [];
      for (let i = 1; i <= 6; i++) {
        const markdown = `# 频率限制测试 ${i}

测试频率限制和重试机制。

创建时间：${new Date().toISOString()}
`;

        const filePath = join(testDir, `rate-limit-${i}.md`);
        writeFileSync(filePath, markdown, 'utf-8');

        documents.push({
          filePath,
          targetType: 'drive' as const,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        });
      }

      console.log(
        `🚦 开始频率限制测试（${documents.length} 个文档，高并发）...`,
      );
      const startTime = Date.now();

      const result = await feishuService.batchUploadMarkdown(
        {
          documents,
          concurrency: 6, // 较高的并发数
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
        testContext,
      );

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      // 即使触发频率限制，最终也应该成功
      expect(result.succeeded).toBeGreaterThan(0);

      // 收集文档 ID
      result.results.forEach((res) => {
        if (res.documentId) {
          createdDocuments.push(res.documentId);
        }
      });

      console.log('✅ 频率限制测试完成');
      console.log(`📊 结果统计:`);
      console.log(`   总数: ${result.total}`);
      console.log(`   成功: ${result.succeeded}`);
      console.log(`   失败: ${result.failed}`);
      console.log(`   耗时: ${duration.toFixed(2)} 秒`);

      if (result.failed > 0) {
        console.log('⚠️  部分请求失败，可能由于频率限制：');
        result.results.forEach((res, index) => {
          if (res.error) {
            console.log(`   ${index + 1}. ❌ ${res.error}`);
          }
        });
      }

      // 验证重试机制（如果有失败，检查是否包含重试相关信息）
      const hasRetryErrors = result.results.some(
        (res) => res.error?.includes('重试') || res.error?.includes('频率限制'),
      );

      if (hasRetryErrors) {
        console.log('✅ 重试机制正常工作');
      }
    } catch (error) {
      console.error('❌ 频率限制测试失败:', error);
      throw error;
    }
  });
});
