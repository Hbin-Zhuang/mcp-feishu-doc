/**
 * @fileoverview Markdown 处理器提供者实现.
 * 从 feishushare 提取核心逻辑，移除 Obsidian 依赖，使用 Node.js 标准 API.
 * @module src/services/feishu/providers/markdown-processor.provider
 */

import { injectable } from 'tsyringe';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type {
  IMarkdownProcessor,
  ProcessConfig,
} from '../core/IFeishuProvider.js';
import type {
  LocalFileInfo,
  CalloutInfo,
  FrontMatterData,
  MarkdownProcessResult,
} from '../types.js';
import {
  CALLOUT_TYPE_MAPPING,
  CALLOUT_COLOR_MAP,
  SUPPORTED_IMAGE_EXTENSIONS,
} from '../constants.js';

/** 替换项类型 */
interface Replacement {
  start: number;
  end: number;
  replacement: string;
}

// ============================================================================
// 预编译正则表达式（性能优化 T604）
// ============================================================================

/** Wiki 链接正则 */
const WIKI_LINK_REGEX = /\[\[([^\]|]+)(\|([^\]]+))?\]\]/g;

/** 块引用正则 */
const BLOCK_REF_REGEX = /\[\[([^#\]]+)#\^([^\]]+)\]\]/g;

/** 标签正则 */
const TAG_REGEX = /#([a-zA-Z0-9_\u4e00-\u9fff]+)/g;

/** 嵌入正则 */
const EMBED_REGEX = /!\[\[([^\]]+)\]\]/g;

/** 图片正则 */
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 链接正则 */
const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

/** 高亮正则 */
const HIGHLIGHT_REGEX = /==([^=]+)==/g;

/** 代码块正则 */
const CODE_BLOCK_REGEX =
  /(^|\n)(```|~~~)\s*([^\n]*)\n([\s\S]*?)\n\2\s*(?=\n|$)/g;

/** Callout 正则 */
const CALLOUT_REGEX =
  /^>\s*\[!([^\]]+)\](-?)\s*([^\n]*)\n((?:(?:>[^\n]*|)\n?)*?)(?=\n(?!>)|$)/gm;

/** 多空行正则 */
const MULTI_NEWLINE_REGEX = /\n{3,}/g;

/** 行尾空白正则 */
const TRAILING_WHITESPACE_REGEX = /[ \t]+$/gm;

/** 文件尾空白正则 */
const EOF_WHITESPACE_REGEX = /\s+$/;

/** 删除线正则 */
const STRIKETHROUGH_REGEX = /~~([^~]+)~~/g;

/** 任务列表正则 */
const TASK_LIST_REGEX = /^(\s*)- \[([ xX])\] (.*)$/gm;

/**
 * MarkdownProcessorProvider class Markdown 处理器提供者.
 * 将 Markdown 内容转换为飞书文档格式，处理本地文件引用.
 */
@injectable()
export class MarkdownProcessorProvider implements IMarkdownProcessor {
  public readonly name = 'markdown-processor';
  private localFiles: LocalFileInfo[] = [];
  private calloutBlocks: CalloutInfo[] = [];

  // 转换结果缓存（性能优化 T604）
  private cache: Map<string, MarkdownProcessResult> = new Map();
  private readonly maxCacheSize = 100;

  public process(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): MarkdownProcessResult {
    // 生成缓存键（性能优化 T604）
    const cacheKey = this.generateCacheKey(content, baseDirectory, config);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    this.localFiles = [];
    this.calloutBlocks = [];

    const frontMatterHandling = config?.removeFrontMatter
      ? 'remove'
      : 'keep-as-code';
    const { content: contentWithoutFrontMatter, frontMatter } =
      this.processFrontMatter(content, frontMatterHandling);

    const processedContent = this.processContent(
      contentWithoutFrontMatter,
      baseDirectory,
      config,
    );

    const result: MarkdownProcessResult = {
      content: processedContent,
      localFiles: [...this.localFiles],
      calloutBlocks: [...this.calloutBlocks],
      frontMatter,
      extractedTitle: frontMatter?.title ?? null,
    };

    // 缓存结果（性能优化 T604）
    this.cacheResult(cacheKey, result);

    return result;
  }

  /**
   * generateCacheKey method 生成缓存键.
   */
  private generateCacheKey(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): string {
    const configStr = config ? JSON.stringify(config) : '';
    // 使用内容长度和前100字符作为快速哈希
    return `${content.length}:${content.substring(0, 100)}:${baseDirectory}:${configStr}`;
  }

  /**
   * cacheResult method 缓存处理结果.
   */
  private cacheResult(key: string, result: MarkdownProcessResult): void {
    // 限制缓存大小
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }

  /**
   * clearCache method 清除缓存.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  public healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  private processContent(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): string {
    let result = content;
    if (config?.codeBlockFilterLanguages?.length) {
      result = this.processCodeBlocks(result, config.codeBlockFilterLanguages);
    }
    result = this.processCallouts(result);
    result = this.processWikiLinks(result, baseDirectory, config);
    result = this.processBlockReferences(result);
    result = this.processEmbeds(result, baseDirectory, config);
    result = this.processImages(result, baseDirectory, config);
    result = this.processLinks(result);
    result = this.processTags(result);
    // 扩展语法支持 (T702, T703, T704)
    result = this.processHighlights(result);
    result = this.processStrikethrough(result);
    result = this.processTaskLists(result);
    result = this.cleanupWhitespace(result);
    return result;
  }

  /**
   * processStrikethrough method 处理删除线语法 (T703).
   * 将 ~~text~~ 转换为 <del>text</del>
   */
  private processStrikethrough(content: string): string {
    const replacements: Replacement[] = [];
    // 重置正则状态
    STRIKETHROUGH_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = STRIKETHROUGH_REGEX.exec(content)) !== null) {
      const text = String(match[1] ?? '');
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement: `<del>${text}</del>`,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  /**
   * processTaskLists method 处理任务列表语法 (T704).
   * 将 - [ ] 和 - [x] 转换为飞书 Todo 格式
   */
  private processTaskLists(content: string): string {
    const replacements: Replacement[] = [];
    // 重置正则状态
    TASK_LIST_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TASK_LIST_REGEX.exec(content)) !== null) {
      const indent = String(match[1] ?? '');
      const checked = String(match[2] ?? '').toLowerCase() === 'x';
      const text = String(match[3] ?? '');

      // 转换为飞书 Todo 格式
      const checkbox = checked ? '☑' : '☐';
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement: `${indent}${checkbox} ${text}`,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processWikiLinks(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): string {
    // 重置正则状态（使用预编译正则）
    WIKI_LINK_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
      const fullMatch = match[0];
      const link = String(match[1] ?? '');
      const display = String(match[3] ?? '');

      let replacement: string;
      if (this.isFileReference(link)) {
        const isImage = this.isImageFile(link);
        const shouldProcess = isImage
          ? config?.processImages !== false
          : config?.processAttachments !== false;

        if (shouldProcess) {
          const placeholder = this.generatePlaceholder();
          const resolvedPath = this.resolvePath(link, baseDirectory);
          this.localFiles.push({
            originalPath: resolvedPath,
            fileName: this.extractFileName(link),
            placeholder,
            isImage,
            altText: display || link,
          });
          replacement = placeholder;
        } else {
          replacement = fullMatch;
        }
      } else {
        replacement = `📝 ${display || link}`;
      }

      replacements.push({
        start: match.index,
        end: match.index + fullMatch.length,
        replacement,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processBlockReferences(content: string): string {
    // 重置正则状态
    BLOCK_REF_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = BLOCK_REF_REGEX.exec(content)) !== null) {
      const file = String(match[1] ?? '');
      const block = String(match[2] ?? '');
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement: `📝 ${file} (块引用: ${block})`,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processTags(content: string): string {
    // 重置正则状态
    TAG_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = TAG_REGEX.exec(content)) !== null) {
      const tag = String(match[1] ?? '');
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement: `#${tag}`,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processEmbeds(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): string {
    // 重置正则状态
    EMBED_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = EMBED_REGEX.exec(content)) !== null) {
      const fullMatch = match[0];
      const file = String(match[1] ?? '');
      const isImage = this.isImageFile(file);
      const shouldProcess = isImage
        ? config?.processImages !== false
        : config?.processAttachments !== false;

      let replacement: string;
      if (shouldProcess) {
        const placeholder = this.generatePlaceholder();
        const resolvedPath = this.resolvePath(file, baseDirectory);
        this.localFiles.push({
          originalPath: resolvedPath,
          fileName: this.extractFileName(file),
          placeholder,
          isImage,
          altText: file,
        });
        replacement = placeholder;
      } else {
        replacement = fullMatch;
      }

      replacements.push({
        start: match.index,
        end: match.index + fullMatch.length,
        replacement,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processImages(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): string {
    // 重置正则状态
    IMAGE_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = IMAGE_REGEX.exec(content)) !== null) {
      const fullMatch = match[0];
      const alt = String(match[1] ?? '');
      const src = String(match[2] ?? '');

      if (src.startsWith('http://') || src.startsWith('https://')) {
        continue;
      }

      let replacement: string;
      if (config?.processImages !== false) {
        const placeholder = this.generatePlaceholder();
        const resolvedPath = this.resolvePath(src, baseDirectory);
        this.localFiles.push({
          originalPath: resolvedPath,
          fileName: this.extractFileName(src),
          placeholder,
          isImage: true,
          altText: alt || '图片',
        });
        replacement = placeholder;
      } else {
        replacement = fullMatch;
      }

      replacements.push({
        start: match.index,
        end: match.index + fullMatch.length,
        replacement,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processLinks(content: string): string {
    // 重置正则状态
    LINK_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = LINK_REGEX.exec(content)) !== null) {
      const fullMatch = match[0];
      const text = String(match[1] ?? '');
      const url = String(match[2] ?? '');

      if (url.startsWith('obsidian://')) {
        replacements.push({
          start: match.index,
          end: match.index + fullMatch.length,
          replacement: `${text}(${url})`,
        });
      }
    }

    return this.applyReplacements(content, replacements);
  }

  private processHighlights(content: string): string {
    // 重置正则状态
    HIGHLIGHT_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = HIGHLIGHT_REGEX.exec(content)) !== null) {
      const text = String(match[1] ?? '');
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement: `<mark>${text}</mark>`,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private processCodeBlocks(
    content: string,
    filterLanguages: string[],
  ): string {
    const list = filterLanguages.map((s) => s.toLowerCase());
    if (list.length === 0) return content;

    // 重置正则状态
    CODE_BLOCK_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
      const leading = String(match[1] ?? '');
      const info = String(match[3] ?? '');
      const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

      if (lang && list.includes(lang)) {
        replacements.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: leading,
        });
      }
    }

    return this.applyReplacements(content, replacements);
  }

  private processCallouts(content: string): string {
    // 重置正则状态
    CALLOUT_REGEX.lastIndex = 0;
    const replacements: Replacement[] = [];
    let match: RegExpExecArray | null;

    while ((match = CALLOUT_REGEX.exec(content)) !== null) {
      const fullMatch = match[0];
      const calloutType = String(match[1] ?? '')
        .toLowerCase()
        .trim();
      const foldable = String(match[2] ?? '');
      const titleStr = String(match[3] ?? '');
      const bodyStr = String(match[4] ?? '');

      const defaultStyle = { emoji: '📌', color: 'blue', title: '提示' };
      const styleInfo =
        CALLOUT_TYPE_MAPPING[calloutType] ??
        CALLOUT_TYPE_MAPPING['default'] ??
        defaultStyle;

      let calloutTitle = titleStr.trim() || styleInfo.title;
      calloutTitle = this.escapeMarkdownInTitle(calloutTitle);

      const lines = bodyStr.split('\n');
      const processedLines = lines
        .map((line: string) =>
          line.startsWith('>') ? line.replace(/^>\s?/, '') : line,
        )
        .filter(
          (line: string, index: number, arr: string[]) =>
            !(line === '' && index === arr.length - 1),
        );

      const calloutContent = processedLines.join('\n');
      const placeholder = this.generatePlaceholder();

      const defaultColor = { background: 2, border: 2, text: 2 };
      const colorInfo =
        CALLOUT_COLOR_MAP[styleInfo.color] ??
        CALLOUT_COLOR_MAP['blue'] ??
        defaultColor;

      this.calloutBlocks.push({
        placeholder,
        type: calloutType,
        title: calloutTitle,
        content: calloutContent,
        foldable: foldable === '-',
        backgroundColor: colorInfo.background,
        borderColor: colorInfo.border,
        textColor: colorInfo.text,
        emojiId: this.mapEmojiToFeishu(styleInfo.emoji),
      });

      replacements.push({
        start: match.index,
        end: match.index + fullMatch.length,
        replacement: placeholder,
      });
    }

    return this.applyReplacements(content, replacements);
  }

  private applyReplacements(
    content: string,
    replacements: Replacement[],
  ): string {
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      if (r) {
        result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
      }
    }
    return result;
  }

  private cleanupWhitespace(content: string): string {
    let result = content;
    result = result.replace(MULTI_NEWLINE_REGEX, '\n\n');
    result = result.replace(TRAILING_WHITESPACE_REGEX, '');
    result = result.replace(EOF_WHITESPACE_REGEX, '\n');
    return result;
  }

  private processFrontMatter(
    content: string,
    handling: 'remove' | 'keep-as-code',
  ): { content: string; frontMatter: FrontMatterData | null } {
    const { frontMatter, content: contentWithoutFrontMatter } =
      this.parseFrontMatter(content);

    if (!frontMatter) return { content, frontMatter: null };
    if (handling === 'remove')
      return { content: contentWithoutFrontMatter, frontMatter };

    const yamlLines = content.split('\n');
    let endIndex = -1;
    for (let i = 1; i < yamlLines.length; i++) {
      const line = yamlLines[i];
      if (line !== undefined && line.trim() === '---') {
        endIndex = i;
        break;
      }
    }

    if (endIndex !== -1) {
      const yamlContent = yamlLines.slice(1, endIndex).join('\n');
      const codeBlock = '```yaml\n' + yamlContent + '\n```\n\n';
      return { content: codeBlock + contentWithoutFrontMatter, frontMatter };
    }

    return { content: contentWithoutFrontMatter, frontMatter };
  }

  private parseFrontMatter(content: string): {
    frontMatter: FrontMatterData | null;
    content: string;
  } {
    if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
      return { frontMatter: null, content };
    }

    const lines = content.split('\n');
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.trim() === '---') {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) return { frontMatter: null, content };

    const yamlContent = lines.slice(1, endIndex).join('\n');
    const remainingContent = lines.slice(endIndex + 1).join('\n');

    try {
      const frontMatter = this.parseSimpleYaml(yamlContent);
      return { frontMatter, content: remainingContent };
    } catch {
      return { frontMatter: null, content };
    }
  }

  private parseSimpleYaml(yamlContent: string): FrontMatterData {
    const result: FrontMatterData = {};
    const lines = yamlContent.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex === -1) continue;

      const key = trimmedLine.substring(0, colonIndex).trim();
      let value = trimmedLine.substring(colonIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  }

  private escapeMarkdownInTitle(title: string): string {
    return title.replace(/\*\*/g, '*');
  }

  private mapEmojiToFeishu(emoji: string): string {
    const emojiMap: Record<string, string> = {
      '📝': 'memo',
      ℹ️: 'information_source',
      '💡': 'bulb',
      '⚠️': 'warning',
      '❌': 'x',
      '⛔': 'no_entry',
      '❓': 'question',
      '✅': 'white_check_mark',
      '💬': 'speech_balloon',
      '📖': 'book',
      '📄': 'page_facing_up',
      '📋': 'clipboard',
      '☑️': 'ballot_box_with_check',
      '📌': 'pushpin',
    };
    return emojiMap[emoji] ?? 'pushpin';
  }

  private generatePlaceholder(): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    return `__MCP_CONTENT_${timestamp}_${randomId}__`;
  }

  private extractFileName(filePath: string): string {
    return path.basename(filePath);
  }

  private isFileReference(pathStr: string): boolean {
    const fileName = this.extractFileName(pathStr);
    return fileName.includes('.') && fileName.lastIndexOf('.') > 0;
  }

  private isImageFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  }

  private resolvePath(filePath: string, baseDirectory: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    const cleanPath = filePath.replace(/^\.\//, '').replace(/^\//, '');
    return path.resolve(baseDirectory, cleanPath);
  }

  public getLocalFiles(): LocalFileInfo[] {
    return [...this.localFiles];
  }

  public getCalloutBlocks(): CalloutInfo[] {
    return [...this.calloutBlocks];
  }

  public fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  public readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  public readFileBuffer(filePath: string): Buffer {
    return fs.readFileSync(filePath);
  }
}
