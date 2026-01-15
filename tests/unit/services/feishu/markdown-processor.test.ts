/**
 * @fileoverview MarkdownProcessor 单元测试.
 * 测试 Markdown 语法转换、本地文件引用识别、Front Matter 处理等功能.
 * @module tests/unit/services/feishu/markdown-processor.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownProcessorProvider } from '@/services/feishu/providers/markdown-processor.provider.js';

describe('MarkdownProcessorProvider', () => {
  let processor: MarkdownProcessorProvider;

  beforeEach(() => {
    processor = new MarkdownProcessorProvider();
  });

  describe('基础功能', () => {
    it('应该正确初始化', () => {
      expect(processor.name).toBe('markdown-processor');
    });

    it('healthCheck 应该返回 true', async () => {
      const result = await processor.healthCheck();
      expect(result).toBe(true);
    });

    it('应该处理空内容', () => {
      const result = processor.process('', '/base');
      expect(result.content).toBe('');
      expect(result.localFiles).toHaveLength(0);
    });
  });

  describe('Front Matter 处理', () => {
    it('应该移除 Front Matter（removeFrontMatter=true）', () => {
      const content = `---
title: 测试文档
date: 2025-01-15
---

# 正文内容

这是正文。`;

      const result = processor.process(content, '/base', {
        removeFrontMatter: true,
      });

      expect(result.content).not.toContain('title: 测试文档');
      expect(result.content).toContain('# 正文内容');
      expect(result.frontMatter).toEqual({
        title: '测试文档',
        date: '2025-01-15',
      });
      expect(result.extractedTitle).toBe('测试文档');
    });

    it('应该保留 Front Matter 为代码块（removeFrontMatter=false）', () => {
      const content = `---
title: 测试文档
---

# 正文`;

      const result = processor.process(content, '/base', {
        removeFrontMatter: false,
      });

      expect(result.content).toContain('```yaml');
      expect(result.content).toContain('title: 测试文档');
      expect(result.content).toContain('```');
    });

    it('应该处理没有 Front Matter 的文档', () => {
      const content = '# 标题\n\n正文内容';
      const result = processor.process(content, '/base');

      expect(result.frontMatter).toBeNull();
      expect(result.extractedTitle).toBeNull();
      expect(result.content).toContain('# 标题');
    });

    it('应该处理带引号的 Front Matter 值', () => {
      const content = `---
title: "带引号的标题"
author: '作者名'
---

内容`;

      const result = processor.process(content, '/base', {
        removeFrontMatter: true,
      });

      expect(result.frontMatter?.title).toBe('带引号的标题');
      expect(result.frontMatter?.author).toBe('作者名');
    });
  });

  describe('图片引用处理', () => {
    it('应该识别标准 Markdown 图片语法', () => {
      const content = '![图片描述](./images/test.png)';
      const result = processor.process(content, '/base', {
        processImages: true,
      });

      expect(result.localFiles).toHaveLength(1);
      expect(result.localFiles[0]?.isImage).toBe(true);
      expect(result.localFiles[0]?.fileName).toBe('test.png');
      expect(result.localFiles[0]?.altText).toBe('图片描述');
    });

    it('应该识别 Wiki 风格图片嵌入', () => {
      const content = '![[screenshot.jpg]]';
      const result = processor.process(content, '/base', {
        processImages: true,
      });

      expect(result.localFiles).toHaveLength(1);
      expect(result.localFiles[0]?.isImage).toBe(true);
      expect(result.localFiles[0]?.fileName).toBe('screenshot.jpg');
    });

    it('应该跳过网络图片', () => {
      const content = '![网络图片](https://example.com/image.png)';
      const result = processor.process(content, '/base', {
        processImages: true,
      });

      expect(result.localFiles).toHaveLength(0);
      expect(result.content).toContain('https://example.com/image.png');
    });

    it('应该在禁用图片处理时保留原始语法', () => {
      const content = '![图片](./test.png)';
      const result = processor.process(content, '/base', {
        processImages: false,
      });

      expect(result.localFiles).toHaveLength(0);
      expect(result.content).toContain('![图片](./test.png)');
    });

    it('应该处理多个图片引用', () => {
      const content = `
![图片1](./img1.png)
![图片2](./img2.jpg)
![[img3.gif]]
`;
      const result = processor.process(content, '/base', {
        processImages: true,
      });

      expect(result.localFiles).toHaveLength(3);
      expect(result.localFiles.every((f) => f.isImage)).toBe(true);
    });
  });

  describe('Wiki 链接处理', () => {
    it('应该转换 Wiki 链接为文本', () => {
      const content = '参见 [[其他文档]]';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('📝 其他文档');
    });

    it('应该处理带别名的 Wiki 链接', () => {
      const content = '参见 [[文档名|显示文本]]';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('📝 显示文本');
    });

    it('应该处理文件引用的 Wiki 链接', () => {
      const content = '附件：[[document.pdf]]';
      const result = processor.process(content, '/base', {
        processAttachments: true,
      });

      expect(result.localFiles).toHaveLength(1);
      expect(result.localFiles[0]?.isImage).toBe(false);
      expect(result.localFiles[0]?.fileName).toBe('document.pdf');
    });
  });

  describe('块引用处理', () => {
    it('应该转换块引用为文本', () => {
      const content = '引用：[[文档#^block-id]]';
      const result = processor.process(content, '/base');

      // 块引用被转换为 Wiki 链接格式
      expect(result.content).toContain('📝 文档#^block-id');
    });
  });

  describe('Callout 处理', () => {
    it('应该识别 note 类型 Callout', () => {
      const content = `> [!note] 注意事项
> 这是一条注意事项`;

      const result = processor.process(content, '/base');

      expect(result.calloutBlocks).toBeDefined();
      expect(result.calloutBlocks).toHaveLength(1);
      const callout = result.calloutBlocks![0];
      expect(callout?.type).toBe('note');
      expect(callout?.title).toBe('注意事项');
    });

    it('应该识别 warning 类型 Callout', () => {
      const content = `> [!warning]
> 警告内容`;

      const result = processor.process(content, '/base');

      expect(result.calloutBlocks).toBeDefined();
      expect(result.calloutBlocks).toHaveLength(1);
      const callout = result.calloutBlocks![0];
      expect(callout?.type).toBe('warning');
    });

    it('应该处理可折叠 Callout', () => {
      const content = `> [!tip]- 可折叠提示
> 折叠内容`;

      const result = processor.process(content, '/base');

      expect(result.calloutBlocks).toBeDefined();
      expect(result.calloutBlocks).toHaveLength(1);
      const callout = result.calloutBlocks![0];
      expect(callout?.foldable).toBe(true);
    });

    it('应该处理多行 Callout 内容', () => {
      const content = `> [!info] 信息
> 第一行
> 第二行
> 第三行`;

      const result = processor.process(content, '/base');

      expect(result.calloutBlocks).toBeDefined();
      expect(result.calloutBlocks).toHaveLength(1);
      const callout = result.calloutBlocks![0];
      expect(callout?.content).toContain('第一行');
      expect(callout?.content).toContain('第二行');
      expect(callout?.content).toContain('第三行');
    });
  });

  describe('代码块过滤', () => {
    it('应该过滤指定语言的代码块', () => {
      const content = `
\`\`\`dataviewjs
dv.table(...)
\`\`\`

\`\`\`javascript
console.log('hello');
\`\`\`
`;

      const result = processor.process(content, '/base', {
        codeBlockFilterLanguages: ['dataviewjs'],
      });

      expect(result.content).not.toContain('dv.table');
      expect(result.content).toContain("console.log('hello')");
    });

    it('应该忽略大小写进行过滤', () => {
      const content = `
\`\`\`DATAVIEWJS
code
\`\`\`
`;

      const result = processor.process(content, '/base', {
        codeBlockFilterLanguages: ['dataviewjs'],
      });

      expect(result.content).not.toContain('code');
    });

    it('应该在空过滤列表时保留所有代码块', () => {
      const content = `
\`\`\`dataviewjs
code
\`\`\`
`;

      const result = processor.process(content, '/base', {
        codeBlockFilterLanguages: [],
      });

      expect(result.content).toContain('code');
    });
  });

  describe('高亮语法处理', () => {
    it('应该转换高亮语法为 mark 标签', () => {
      const content = '这是 ==高亮文本== 示例';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('<mark>高亮文本</mark>');
      expect(result.content).not.toContain('==');
    });

    it('应该处理多个高亮', () => {
      const content = '==第一个== 和 ==第二个==';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('<mark>第一个</mark>');
      expect(result.content).toContain('<mark>第二个</mark>');
    });
  });

  describe('标签处理', () => {
    it('应该保留标签格式', () => {
      const content = '这是 #标签 示例';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('#标签');
    });

    it('应该处理英文标签', () => {
      const content = '#tag1 #tag2';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('#tag1');
      expect(result.content).toContain('#tag2');
    });
  });

  describe('链接处理', () => {
    it('应该保留标准 Markdown 链接', () => {
      const content = '[链接文本](https://example.com)';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('[链接文本](https://example.com)');
    });

    it('应该转换 Obsidian 协议链接', () => {
      const content = '[打开](obsidian://open?vault=test)';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('打开(obsidian://open?vault=test)');
      expect(result.content).not.toContain('[打开]');
    });
  });

  describe('空白处理', () => {
    it('应该合并多个空行', () => {
      const content = '第一段\n\n\n\n\n第二段';
      const result = processor.process(content, '/base');

      // 多个空行被合并为两个换行
      expect(result.content).toBe('第一段\n\n第二段');
    });

    it('应该移除行尾空白', () => {
      const content = '文本   \n下一行';
      const result = processor.process(content, '/base');

      expect(result.content).toBe('文本\n下一行');
    });
  });

  describe('路径解析', () => {
    it('应该正确解析相对路径', () => {
      const content = '![图片](./images/test.png)';
      const result = processor.process(content, '/project/docs', {
        processImages: true,
      });

      expect(result.localFiles[0]?.originalPath).toBe(
        '/project/docs/images/test.png',
      );
    });

    it('应该保留绝对路径', () => {
      const content = '![图片](/absolute/path/image.png)';
      const result = processor.process(content, '/base', {
        processImages: true,
      });

      expect(result.localFiles[0]?.originalPath).toBe(
        '/absolute/path/image.png',
      );
    });
  });

  describe('边界情况', () => {
    it('应该处理只有 Front Matter 的文档', () => {
      const content = `---
title: 仅标题
---`;

      const result = processor.process(content, '/base', {
        removeFrontMatter: true,
      });

      expect(result.frontMatter?.title).toBe('仅标题');
      expect(result.content.trim()).toBe('');
    });

    it('应该处理特殊字符', () => {
      const content = '包含特殊字符：<>&"\'';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('<>&"\'');
    });

    it('应该处理中文内容', () => {
      const content = '# 中文标题\n\n这是中文内容，包含**加粗**和*斜体*。';
      const result = processor.process(content, '/base');

      expect(result.content).toContain('中文标题');
      expect(result.content).toContain('**加粗**');
    });
  });
});
