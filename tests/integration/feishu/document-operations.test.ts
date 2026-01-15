/**
 * @fileoverview 文档操作集成测试.
 * 测试文档上传、更新等操作.
 * @module tests/integration/feishu/document-operations.test
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
} from './auth-helper.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('文档操作集成测试', () => {
  let feishuService: FeishuService;
  let testDir: string;
  let createdDocuments: string[] = [];

  beforeAll(async () => {
    if (!hasFeishuCredentials) return;

    // 初始化 DI 容器
    composeContainer();

    feishuService = container.resolve(FeishuServiceToken) as FeishuService;

    // 创建测试目录和文件
    testDir = join(process.cwd(), 'test-temp');
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

    // 注意：实际的飞书文档需要手动清理，因为删除 API 可能需要特殊权限
    if (createdDocuments.length > 0) {
      console.log('');
      console.log('🧹 请手动清理以下测试文档：');
      createdDocuments.forEach((docId, index) => {
        console.log(`${index + 1}. https://feishu.cn/docx/${docId}`);
      });
    }
  });

  it.skipIf(!hasFeishuCredentials)(
    '应该能够上传简单的 Markdown 文档',
    async () => {
      // 创建测试 Markdown 文件
      const testMarkdown = `# 集成测试文档

这是一个用于集成测试的 Markdown 文档。

## 功能测试

- 标题转换
- 段落处理
- 列表项目

## 代码示例

\`\`\`javascript
console.log('Hello, Feishu!');
\`\`\`

> 这是一个引用块

**粗体文本** 和 *斜体文本*

测试时间：${new Date().toISOString()}
`;

      const testFile = join(testDir, 'test-simple.md');
      writeFileSync(testFile, testMarkdown, 'utf-8');

      try {
        // 检查是否有有效的认证，如果没有则引导用户认证
        const hasAuth = await checkAuthStatus();
        if (!hasAuth) {
          console.log('🔐 需要先完成 OAuth 认证...');
          await performInteractiveAuth();
        }

        // 上传文档
        const result = await feishuService.uploadMarkdown(
          {
            title: '集成测试文档',
            content: testMarkdown,
            filePath: testFile,
          },
          {
            targetType: 'drive',
            uploadImages: false,
            uploadAttachments: false,
            removeFrontMatter: true,
          },
        );

        expect(result.documentId).toBeDefined();
        expect(result.url).toContain('feishu.cn/docx/');
        expect(result.title).toBeDefined();

        if (result.documentId) {
          if (result.documentId) {
            createdDocuments.push(result.documentId);
          }
        }

        console.log('✅ 简单 Markdown 文档上传成功');
        console.log(`📄 文档 ID: ${result.documentId}`);
        console.log(`🔗 文档链接: ${result.url}`);
        console.log(`📝 文档标题: ${result.title}`);
      } catch (error) {
        console.error('❌ 文档上传失败:', error);
        throw error;
      }
    },
  );

  it.skipIf(!hasFeishuCredentials)('应该能够上传包含图片的文档', async () => {
    // 创建一个简单的测试图片（1x1 像素的 PNG）
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x5c, 0xc2, 0x8a, 0x8b, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const testImage = join(testDir, 'test-image.png');
    writeFileSync(testImage, pngBuffer);

    const testMarkdown = `# 包含图片的测试文档

这个文档包含一个本地图片引用。

![测试图片](./test-image.png)

图片应该被正确上传并替换为飞书的文件链接。

测试时间：${new Date().toISOString()}
`;

    const testFile = join(testDir, 'test-with-image.md');
    writeFileSync(testFile, testMarkdown, 'utf-8');

    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      const result = await feishuService.uploadMarkdown(
        {
          title: '包含图片的测试文档',
          content: testMarkdown,
          filePath: testFile,
        },
        {
          targetType: 'drive',
          uploadImages: true,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
      );

      expect(result.documentId).toBeDefined();
      expect(result.uploadedFiles).toBeDefined();
      expect(result.uploadedFiles!.length).toBeGreaterThan(0);

      if (result.documentId) {
        createdDocuments.push(result.documentId);
      }

      console.log('✅ 包含图片的文档上传成功');
      console.log(`📄 文档 ID: ${result.documentId}`);
      console.log(`🔗 文档链接: ${result.url}`);
      console.log(`🖼️  上传文件数: ${result.uploadedFiles!.length}`);
      result.uploadedFiles!.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file.originalPath} -> ${file.fileKey}`);
      });
    } catch (error) {
      console.error('❌ 图片文档上传失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够更新文档内容', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      // 先创建一个文档
      const initialMarkdown = `# 待更新的文档

这是初始内容。

创建时间：${new Date().toISOString()}
`;

      const testFile = join(testDir, 'test-update.md');
      writeFileSync(testFile, initialMarkdown, 'utf-8');

      const createResult = await feishuService.uploadMarkdown(
        {
          title: '待更新的文档',
          content: initialMarkdown,
          filePath: testFile,
        },
        {
          targetType: 'drive',
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
      );

      if (createResult.documentId) {
        createdDocuments.push(createResult.documentId);
      }

      // 等待一秒确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 更新文档内容
      const updatedMarkdown = `# 已更新的文档

这是更新后的内容。

## 新增章节

- 新增内容 1
- 新增内容 2

更新时间：${new Date().toISOString()}
`;

      writeFileSync(testFile, updatedMarkdown, 'utf-8');

      const updateResult = await feishuService.updateDocument(
        createResult.documentId!,
        {
          title: '已更新的文档',
          content: updatedMarkdown,
          filePath: testFile,
        },
        {
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
          targetType: 'drive',
        },
        false,
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.documentId).toBe(createResult.documentId);
      expect(updateResult.conflictDetected).toBe(false);

      console.log('✅ 文档更新成功');
      console.log(`📄 文档 ID: ${updateResult.documentId}`);
      console.log(`🔗 文档链接: ${updateResult.url}`);
    } catch (error) {
      console.error('❌ 文档更新失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)('应该能够处理强制更新', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      // 创建文档
      const testMarkdown = `# 强制更新测试

这是用于测试强制更新的文档。

创建时间：${new Date().toISOString()}
`;

      const testFile = join(testDir, 'test-force-update.md');
      writeFileSync(testFile, testMarkdown, 'utf-8');

      const createResult = await feishuService.uploadMarkdown(
        {
          title: '强制更新测试',
          content: testMarkdown,
          filePath: testFile,
        },
        {
          targetType: 'drive',
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
      );

      if (createResult.documentId) {
        createdDocuments.push(createResult.documentId);
      }

      // 使用 force=true 更新
      const updatedMarkdown = `# 强制更新成功

这是强制更新后的内容。

更新时间：${new Date().toISOString()}
`;

      writeFileSync(testFile, updatedMarkdown, 'utf-8');

      const updateResult = await feishuService.updateDocument(
        createResult.documentId!,
        {
          title: '强制更新成功',
          content: updatedMarkdown,
          filePath: testFile,
        },
        {
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
          targetType: 'drive',
        },
        true, // 强制更新
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.documentId).toBe(createResult.documentId);

      console.log('✅ 强制更新成功');
      console.log(`📄 文档 ID: ${updateResult.documentId}`);
    } catch (error) {
      console.error('❌ 强制更新失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)(
    '应该能够处理扩展 Markdown 语法',
    async () => {
      const extendedMarkdown = `# 扩展语法测试文档

## Callout 语法测试

> [!note] 注意
> 这是一个注意事项的 Callout。

> [!warning] 警告
> 这是一个警告的 Callout。

> [!tip] 提示
> 这是一个提示的 Callout。

## 高亮和删除线测试

这是 ==高亮文本== 的示例。

这是 ~~删除线文本~~ 的示例。

## 任务列表测试

- [ ] 未完成的任务
- [x] 已完成的任务
- [ ] 另一个未完成的任务

## 代码块过滤测试

\`\`\`javascript
// 这个代码块应该保留
console.log('保留的代码');
\`\`\`

\`\`\`secret
// 这个代码块可能被过滤（如果配置了过滤）
console.log('可能被过滤的代码');
\`\`\`

测试时间：${new Date().toISOString()}
`;

      const testFile = join(testDir, 'test-extended-syntax.md');
      writeFileSync(testFile, extendedMarkdown, 'utf-8');

      try {
        const hasAuth = await checkAuthStatus();
        if (!hasAuth) {
          console.log('🔐 需要先完成 OAuth 认证...');
          await performInteractiveAuth();
        }

        const result = await feishuService.uploadMarkdown(
          {
            title: '扩展语法测试文档',
            content: extendedMarkdown,
            filePath: testFile,
          },
          {
            targetType: 'drive',
            uploadImages: false,
            uploadAttachments: false,
            removeFrontMatter: true,
          },
        );

        expect(result.documentId).toBeDefined();
        if (result.documentId) {
          createdDocuments.push(result.documentId);
        }

        console.log('✅ 扩展语法文档上传成功');
        console.log(`📄 文档 ID: ${result.documentId}`);
        console.log(`🔗 文档链接: ${result.url}`);
        console.log('请手动检查文档中的扩展语法是否正确转换');
      } catch (error) {
        console.error('❌ 扩展语法文档上传失败:', error);
        throw error;
      }
    },
  );
});
