/**
 * @fileoverview 飞书文档读取工具单元测试.
 * 验证 feishu_get_document 的 Schema 与多模态响应格式化行为.
 * @module tests/unit/mcp-server/tools/feishu/get-document.test
 */

import { describe, expect, it } from 'vitest';
import { ContentBlockSchema } from '@modelcontextprotocol/sdk/types.js';

describe('飞书文档读取工具', () => {
  it('应该有正确的工具定义', async () => {
    const { feishuGetDocumentTool } = await import(
      '@/mcp-server/tools/definitions/feishu-get-document.tool.js'
    );

    expect(feishuGetDocumentTool.name).toBe('feishu_get_document');
    expect(feishuGetDocumentTool.title).toBe('读取飞书文档内容');
    expect(feishuGetDocumentTool.description).toContain('Block API');
  });

  it('应该输出按顺序交错的文本、图片和附件内容块', async () => {
    const { feishuGetDocumentTool } = await import(
      '@/mcp-server/tools/definitions/feishu-get-document.tool.js'
    );

    const content = feishuGetDocumentTool.responseFormatter?.({
      documentId: 'doc_123',
      title: '多模态文档',
      content:
        '开场段落\n\n[图片1：diagram.png]\n\n插图后的说明\n\n[附件1：data.csv]\n\n结尾段落',
      revisionId: 42,
      blocks: [
        {
          blockId: 'text_1',
          type: 'text',
          text: '开场段落',
        },
        {
          blockId: 'image_1',
          type: 'image',
          fileToken: 'img_token_1',
          placeholderText: '[图片1：diagram.png]',
        },
        {
          blockId: 'text_2',
          type: 'text',
          text: '插图后的说明',
        },
        {
          blockId: 'file_1',
          type: 'file',
          fileToken: 'file_token_1',
          placeholderText: '[附件1：data.csv]',
        },
        {
          blockId: 'text_3',
          type: 'text',
          text: '结尾段落',
        },
      ],
      assets: [
        {
          fileToken: 'img_token_1',
          type: 'image',
          fileName: 'diagram.png',
          mimeType: 'image/png',
          byteLength: 4,
          base64Data: 'iVBORw==',
        },
        {
          fileToken: 'file_token_1',
          type: 'file',
          fileName: 'data.csv',
          mimeType: 'text/csv',
          byteLength: 14,
          localPath: '/tmp/data.csv',
          previewText: 'alpha,beta\n1,2',
        },
      ],
    });

    expect(content).toBeDefined();
    expect(content?.map((block) => block.type)).toEqual([
      'text',
      'text',
      'image',
      'text',
      'resource',
      'text',
    ]);

    const imageBlock = content?.find((block) => block.type === 'image');
    const resourceBlock = content?.find((block) => block.type === 'resource');

    expect(imageBlock).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      data: 'iVBORw==',
    });
    expect(resourceBlock).toMatchObject({
      type: 'resource',
      resource: {
        uri: 'file:///tmp/data.csv',
        mimeType: 'text/plain',
        text: expect.stringContaining('alpha,beta'),
      },
    });
    expect(ContentBlockSchema.safeParse(resourceBlock).success).toBe(true);
  });

  it('图片未内联时应该回退为文本提示块', async () => {
    const { feishuGetDocumentTool } = await import(
      '@/mcp-server/tools/definitions/feishu-get-document.tool.js'
    );

    const content = feishuGetDocumentTool.responseFormatter?.({
      documentId: 'doc_456',
      title: '图片降级文档',
      content: '正文\n\n[图片1：oversized.png]',
      revisionId: 7,
      blocks: [
        {
          blockId: 'text_1',
          type: 'text',
          text: '正文',
        },
        {
          blockId: 'image_1',
          type: 'image',
          fileToken: 'img_token_oversized',
          placeholderText: '[图片1：oversized.png]',
        },
      ],
      assets: [
        {
          fileToken: 'img_token_oversized',
          type: 'image',
          fileName: 'oversized.png',
          mimeType: 'image/png',
          byteLength: 3_000_000,
          localPath: '/tmp/oversized.png',
          deliveryMode: 'local_file_only',
          status: 'skipped_too_large',
          reason: '图片超过单张内联大小限制',
        },
      ],
    });

    expect(content?.map((block) => block.type)).toEqual(['text', 'text', 'text']);
    expect(content?.[2]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('oversized.png'),
    });
    expect(content?.[2]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('/tmp/oversized.png'),
    });
  });
});
