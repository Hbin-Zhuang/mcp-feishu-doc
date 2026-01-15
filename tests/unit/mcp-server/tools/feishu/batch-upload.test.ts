/**
 * @fileoverview 飞书批量上传工具单元测试.
 * 测试 feishu_batch_upload_markdown 工具的输入验证和逻辑.
 * @module tests/unit/mcp-server/tools/feishu/batch-upload.test
 */

import { describe, it, expect } from 'vitest';

describe('飞书批量上传工具', () => {
  describe('feishu_batch_upload_markdown 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      expect(feishuBatchUploadTool.name).toBe('feishu_batch_upload_markdown');
      expect(feishuBatchUploadTool.title).toBe('批量上传 Markdown 到飞书');
      expect(feishuBatchUploadTool.description).toContain('批量');
    });

    it('应该要求 documents 数组', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.inputSchema;

      // 没有 documents
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(false);

      // 空 documents 数组
      const result2 = schema.safeParse({ documents: [] });
      expect(result2.success).toBe(false);

      // 有效的 documents
      const result3 = schema.safeParse({
        documents: [{ content: '# Hello' }],
      });
      expect(result3.success).toBe(true);
    });

    it('应该验证 documents 数组中的每个文档', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.inputSchema;

      // 文档必须有 filePath 或 content
      const result1 = schema.safeParse({
        documents: [{}],
      });
      expect(result1.success).toBe(false);

      // 有效的文档（使用 content）
      const result2 = schema.safeParse({
        documents: [{ content: '# Doc 1' }, { content: '# Doc 2' }],
      });
      expect(result2.success).toBe(true);

      // 有效的文档（使用 filePath）
      const result3 = schema.safeParse({
        documents: [{ filePath: '/path/to/doc.md' }],
      });
      expect(result3.success).toBe(true);

      // 混合使用
      const result4 = schema.safeParse({
        documents: [{ content: '# Doc 1' }, { filePath: '/path/to/doc.md' }],
      });
      expect(result4.success).toBe(true);
    });

    it('应该支持并发控制参数', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.inputSchema;

      const result = schema.safeParse({
        documents: [{ content: '# Hello' }],
        concurrency: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.concurrency).toBe(5);
      }
    });

    it('应该有默认的并发数', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.inputSchema;

      const result = schema.safeParse({
        documents: [{ content: '# Hello' }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.concurrency).toBe(3);
      }
    });

    it('应该支持全局配置选项', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.inputSchema;

      const result = schema.safeParse({
        documents: [{ content: '# Hello' }],
        appId: 'cli_xxx',
        uploadImages: false,
        uploadAttachments: false,
        removeFrontMatter: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.appId).toBe('cli_xxx');
        expect(result.data.uploadImages).toBe(false);
        expect(result.data.uploadAttachments).toBe(false);
        expect(result.data.removeFrontMatter).toBe(false);
      }
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.outputSchema;

      // 成功输出
      const successOutput = {
        total: 3,
        succeeded: 2,
        failed: 1,
        results: [
          {
            index: 0,
            success: true,
            documentId: 'doccn1',
            url: 'https://xxx.feishu.cn/docx/doccn1',
            title: '文档1',
          },
          {
            index: 1,
            success: true,
            documentId: 'doccn2',
            url: 'https://xxx.feishu.cn/docx/doccn2',
            title: '文档2',
          },
          {
            index: 2,
            success: false,
            error: '上传失败',
          },
        ],
      };

      const result = schema.safeParse(successOutput);
      expect(result.success).toBe(true);
    });

    it('应该有正确的注解', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      expect(feishuBatchUploadTool.annotations?.readOnlyHint).toBe(false);
      expect(feishuBatchUploadTool.annotations?.destructiveHint).toBe(false);
    });

    it('应该支持文档级别的配置覆盖', async () => {
      const { feishuBatchUploadTool } =
        await import('@/mcp-server/tools/definitions/feishu-batch-upload.tool.js');

      const schema = feishuBatchUploadTool.inputSchema;

      const result = schema.safeParse({
        documents: [
          {
            content: '# Doc 1',
            targetType: 'wiki',
            targetId: 'wiki_space_1',
          },
          {
            content: '# Doc 2',
            targetType: 'drive',
            targetId: 'folder_token',
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documents[0]?.targetType).toBe('wiki');
        expect(result.data.documents[1]?.targetType).toBe('drive');
      }
    });
  });
});
