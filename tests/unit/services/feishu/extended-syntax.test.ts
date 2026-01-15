/**
 * @fileoverview 扩展 Markdown 语法测试.
 * 测试删除线、任务列表、高亮等扩展语法的转换.
 * @module tests/unit/services/feishu/extended-syntax.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownProcessorProvider } from '@/services/feishu/providers/markdown-processor.provider.js';

describe('扩展 Markdown 语法', () => {
  let processor: MarkdownProcessorProvider;

  beforeEach(() => {
    processor = new MarkdownProcessorProvider();
  });

  describe('高亮语法 (T702)', () => {
    it('应该将 ==text== 转换为 <mark>text</mark>', () => {
      const content = '这是 ==高亮文本== 示例';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<mark>高亮文本</mark>');
      expect(result.content).not.toContain('==');
    });

    it('应该处理多个高亮', () => {
      const content = '==第一个== 和 ==第二个== 高亮';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<mark>第一个</mark>');
      expect(result.content).toContain('<mark>第二个</mark>');
    });

    it('应该处理包含空格的高亮', () => {
      const content = '==这是 带空格的 高亮==';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<mark>这是 带空格的 高亮</mark>');
    });

    it('不应该处理不完整的高亮语法', () => {
      const content = '这是 ==不完整的高亮';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('==不完整的高亮');
    });
  });

  describe('删除线语法 (T703)', () => {
    it('应该将 ~~text~~ 转换为 <del>text</del>', () => {
      const content = '这是 ~~删除的文本~~ 示例';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<del>删除的文本</del>');
      expect(result.content).not.toContain('~~');
    });

    it('应该处理多个删除线', () => {
      const content = '~~第一个~~ 和 ~~第二个~~ 删除';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<del>第一个</del>');
      expect(result.content).toContain('<del>第二个</del>');
    });

    it('应该处理包含空格的删除线', () => {
      const content = '~~这是 带空格的 删除线~~';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<del>这是 带空格的 删除线</del>');
    });

    it('不应该处理不完整的删除线语法', () => {
      const content = '这是 ~~不完整的删除线';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('~~不完整的删除线');
    });
  });

  describe('任务列表语法 (T704)', () => {
    it('应该将未完成任务 - [ ] 转换为 ☐', () => {
      const content = '- [ ] 未完成的任务';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('☐ 未完成的任务');
      expect(result.content).not.toContain('- [ ]');
    });

    it('应该将已完成任务 - [x] 转换为 ☑', () => {
      const content = '- [x] 已完成的任务';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('☑ 已完成的任务');
      expect(result.content).not.toContain('- [x]');
    });

    it('应该处理大写 X', () => {
      const content = '- [X] 已完成的任务';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('☑ 已完成的任务');
    });

    it('应该处理多个任务', () => {
      const content = `- [ ] 任务一
- [x] 任务二
- [ ] 任务三`;
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('☐ 任务一');
      expect(result.content).toContain('☑ 任务二');
      expect(result.content).toContain('☐ 任务三');
    });

    it('应该保留缩进', () => {
      const content = '  - [ ] 缩进的任务';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('  ☐ 缩进的任务');
    });

    it('应该处理嵌套任务列表', () => {
      const content = `- [ ] 父任务
  - [x] 子任务一
  - [ ] 子任务二`;
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('☐ 父任务');
      expect(result.content).toContain('  ☑ 子任务一');
      expect(result.content).toContain('  ☐ 子任务二');
    });
  });

  describe('混合语法', () => {
    it('应该同时处理高亮和删除线', () => {
      const content = '==高亮== 和 ~~删除~~';
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('<mark>高亮</mark>');
      expect(result.content).toContain('<del>删除</del>');
    });

    it('应该同时处理任务列表和其他语法', () => {
      const content = `- [ ] ==高亮任务==
- [x] ~~删除任务~~`;
      const result = processor.process(content, '/tmp');

      expect(result.content).toContain('☐ <mark>高亮任务</mark>');
      expect(result.content).toContain('☑ <del>删除任务</del>');
    });
  });

  describe('代码块过滤 (T706)', () => {
    it('应该过滤指定语言的代码块', () => {
      const content = `# 标题

\`\`\`javascript
console.log('hello');
\`\`\`

正文内容

\`\`\`python
print('hello')
\`\`\``;

      const result = processor.process(content, '/tmp', {
        codeBlockFilterLanguages: ['javascript'],
      });

      expect(result.content).not.toContain('console.log');
      expect(result.content).toContain("print('hello')");
    });

    it('应该支持大小写不敏感的过滤', () => {
      const content = `\`\`\`JavaScript
console.log('hello');
\`\`\``;

      const result = processor.process(content, '/tmp', {
        codeBlockFilterLanguages: ['javascript'],
      });

      expect(result.content).not.toContain('console.log');
    });

    it('应该支持过滤多种语言', () => {
      const content = `\`\`\`javascript
js code
\`\`\`

\`\`\`typescript
ts code
\`\`\`

\`\`\`python
py code
\`\`\``;

      const result = processor.process(content, '/tmp', {
        codeBlockFilterLanguages: ['javascript', 'typescript'],
      });

      expect(result.content).not.toContain('js code');
      expect(result.content).not.toContain('ts code');
      expect(result.content).toContain('py code');
    });

    it('空过滤列表不应该过滤任何代码块', () => {
      const content = `\`\`\`javascript
console.log('hello');
\`\`\``;

      const result = processor.process(content, '/tmp', {
        codeBlockFilterLanguages: [],
      });

      expect(result.content).toContain('console.log');
    });
  });

  describe('Callout 语法 (T701)', () => {
    it('应该识别 note callout', () => {
      const content = `> [!note]
> 这是一个笔记`;

      const result = processor.process(content, '/tmp');

      expect(result.calloutBlocks).toBeDefined();
      expect(result.calloutBlocks!.length).toBe(1);
      expect(result.calloutBlocks![0]!.type).toBe('note');
    });

    it('应该识别 warning callout', () => {
      const content = `> [!warning] 警告标题
> 这是警告内容`;

      const result = processor.process(content, '/tmp');

      expect(result.calloutBlocks!.length).toBe(1);
      expect(result.calloutBlocks![0]!.type).toBe('warning');
      expect(result.calloutBlocks![0]!.title).toBe('警告标题');
    });

    it('应该识别可折叠 callout', () => {
      const content = `> [!tip]- 可折叠提示
> 内容`;

      const result = processor.process(content, '/tmp');

      expect(result.calloutBlocks![0]!.foldable).toBe(true);
    });

    it('应该处理多种 callout 类型', () => {
      const content = `> [!info]
> 信息

> [!danger]
> 危险

> [!success]
> 成功`;

      const result = processor.process(content, '/tmp');

      expect(result.calloutBlocks!.length).toBe(3);
      expect(result.calloutBlocks![0]!.type).toBe('info');
      expect(result.calloutBlocks![1]!.type).toBe('danger');
      expect(result.calloutBlocks![2]!.type).toBe('success');
    });
  });
});
