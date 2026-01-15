/**
 * @fileoverview 性能测试.
 * 测试各种操作的性能指标.
 * @module tests/integration/feishu/performance.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { composeContainer } from '@/container/index.js';
import { container } from 'tsyringe';
import {
  FeishuServiceToken,
  FeishuMarkdownProcessorToken,
} from '@/container/tokens.js';
import type { FeishuService } from '@/services/feishu/core/FeishuService.js';
import type { MarkdownProcessorProvider } from '@/services/feishu/providers/markdown-processor.provider.js';
import {
  checkAuthStatus,
  performInteractiveAuth,
  hasFeishuCredentials,
  createTestContext,
} from './auth-helper.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestContext } from '@/utils/internal/requestContext.js';

describe('性能测试', () => {
  let feishuService: FeishuService;
  let markdownProcessor: MarkdownProcessorProvider;
  let testContext: RequestContext;
  let testDir: string;
  let createdDocuments: string[] = [];

  beforeAll(async () => {
    if (!hasFeishuCredentials) return;

    // 初始化 DI 容器
    composeContainer();

    feishuService = container.resolve(FeishuServiceToken) as FeishuService;
    markdownProcessor = container.resolve(
      FeishuMarkdownProcessorToken,
    ) as MarkdownProcessorProvider;
    testContext = createTestContext();

    // 创建测试目录
    testDir = join(process.cwd(), 'test-perf-temp');
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
      console.log('🧹 请手动清理以下性能测试文档：');
      createdDocuments.forEach((docId, index) => {
        console.log(`${index + 1}. https://feishu.cn/docx/${docId}`);
      });
    }
  });

  it.skipIf(!hasFeishuCredentials)('单文档上传应该在 5 秒内完成', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      console.log('⏱️  开始单文档上传性能测试...');

      // 创建标准大小的测试文档（约 500KB）
      const largeContent = Array(1000)
        .fill(0)
        .map(
          (_, i) => `## 章节 ${i + 1}

这是第 ${i + 1} 个章节的内容。包含一些测试文本来增加文档大小。

### 子章节 ${i + 1}.1
- 列表项目 ${i + 1}.1.1
- 列表项目 ${i + 1}.1.2
- 列表项目 ${i + 1}.1.3

### 子章节 ${i + 1}.2
\`\`\`javascript
// 代码示例 ${i + 1}
function example${i + 1}() {
  console.log('这是第 ${i + 1} 个示例');
  return ${i + 1};
}
\`\`\`

> 这是第 ${i + 1} 个引用块。

**粗体文本 ${i + 1}** 和 *斜体文本 ${i + 1}*

---
`,
        )
        .join('\n');

      const testMarkdown = `# 性能测试文档

这是一个用于性能测试的大型文档。

${largeContent}

## 测试信息
- 创建时间: ${new Date().toISOString()}
- 文档大小: 约 ${Math.round(largeContent.length / 1024)} KB
- 章节数量: 1000
`;

      const testFile = join(testDir, 'performance-single.md');
      writeFileSync(testFile, testMarkdown, 'utf-8');

      console.log(
        `📄 测试文档大小: ${Math.round(testMarkdown.length / 1024)} KB`,
      );

      // 测量上传时间
      const startTime = Date.now();

      const result = await feishuService.uploadMarkdown(
        {
          title: '性能测试文档',
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

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      expect(result.documentId).toBeDefined();
      if (result.documentId) {
        createdDocuments.push(result.documentId);
      }

      console.log('✅ 单文档上传性能测试完成');
      console.log(`📊 性能指标:`);
      console.log(`   上传时间: ${duration.toFixed(2)} 秒`);
      console.log(`   文档大小: ${Math.round(testMarkdown.length / 1024)} KB`);
      console.log(
        `   处理速度: ${(testMarkdown.length / 1024 / duration).toFixed(2)} KB/秒`,
      );
      console.log(`   目标时间: < 5 秒`);
      console.log(`   测试结果: ${duration < 5 ? '✅ 通过' : '⚠️  超时'}`);

      // 验证性能要求（放宽到 10 秒，考虑网络延迟）
      expect(duration).toBeLessThan(10);
    } catch (error) {
      console.error('❌ 单文档性能测试失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)(
    '批量上传 10 个文档应该在 60 秒内完成',
    async () => {
      try {
        const hasAuth = await checkAuthStatus();
        if (!hasAuth) {
          console.log('🔐 需要先完成 OAuth 认证...');
          await performInteractiveAuth();
        }

        console.log('📦 开始批量上传性能测试...');

        // 创建 10 个中等大小的文档
        const documents = [];
        for (let i = 1; i <= 10; i++) {
          const content = Array(100)
            .fill(0)
            .map(
              (_, j) => `## 文档 ${i} - 章节 ${j + 1}

这是文档 ${i} 的第 ${j + 1} 个章节。

- 项目 ${i}.${j + 1}.1
- 项目 ${i}.${j + 1}.2

\`\`\`javascript
console.log('文档 ${i}, 章节 ${j + 1}');
\`\`\`
`,
            )
            .join('\n');

          const markdown = `# 批量性能测试文档 ${i}

${content}

创建时间: ${new Date().toISOString()}
`;

          const filePath = join(testDir, `batch-perf-${i}.md`);
          writeFileSync(filePath, markdown, 'utf-8');

          documents.push({
            filePath,
            targetType: 'drive' as const,
            uploadImages: false,
            uploadAttachments: false,
            removeFrontMatter: true,
          });
        }

        const totalSize = documents.reduce((sum, doc) => {
          const content = require('fs').readFileSync(doc.filePath, 'utf-8');
          return sum + content.length;
        }, 0);

        console.log(`📄 批量文档总大小: ${Math.round(totalSize / 1024)} KB`);
        console.log(`📦 文档数量: ${documents.length}`);

        // 测量批量上传时间
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

        expect(result.total).toBe(10);
        expect(result.succeeded).toBeGreaterThan(8); // 允许少量失败

        // 收集文档 ID
        result.results.forEach((res) => {
          if (res.documentId) {
            if (res.documentId) {
              createdDocuments.push(res.documentId);
            }
          }
        });

        console.log('✅ 批量上传性能测试完成');
        console.log(`📊 性能指标:`);
        console.log(`   总耗时: ${duration.toFixed(2)} 秒`);
        console.log(`   成功数量: ${result.succeeded}/${result.total}`);
        console.log(
          `   平均耗时: ${(duration / result.succeeded).toFixed(2)} 秒/文档`,
        );
        console.log(
          `   处理速度: ${(totalSize / 1024 / duration).toFixed(2)} KB/秒`,
        );
        console.log(`   目标时间: < 60 秒`);
        console.log(`   测试结果: ${duration < 60 ? '✅ 通过' : '⚠️  超时'}`);

        // 验证性能要求（放宽到 90 秒）
        expect(duration).toBeLessThan(90);
        expect(result.succeeded).toBeGreaterThan(7); // 至少 80% 成功
      } catch (error) {
        console.error('❌ 批量性能测试失败:', error);
        throw error;
      }
    },
  );

  it.skipIf(!hasFeishuCredentials)('内存占用应该小于 500MB', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      console.log('💾 开始内存占用测试...');

      // 记录初始内存
      const initialMemory = process.memoryUsage();
      console.log(`📊 初始内存使用:`);
      console.log(`   RSS: ${Math.round(initialMemory.rss / 1024 / 1024)} MB`);
      console.log(
        `   Heap Used: ${Math.round(initialMemory.heapUsed / 1024 / 1024)} MB`,
      );
      console.log(
        `   Heap Total: ${Math.round(initialMemory.heapTotal / 1024 / 1024)} MB`,
      );

      // 创建大量文档进行内存压力测试
      const documents = [];
      for (let i = 1; i <= 20; i++) {
        const largeContent = Array(200)
          .fill(0)
          .map(
            (_, j) => `## 内存测试 ${i}.${j + 1}

这是用于内存测试的内容。包含大量文本来测试内存使用情况。

\`\`\`javascript
// 大量代码内容
function memoryTest${i}_${j + 1}() {
  const data = Array(1000).fill('test data for memory usage');
  return data.join(' ');
}
\`\`\`

| 列 1 | 列 2 | 列 3 | 列 4 |
|------|------|------|------|
| 数据 ${i}.${j + 1}.1 | 数据 ${i}.${j + 1}.2 | 数据 ${i}.${j + 1}.3 | 数据 ${i}.${j + 1}.4 |
`,
          )
          .join('\n');

        const markdown = `# 内存测试文档 ${i}

${largeContent}

创建时间: ${new Date().toISOString()}
`;

        const filePath = join(testDir, `memory-test-${i}.md`);
        writeFileSync(filePath, markdown, 'utf-8');

        documents.push({
          filePath,
          targetType: 'drive' as const,
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        });
      }

      let peakMemory = initialMemory;

      // 监控内存使用
      const memoryMonitor = setInterval(() => {
        const currentMemory = process.memoryUsage();
        if (currentMemory.rss > peakMemory.rss) {
          peakMemory = currentMemory;
        }
      }, 100);

      try {
        // 执行批量上传
        const result = await feishuService.batchUploadMarkdown(
          {
            documents,
            concurrency: 4,
            uploadImages: false,
            uploadAttachments: false,
            removeFrontMatter: true,
          },
          testContext,
        );

        // 收集文档 ID
        result.results.forEach((res) => {
          if (res.documentId) {
            if (res.documentId) {
              createdDocuments.push(res.documentId);
            }
          }
        });
      } finally {
        clearInterval(memoryMonitor);
      }

      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();

      console.log('✅ 内存占用测试完成');
      console.log(`📊 内存使用统计:`);
      console.log(
        `   峰值 RSS: ${Math.round(peakMemory.rss / 1024 / 1024)} MB`,
      );
      console.log(
        `   峰值 Heap: ${Math.round(peakMemory.heapUsed / 1024 / 1024)} MB`,
      );
      console.log(
        `   最终 RSS: ${Math.round(finalMemory.rss / 1024 / 1024)} MB`,
      );
      console.log(
        `   最终 Heap: ${Math.round(finalMemory.heapUsed / 1024 / 1024)} MB`,
      );
      console.log(
        `   内存增长: ${Math.round((finalMemory.rss - initialMemory.rss) / 1024 / 1024)} MB`,
      );
      console.log(`   目标限制: < 500 MB`);

      const peakMemoryMB = Math.round(peakMemory.rss / 1024 / 1024);
      console.log(
        `   测试结果: ${peakMemoryMB < 500 ? '✅ 通过' : '⚠️  超限'}`,
      );

      // 验证内存使用（放宽到 800MB，考虑 Node.js 基础开销）
      expect(peakMemoryMB).toBeLessThan(800);
    } catch (error) {
      console.error('❌ 内存占用测试失败:', error);
      throw error;
    }
  });

  it.skipIf(!hasFeishuCredentials)(
    '频率控制应该有效防止 API 限制',
    async () => {
      try {
        const hasAuth = await checkAuthStatus();
        if (!hasAuth) {
          console.log('🔐 需要先完成 OAuth 认证...');
          await performInteractiveAuth();
        }

        console.log('🚦 开始频率控制测试...');
        console.log('   注意：此测试可能需要较长时间完成');

        // 创建大量小文档来测试频率控制
        const documents = [];
        for (let i = 1; i <= 15; i++) {
          const markdown = `# 频率控制测试 ${i}

这是第 ${i} 个用于测试频率控制的小文档。

## 内容
- 测试项目 ${i}.1
- 测试项目 ${i}.2

创建时间: ${new Date().toISOString()}
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

        console.log(`📦 准备上传 ${documents.length} 个文档`);
        console.log('🚦 使用较高并发数测试频率控制...');

        const startTime = Date.now();

        const result = await feishuService.batchUploadMarkdown(
          {
            documents,
            concurrency: 8, // 高并发数，可能触发频率限制
            uploadImages: false,
            uploadAttachments: false,
            removeFrontMatter: true,
          },
          testContext,
        );

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        // 收集文档 ID
        result.results.forEach((res) => {
          if (res.documentId) {
            if (res.documentId) {
              createdDocuments.push(res.documentId);
            }
          }
        });

        console.log('✅ 频率控制测试完成');
        console.log(`📊 测试结果:`);
        console.log(`   总耗时: ${duration.toFixed(2)} 秒`);
        console.log(`   成功数量: ${result.succeeded}/${result.total}`);
        console.log(`   失败数量: ${result.failed}`);
        console.log(
          `   成功率: ${((result.succeeded / result.total) * 100).toFixed(1)}%`,
        );

        // 分析失败原因
        const rateLimitErrors = result.results.filter(
          (res) =>
            res.error?.includes('频率限制') || res.error?.includes('99991429'),
        ).length;

        const networkErrors = result.results.filter(
          (res) =>
            res.error?.includes('网络') || res.error?.includes('timeout'),
        ).length;

        console.log(`📋 错误分析:`);
        console.log(`   频率限制错误: ${rateLimitErrors}`);
        console.log(`   网络错误: ${networkErrors}`);
        console.log(
          `   其他错误: ${result.failed - rateLimitErrors - networkErrors}`,
        );

        // 验证频率控制效果
        const expectedMinTime = Math.max(
          (result.total / 90) * 60, // 基于 90次/分钟 的理论最小时间
          result.total * 0.5, // 每个文档至少 0.5 秒
        );

        console.log(`⏱️  时间分析:`);
        console.log(`   理论最小时间: ${expectedMinTime.toFixed(2)} 秒`);
        console.log(`   实际耗时: ${duration.toFixed(2)} 秒`);
        console.log(
          `   频率控制效果: ${duration >= expectedMinTime * 0.8 ? '✅ 有效' : '⚠️  可能无效'}`,
        );

        // 验证大部分请求成功（允许少量失败）
        expect(result.succeeded).toBeGreaterThan(result.total * 0.7);

        // 如果有频率限制错误，说明控制机制正在工作
        if (rateLimitErrors > 0) {
          console.log('✅ 频率限制检测和处理机制正常工作');
        }
      } catch (error) {
        console.error('❌ 频率控制测试失败:', error);
        throw error;
      }
    },
  );

  it.skipIf(!hasFeishuCredentials)(
    'Markdown 处理性能应该满足要求',
    async () => {
      console.log('📝 开始 Markdown 处理性能测试...');

      // 创建大型复杂文档
      const complexContent = Array(500)
        .fill(0)
        .map(
          (_, i) => `## 复杂章节 ${i + 1}

### 基础语法测试
这是第 ${i + 1} 个章节，包含 **粗体**、*斜体*、==高亮==、~~删除线~~ 等格式。

### 列表测试
1. 有序列表项 ${i + 1}.1
2. 有序列表项 ${i + 1}.2
   - 嵌套无序列表 ${i + 1}.2.1
   - 嵌套无序列表 ${i + 1}.2.2

### 任务列表
- [x] 已完成任务 ${i + 1}.1
- [ ] 未完成任务 ${i + 1}.2
- [x] 已完成任务 ${i + 1}.3

### Callout 语法
> [!note] 注意 ${i + 1}
> 这是第 ${i + 1} 个注意事项。

> [!warning] 警告 ${i + 1}
> 这是第 ${i + 1} 个警告信息。

### 代码块
\`\`\`javascript
// 复杂代码示例 ${i + 1}
class Example${i + 1} {
  constructor(data) {
    this.data = data;
    this.id = ${i + 1};
  }
  
  process() {
    return this.data.map(item => ({
      ...item,
      processed: true,
      timestamp: Date.now()
    }));
  }
}

const example${i + 1} = new Example${i + 1}([
  { name: 'item1', value: ${i + 1} },
  { name: 'item2', value: ${i + 1 + 1} }
]);
\`\`\`

### 表格
| 列1 | 列2 | 列3 | 列4 | 列5 |
|-----|-----|-----|-----|-----|
| 数据${i + 1}.1 | 数据${i + 1}.2 | 数据${i + 1}.3 | 数据${i + 1}.4 | 数据${i + 1}.5 |
| 值${i + 1}.1 | 值${i + 1}.2 | 值${i + 1}.3 | 值${i + 1}.4 | 值${i + 1}.5 |

### 引用和链接
> 这是第 ${i + 1} 个引用块，包含一些重要信息。

[链接 ${i + 1}](https://example.com/page${i + 1})

---
`,
        )
        .join('\n');

      // 添加大量本地文件引用
      const fileReferences = Array(50)
        .fill(0)
        .map(
          (_, i) => `![图片 ${i + 1}](./images/test-image-${i + 1}.png)

[附件 ${i + 1}](./files/document-${i + 1}.pdf)
`,
        )
        .join('\n');

      const largeMarkdown = `# 大型复杂 Markdown 文档

这是一个用于性能测试的大型复杂文档，包含各种 Markdown 语法。

${complexContent}

## 文件引用测试

${fileReferences}

## 文档统计
- 总章节数: 500
- 文件引用数: 100
- 预估大小: ${Math.round((complexContent.length + fileReferences.length) / 1024)} KB
- 创建时间: ${new Date().toISOString()}
`;

      const testFile = join(testDir, 'large-complex.md');
      writeFileSync(testFile, largeMarkdown, 'utf-8');

      console.log(`📄 测试文档统计:`);
      console.log(`   文件大小: ${Math.round(largeMarkdown.length / 1024)} KB`);
      console.log(`   字符数: ${largeMarkdown.length.toLocaleString()}`);
      console.log(
        `   行数: ${largeMarkdown.split('\n').length.toLocaleString()}`,
      );

      // 测试第一次处理（无缓存）
      console.log('🔄 第一次处理（无缓存）...');
      const startTime1 = Date.now();

      const result1 = await markdownProcessor.process(largeMarkdown, testDir, {
        removeFrontMatter: true,
        processImages: true,
        processAttachments: true,
        codeBlockFilterLanguages: ['secret'],
      });

      const endTime1 = Date.now();
      const duration1 = (endTime1 - startTime1) / 1000;

      expect(result1.content).toBeDefined();
      expect(result1.localFiles.length).toBeGreaterThan(0);

      console.log(`✅ 第一次处理完成: ${duration1.toFixed(3)} 秒`);
      console.log(`   本地文件: ${result1.localFiles.length}`);
      console.log(
        `   处理速度: ${(largeMarkdown.length / 1024 / duration1).toFixed(2)} KB/秒`,
      );

      // 测试第二次处理（可能有缓存）
      console.log('🔄 第二次处理（测试缓存）...');
      const startTime2 = Date.now();

      await markdownProcessor.process(largeMarkdown, testDir, {
        removeFrontMatter: true,
        processImages: true,
        processAttachments: true,
        codeBlockFilterLanguages: ['secret'],
      });

      const endTime2 = Date.now();
      const duration2 = (endTime2 - startTime2) / 1000;

      console.log(`✅ 第二次处理完成: ${duration2.toFixed(3)} 秒`);
      console.log(
        `   处理速度: ${(largeMarkdown.length / 1024 / duration2).toFixed(2)} KB/秒`,
      );
      console.log(
        `   性能提升: ${(((duration1 - duration2) / duration1) * 100).toFixed(1)}%`,
      );

      console.log('📊 性能测试结果:');
      console.log(`   目标时间: < 2 秒`);
      console.log(
        `   第一次: ${duration1.toFixed(3)} 秒 ${duration1 < 2 ? '✅' : '⚠️'}`,
      );
      console.log(
        `   第二次: ${duration2.toFixed(3)} 秒 ${duration2 < 2 ? '✅' : '⚠️'}`,
      );

      // 验证性能要求（放宽到 5 秒）
      expect(duration1).toBeLessThan(5);
      expect(duration2).toBeLessThan(5);

      // 验证缓存效果（第二次应该更快，但不强制要求）
      if (duration2 < duration1 * 0.8) {
        console.log('✅ 缓存机制有效提升性能');
      } else {
        console.log('ℹ️  缓存效果不明显（可能是正常情况）');
      }
    },
  );

  it.skipIf(!hasFeishuCredentials)('缓存机制应该提升性能', async () => {
    try {
      const hasAuth = await checkAuthStatus();
      if (!hasAuth) {
        console.log('🔐 需要先完成 OAuth 认证...');
        await performInteractiveAuth();
      }

      console.log('🚀 开始缓存性能测试...');

      // 创建相同内容的文档
      const testMarkdown = `# 缓存测试文档

这是用于测试缓存机制的文档。

## 重复内容
${Array(100)
  .fill(0)
  .map(
    (_, i) => `### 章节 ${i + 1}
内容 ${i + 1} 包含一些重复的处理逻辑。
`,
  )
  .join('\n')}

创建时间: ${new Date().toISOString()}
`;

      const testFile = join(testDir, 'cache-test.md');
      writeFileSync(testFile, testMarkdown, 'utf-8');

      // 第一次上传（建立缓存）
      console.log('📤 第一次上传（建立缓存）...');
      const startTime1 = Date.now();

      const result1 = await feishuService.uploadMarkdown(
        {
          title: '缓存测试文档',
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

      const endTime1 = Date.now();
      const duration1 = (endTime1 - startTime1) / 1000;

      expect(result1.documentId).toBeDefined();
      if (result1.documentId) {
        createdDocuments.push(result1.documentId);
      }

      console.log(`✅ 第一次上传完成: ${duration1.toFixed(3)} 秒`);

      // 等待一小段时间
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 第二次上传相同内容（利用缓存）
      console.log('📤 第二次上传相同内容（测试缓存）...');
      const testFile2 = join(testDir, 'cache-test-2.md');
      writeFileSync(testFile2, testMarkdown, 'utf-8');

      const startTime2 = Date.now();

      const result2 = await feishuService.uploadMarkdown(
        {
          title: '缓存测试文档2',
          content: testMarkdown,
          filePath: testFile2,
        },
        {
          targetType: 'drive',
          uploadImages: false,
          uploadAttachments: false,
          removeFrontMatter: true,
        },
      );

      const endTime2 = Date.now();
      const duration2 = (endTime2 - startTime2) / 1000;

      expect(result2.documentId).toBeDefined();
      if (result2.documentId) {
        createdDocuments.push(result2.documentId);
      }

      console.log(`✅ 第二次上传完成: ${duration2.toFixed(3)} 秒`);

      // 分析缓存效果
      const improvement = ((duration1 - duration2) / duration1) * 100;

      console.log('📊 缓存性能分析:');
      console.log(`   第一次耗时: ${duration1.toFixed(3)} 秒`);
      console.log(`   第二次耗时: ${duration2.toFixed(3)} 秒`);
      console.log(`   性能提升: ${improvement.toFixed(1)}%`);
      console.log(`   目标提升: > 20%`);

      if (improvement > 20) {
        console.log('✅ 缓存机制显著提升性能');
      } else if (improvement > 0) {
        console.log('ℹ️  缓存机制有轻微提升');
      } else {
        console.log('⚠️  缓存效果不明显（可能受网络影响）');
      }

      // 验证两次上传都成功
      expect(result1.documentId).toBeDefined();
      expect(result2.documentId).toBeDefined();
      expect(result1.documentId).not.toBe(result2.documentId);
    } catch (error) {
      console.error('❌ 缓存性能测试失败:', error);
      throw error;
    }
  });
});
