/**
 * @fileoverview 飞书文档上传工具单元测试.
 * 测试 feishu_upload_markdown 工具的输入验证和逻辑.
 * @module tests/unit/mcp-server/tools/feishu/upload.test
 */

import { describe, it, expect } from 'vitest';

describe('飞书文档上传工具', () => {
  describe('feishu_upload_markdown 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuUploadMarkdownTool } =
        await import('@/mcp-server/tools/definitions/feishu-upload-markdown.tool.js');

      expect(feishuUploadMarkdownTool.name).toBe('feishu_upload_markdown');
      expect(feishuUploadMarkdownTool.title).toBe('上传 Markdown 到飞书');
      expect(feishuUploadMarkdownTool.description).toContain('Markdown');
    });

    it('应该有正确的输入 Schema', async () => {
      const { feishuUploadMarkdownTool } =
        await import('@/mcp-server/tools/definitions/feishu-upload-markdown.tool.js');

      const schema = feishuUploadMarkdownTool.inputSchema;

      // 必须提供 filePath 或 content
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(false);

      // 只提供 filePath
      const result2 = schema.safeParse({ filePath: '/path/to/file.md' });
      expect(result2.success).toBe(true);

      // 只提供 content
      const result3 = schema.safeParse({ content: '# Hello' });
      expect(result3.success).toBe(true);

      // 同时提供 filePath 和 content
      const result4 = schema.safeParse({
        filePath: '/path/to/file.md',
        content: '# Hello',
      });
      expect(result4.success).toBe(true);
    });

    it('应该验证 targetType 枚举', async () => {
      const { feishuUploadMarkdownTool } =
        await import('@/mcp-server/tools/definitions/feishu-upload-markdown.tool.js');

      const schema = feishuUploadMarkdownTool.inputSchema;

      // 有效的 targetType
      const result1 = schema.safeParse({
        content: '# Hello',
        targetType: 'drive',
      });
      expect(result1.success).toBe(true);

      const result2 = schema.safeParse({
        content: '# Hello',
        targetType: 'wiki',
      });
      expect(result2.success).toBe(true);

      // 无效的 targetType
      const result3 = schema.safeParse({
        content: '# Hello',
        targetType: 'invalid',
      });
      expect(result3.success).toBe(false);
    });

    it('应该有默认值', async () => {
      const { feishuUploadMarkdownTool } =
        await import('@/mcp-server/tools/definitions/feishu-upload-markdown.tool.js');

      const schema = feishuUploadMarkdownTool.inputSchema;

      const result = schema.safeParse({ content: '# Hello' });
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.targetType).toBe('wiki');
        expect(result.data.uploadImages).toBe(true);
        expect(result.data.uploadAttachments).toBe(true);
        expect(result.data.removeFrontMatter).toBe(true);
      }
    });

    it('应该有正确的输出 Schema', async () => {
      const { feishuUploadMarkdownTool } =
        await import('@/mcp-server/tools/definitions/feishu-upload-markdown.tool.js');

      const schema = feishuUploadMarkdownTool.outputSchema;

      // 成功输出
      const successOutput = {
        success: true,
        documentId: 'doccnXXXXXX',
        url: 'https://xxx.feishu.cn/docx/doccnXXXXXX',
        title: '测试文档',
        uploadedFiles: [
          {
            originalPath: '/path/to/image.png',
            fileName: 'image.png',
            fileKey: 'img_xxx',
            isImage: true,
          },
        ],
      };

      const result1 = schema.safeParse(successOutput);
      expect(result1.success).toBe(true);

      // 失败输出
      const failOutput = {
        success: false,
        error: '上传失败',
      };

      const result2 = schema.safeParse(failOutput);
      expect(result2.success).toBe(true);
    });

    it('应该有正确的注解', async () => {
      const { feishuUploadMarkdownTool } =
        await import('@/mcp-server/tools/definitions/feishu-upload-markdown.tool.js');

      expect(feishuUploadMarkdownTool.annotations?.readOnlyHint).toBe(false);
      expect(feishuUploadMarkdownTool.annotations?.destructiveHint).toBe(false);
      expect(feishuUploadMarkdownTool.annotations?.openWorldHint).toBe(true);
    });
  });

  describe('feishu_update_document 工具', () => {
    it('应该有正确的工具定义', async () => {
      const { feishuUpdateDocumentTool } =
        await import('@/mcp-server/tools/definitions/feishu-update-document.tool.js');

      expect(feishuUpdateDocumentTool.name).toBe('feishu_update_document');
      expect(feishuUpdateDocumentTool.title).toBe('更新飞书文档');
      expect(feishuUpdateDocumentTool.description).toContain('更新');
    });

    it('应该要求 documentId', async () => {
      const { feishuUpdateDocumentTool } =
        await import('@/mcp-server/tools/definitions/feishu-update-document.tool.js');

      const schema = feishuUpdateDocumentTool.inputSchema;

      // 没有 documentId
      const result1 = schema.safeParse({ content: '# Hello' });
      expect(result1.success).toBe(false);

      // 有 documentId
      const result2 = schema.safeParse({
        documentId: 'doccnXXXXXX',
        content: '# Hello',
      });
      expect(result2.success).toBe(true);
    });

    it('应该支持 force 参数', async () => {
      const { feishuUpdateDocumentTool } =
        await import('@/mcp-server/tools/definitions/feishu-update-document.tool.js');

      const schema = feishuUpdateDocumentTool.inputSchema;

      const result = schema.safeParse({
        documentId: 'doccnXXXXXX',
        content: '# Hello',
        force: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(true);
      }
    });

    it('应该有正确的输出 Schema 包含冲突检测', async () => {
      const { feishuUpdateDocumentTool } =
        await import('@/mcp-server/tools/definitions/feishu-update-document.tool.js');

      const schema = feishuUpdateDocumentTool.outputSchema;

      // 冲突输出
      const conflictOutput = {
        success: false,
        documentId: 'doccnXXXXXX',
        conflictDetected: true,
        error: '检测到文档冲突',
      };

      const result = schema.safeParse(conflictOutput);
      expect(result.success).toBe(true);
    });

    it('应该有正确的注解', async () => {
      const { feishuUpdateDocumentTool } =
        await import('@/mcp-server/tools/definitions/feishu-update-document.tool.js');

      expect(feishuUpdateDocumentTool.annotations?.destructiveHint).toBe(true);
    });
  });
});
