/**
 * @fileoverview 飞书 API 提供者实现.
 * @module src/services/feishu/providers/feishu-api.provider
 */

import { injectable } from 'tsyringe';
import type { IFeishuApiProvider } from '../core/IFeishuProvider.js';
import type {
  FeishuAuth,
  FeishuDocument,
  FeishuFolder,
  FeishuUserInfo,
  FeishuWikiSpace,
  FeishuWikiNode,
  FeishuOAuthResponse,
  FeishuApiResponse,
} from '../types.js';
import {
  FEISHU_CONFIG,
  TOKEN_EXPIRED_CODES,
  FEISHU_ERROR_MESSAGES,
  DOC_IMAGE_EMBED_LIMITS,
} from '../constants.js';
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';
import { logger, requestContextService } from '@/utils/index.js';

/** HTTP 请求选项 */
interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | Buffer | FormData | ArrayBuffer;
  timeout?: number;
}

/**
 * FeishuApiProvider class 飞书 API 提供者.
 * 封装所有飞书开放平台 API 调用.
 */
@injectable()
export class FeishuApiProvider implements IFeishuApiProvider {
  public readonly name = 'feishu-api';
  private refreshPromise: Promise<FeishuAuth | null> | null = null;

  // 性能优化 T605: 重试配置
  private readonly maxRetries = FEISHU_CONFIG.MAX_RETRIES;
  private readonly retryDelayMs = FEISHU_CONFIG.RETRY_DELAY_MS;

  /**
   * generateAuthUrl method 生成 OAuth 授权 URL.
   */
  public generateAuthUrl(
    appId: string,
    redirectUri: string,
  ): { authUrl: string; state: string } {
    const state = this.generateRandomState();

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: FEISHU_CONFIG.SCOPES,
      state,
      response_type: 'code',
    });

    const authUrl = `${FEISHU_CONFIG.AUTHORIZE_URL}?${params.toString()}`;
    return { authUrl, state };
  }

  /**
   * exchangeCodeForToken method 使用授权码换取访问令牌.
   */
  public async exchangeCodeForToken(
    code: string,
    appId: string,
    appSecret: string,
    redirectUri: string,
  ): Promise<FeishuAuth> {
    const requestBody = {
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri,
    };

    const response = await this.request<FeishuOAuthResponse>(
      FEISHU_CONFIG.TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    );

    if (response.code !== 0) {
      const errorMsg =
        response.error_description ?? response.msg ?? '获取访问令牌失败';
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `OAuth 错误: ${errorMsg}`,
      );
    }

    const accessToken = response.access_token ?? response.data?.access_token;
    const refreshToken = response.refresh_token ?? response.data?.refresh_token;
    const expiresIn = response.expires_in ?? response.data?.expires_in ?? 7200;

    if (!accessToken) {
      throw new McpError(JsonRpcErrorCode.InternalError, '未获取到访问令牌');
    }

    return {
      appId,
      accessToken,
      refreshToken: refreshToken ?? '',
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  /**
   * refreshToken method 刷新访问令牌.
   */
  public async refreshToken(
    refreshTokenValue: string,
    appId: string,
    appSecret: string,
  ): Promise<FeishuAuth> {
    // 防止并发刷新
    if (this.refreshPromise) {
      const result = await this.refreshPromise;
      if (result) return result;
      throw new McpError(JsonRpcErrorCode.InternalError, 'Token 刷新失败');
    }

    this.refreshPromise = this.doRefreshToken(
      refreshTokenValue,
      appId,
      appSecret,
    );

    try {
      const result = await this.refreshPromise;
      if (!result) {
        throw new McpError(JsonRpcErrorCode.InternalError, 'Token 刷新失败');
      }
      return result;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(
    refreshTokenValue: string,
    appId: string,
    appSecret: string,
  ): Promise<FeishuAuth | null> {
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.refreshToken',
    });

    try {
      const requestBody = {
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: appSecret,
        refresh_token: refreshTokenValue,
      };

      const response = await this.request<FeishuOAuthResponse>(
        FEISHU_CONFIG.REFRESH_TOKEN_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
      );

      if (response.code !== 0) {
        logger.warning('Token 刷新失败', {
          ...ctx,
          code: response.code,
          msg: response.msg,
        });
        return null;
      }

      const accessToken = response.access_token ?? response.data?.access_token;
      const newRefreshToken =
        response.refresh_token ?? response.data?.refresh_token;
      const expiresIn =
        response.expires_in ?? response.data?.expires_in ?? 7200;

      if (!accessToken) {
        return null;
      }

      return {
        appId,
        accessToken,
        refreshToken: newRefreshToken ?? '',
        expiresAt: Date.now() + expiresIn * 1000,
      };
    } catch (error) {
      logger.error(
        'Token 刷新异常',
        error instanceof Error ? error : new Error(String(error)),
        ctx,
      );
      return null;
    }
  }

  /**
   * getUserInfo method 获取用户信息.
   */
  public async getUserInfo(accessToken: string): Promise<FeishuUserInfo> {
    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        name: string;
        avatar_url: string;
        email: string;
        user_id?: string;
        open_id?: string;
      }>
    >(FEISHU_CONFIG.USER_INFO_URL, accessToken, { method: 'GET' });

    if (response.code !== 0 || !response.data) {
      throw new McpError(JsonRpcErrorCode.InternalError, '获取用户信息失败');
    }

    const { data } = response;
    // user_id 可能为空（个人/轻量版），使用 open_id 兜底
    const userId = data.user_id || data.open_id || '';

    return {
      userId,
      name: data.name,
      email: data.email,
      avatarUrl: data.avatar_url,
    };
  }

  /**
   * createDocument method 创建飞书文档.
   * 使用飞书的导入API，先上传Markdown文件，然后导入为富文本文档
   * 如果目标是知识库，会先创建云文档，然后移动到知识库
   */
  public async createDocument(
    accessToken: string,
    title: string,
    content: string,
    targetType: 'drive' | 'wiki',
    targetId?: string,
    parentNodeToken?: string,
  ): Promise<FeishuDocument> {
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.createDocument',
      tenantId: 'feishu-service',
    });

    logger.info('开始创建飞书文档', { 
      ...ctx, 
      title, 
      targetType, 
      targetId,
      parentNodeToken 
    });

    // 第一步：上传Markdown文件到飞书
    logger.debug('第一步：上传Markdown文件', ctx);
    const uploadResult = await this.uploadMarkdownFile(
      accessToken,
      title,
      content,
    );

    if (!uploadResult.success || !uploadResult.fileToken) {
      logger.error(
        '文件上传失败',
        new Error(uploadResult.error || '未知错误'),
        ctx,
      );
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        uploadResult.error || '文件上传失败',
      );
    }

    logger.info('文件上传成功', { ...ctx, fileToken: uploadResult.fileToken });

    // 第二步：创建导入任务（总是先导入到云空间）
    logger.debug('第二步：创建导入任务到云空间', ctx);
    const importResult = await this.createImportTask(
      accessToken,
      uploadResult.fileToken,
      title,
      targetType === 'drive' ? targetId : undefined, // 只有云空间类型才传递文件夹ID
    );

    if (!importResult.success || !importResult.ticket) {
      logger.error(
        '创建导入任务失败',
        new Error(importResult.error || '未知错误'),
        ctx,
      );
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        importResult.error || '创建导入任务失败',
      );
    }

    logger.info('导入任务创建成功', { ...ctx, ticket: importResult.ticket });

    // 第三步：等待导入完成
    logger.debug('第三步：等待导入完成', ctx);
    const finalResult = await this.waitForImportCompletion(
      accessToken,
      importResult.ticket,
    );

    if (!finalResult.success || !finalResult.documentToken) {
      logger.error(
        '文档导入失败',
        new Error(finalResult.error || '未知错误'),
        ctx,
      );
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        finalResult.error || '文档导入失败',
      );
    }

    logger.info('文档创建成功', {
      ...ctx,
      documentToken: finalResult.documentToken,
    });

    // 第四步：如果目标是知识库，移动文档到知识库
    if (targetType === 'wiki' && targetId) {
      logger.info('第四步：移动文档到知识库', {
        ...ctx,
        wikiSpaceId: targetId,
        documentToken: finalResult.documentToken,
        parentNodeToken,
      });

      const moveResult = await this.moveDocToWiki(
        accessToken,
        targetId,
        finalResult.documentToken,
        'docx',
        parentNodeToken,
      );

      if (!moveResult.success) {
        logger.warning('移动到知识库失败，返回云文档链接', {
          ...ctx,
          error: moveResult.error,
        });
        // 移动失败，但文档已创建，返回云文档链接
        return {
          documentId: finalResult.documentToken,
          url: `https://feishu.cn/docx/${finalResult.documentToken}`,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      logger.info('文档已成功移动到知识库', {
        ...ctx,
        wikiToken: moveResult.wikiToken,
      });

      // 返回云文档URL（即使在知识库中，也使用云文档URL便于后续操作）
      return {
        documentId: finalResult.documentToken,
        url: `https://feishu.cn/docx/${finalResult.documentToken}`,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // 云空间文档，直接返回
    return {
      documentId: finalResult.documentToken,
      url: `https://feishu.cn/docx/${finalResult.documentToken}`,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * updateDocument method 更新飞书文档.
   * 策略：删除旧文档后在相同位置重新创建（飞书不提供直接替换内容的 API）.
   * 调用方需传入 targetType/targetId/parentNodeToken 以便重建到正确位置.
   */
  public async updateDocument(
    accessToken: string,
    documentId: string,
    content: string,
    title: string,
    targetType: 'drive' | 'wiki' = 'drive',
    targetId?: string,
    parentNodeToken?: string,
  ): Promise<FeishuDocument> {
    // 第一步：删除旧文档
    await this.deleteDocument(accessToken, documentId, 'docx');

    // 第二步：在原位置重新创建文档
    return this.createDocument(
      accessToken,
      title,
      content,
      targetType,
      targetId,
      parentNodeToken,
    );
  }

  /**
   * getDocumentMeta method 获取文档元数据.
   * 使用飞书 docx API 返回的 revision_id 作为版本标识，用于冲突检测.
   */
  public async getDocumentMeta(
    accessToken: string,
    documentId: string,
  ): Promise<{ documentId: string; updatedAt: number; revisionId: number }> {
    const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}`;
    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        document: { document_id: string; revision_id: number; title: string };
      }>
    >(url, accessToken, { method: 'GET' });

    if (response.code !== 0 || !response.data) {
      throw new McpError(JsonRpcErrorCode.InternalError, '获取文档元数据失败');
    }

    return {
      documentId,
      updatedAt: Date.now(),
      revisionId: response.data.document.revision_id,
    };
  }

  /**
   * deleteDocument method 删除云空间文档.
   * @param accessToken 访问令牌
   * @param fileToken 文档 token（即 documentId）
   * @param fileType 文件类型，docx 或 file
   */
  public async deleteDocument(
    accessToken: string,
    fileToken: string,
    fileType: 'docx' | 'file' = 'docx',
  ): Promise<void> {
    const url = `${FEISHU_CONFIG.BASE_URL}/drive/v1/files/${fileToken}`;
    const response = await this.requestWithAuth<FeishuApiResponse>(
      `${url}?type=${fileType}`,
      accessToken,
      { method: 'DELETE' },
    );

    if (response.code !== 0) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `删除文档失败: ${response.msg || '未知错误'}`,
      );
    }
  }

  /**
   * getDocumentContent method 获取文档纯文本内容（通过 blocks API）.
   * 遍历文档 block 树，提取所有文本内容，返回近似 Markdown.
   */
  public async getDocumentContent(
    accessToken: string,
    documentId: string,
  ): Promise<{ title: string; content: string; revisionId: number }> {
    // 获取文档基础信息
    const meta = await this.getDocumentMeta(accessToken, documentId);

    // 获取文档所有 block（按页读取）
    const allBlocks: Array<{
      block_id: string;
      block_type: number;
      parent_id: string;
      children?: string[];
      [key: string]: unknown;
    }> = [];

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ page_size: '200', document_revision_id: '-1' });
      if (pageToken) params.set('page_token', pageToken);
      const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}/blocks?${params.toString()}`;
      const resp = await this.requestWithAuth<
        FeishuApiResponse<{
          items: Array<{
            block_id: string;
            block_type: number;
            parent_id: string;
            children?: string[];
            [key: string]: unknown;
          }>;
          has_more: boolean;
          page_token?: string;
        }>
      >(url, accessToken, { method: 'GET' });

      if (resp.code !== 0 || !resp.data) {
        throw new McpError(
          JsonRpcErrorCode.InternalError,
          `获取文档内容失败: ${resp.msg || '未知错误'}`,
        );
      }

      allBlocks.push(...resp.data.items);
      pageToken = resp.data.has_more ? resp.data.page_token : undefined;
    } while (pageToken);

    // 将 block 树转换为 Markdown 文本（含图片 base64）
    const lines = await this.buildDocumentLines(
      accessToken,
      allBlocks,
    );

    // 获取标题（首个 Page block 的标题）
    const pageBlock = allBlocks.find((b) => b.block_type === 1);
    const titleEl = pageBlock as { page?: { elements?: Array<{ text_run?: { content?: string } }> } } | undefined;
    const title = titleEl?.page?.elements?.map((e) => e.text_run?.content || '').join('') || '';

    return {
      title: title || documentId,
      content: lines.filter(Boolean).join('\n\n'),
      revisionId: meta.revisionId,
    };
  }

  /**
   * searchDocuments method 搜索云空间文档.
   * 使用飞书 Drive 搜索 API.
   */
  public async searchDocuments(
    accessToken: string,
    query: string,
    count = 20,
  ): Promise<
    Array<{
      token: string;
      name: string;
      url: string;
      type: string;
      ownerName: string;
    }>
  > {
    const url = `${FEISHU_CONFIG.BASE_URL}/suite/docs-api/search/object`;
    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        docs_entities?: Array<{
          doc_token: string;
          doc_type: string;
          title: string;
          url: string;
          owner_id?: string;
        }>;
        has_more?: boolean;
      }>
    >(url, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_key: query,
        count,
        docs_types: ['docx', 'doc'],
      }),
    });

    if (response.code !== 0 || !response.data) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `搜索文档失败: ${response.msg || '未知错误'}`,
      );
    }

    return (response.data.docs_entities ?? []).map((doc) => ({
      token: doc.doc_token,
      name: doc.title,
      url: doc.url,
      type: doc.doc_type,
      ownerName: doc.owner_id ?? '',
    }));
  }

  /**
   * buildDocumentLines method 构建文档行（含图片 base64 data URI）.
   * 限制：最多内联 N 张、单张 ≤ 2.5MB、总字节 ≤ 5MB，超出用占位符.
   */
  private async buildDocumentLines(
    accessToken: string,
    blocks: Array<Record<string, unknown>>,
  ): Promise<string[]> {
    type BlockContent =
      | { type: 'text'; value: string }
      | { type: 'image'; fileToken: string };

    const getBlockContent = (block: Record<string, unknown>): BlockContent | null => {
      const content = this.extractBlockContent(block);
      if (!content) return null;
      return content;
    };

    const items: BlockContent[] = [];
    for (const block of blocks) {
      const c = getBlockContent(block);
      if (c) items.push(c);
    }

    const imageItems = items.filter(
      (i): i is { type: 'image'; fileToken: string } => i.type === 'image',
    );
    const tokensToFetch = imageItems
      .slice(0, DOC_IMAGE_EMBED_LIMITS.maxImages)
      .map((i) => i.fileToken);

    const tokenToBase64 = new Map<string, string>();
    if (tokensToFetch.length > 0) {
      const urlMap = await this.batchGetTmpDownloadUrls(accessToken, tokensToFetch);
      let totalBytes = 0;
      const maxSingle = DOC_IMAGE_EMBED_LIMITS.maxSingleImageBytes;
      const maxTotal = DOC_IMAGE_EMBED_LIMITS.maxTotalBytes;

      for (const token of tokensToFetch) {
        if (totalBytes >= maxTotal) break;
        const url = urlMap.get(token);
        if (!url) continue;
        const result = await this.fetchImageAsBase64(url, accessToken);
        if (!result) continue;
        if (result.byteLength > maxSingle) continue;
        if (totalBytes + result.byteLength > maxTotal) continue;
        tokenToBase64.set(token, result.dataUri);
        totalBytes += result.byteLength;
      }
    }

    const lines: string[] = [];
    for (const item of items) {
      if (item.type === 'text') {
        lines.push(item.value);
      } else {
        const dataUri = tokenToBase64.get(item.fileToken);
        lines.push(
          dataUri ? `![image](${dataUri})` : `![image](feishu-image)`,
        );
      }
    }
    return lines;
  }

  /**
   * batchGetTmpDownloadUrls method 批量获取素材临时下载链接.
   */
  private async batchGetTmpDownloadUrls(
    accessToken: string,
    fileTokens: string[],
  ): Promise<Map<string, string>> {
    if (fileTokens.length === 0) return new Map();

    const params = new URLSearchParams();
    fileTokens.forEach((t) => params.append('file_tokens', t));
    const url = `${FEISHU_CONFIG.BASE_URL}/drive/v1/medias/batch_get_tmp_download_url?${params.toString()}`;

    const resp = await this.requestWithAuth<
      FeishuApiResponse<{
        tmp_download_urls?: Array<{
          file_token: string;
          tmp_download_url: string;
        }>;
      }>
    >(url, accessToken, { method: 'GET' });

    if (resp.code !== 0 || !resp.data?.tmp_download_urls) {
      return new Map();
    }

    const map = new Map<string, string>();
    for (const u of resp.data.tmp_download_urls) {
      if (u.file_token && u.tmp_download_url) {
        map.set(u.file_token, u.tmp_download_url);
      }
    }
    return map;
  }

  /**
   * fetchImageAsBase64 method 从临时 URL 拉取图片并转为 base64 data URI.
   * 单张超过 maxSingleImageBytes 时返回 null（使用占位符）.
   */
  private async fetchImageAsBase64(
    tmpUrl: string,
    accessToken: string,
  ): Promise<{ dataUri: string; byteLength: number } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(tmpUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) return null;
      const blob = await response.arrayBuffer();
      const bytes = new Uint8Array(blob);
      const byteLength = bytes.length;
      if (byteLength > DOC_IMAGE_EMBED_LIMITS.maxSingleImageBytes) {
        return null;
      }
      const b64 = Buffer.from(bytes).toString('base64');
      const contentType =
        response.headers.get('content-type') || 'image/png';
      return {
        dataUri: `data:${contentType};base64,${b64}`,
        byteLength,
      };
    } catch {
      return null;
    }
  }

  /**
   * extractBlockContent method 从 block 提取内容（文本或图片 file_token）.
   */
  private extractBlockContent(
    block: Record<string, unknown>,
  ): { type: 'text'; value: string } | { type: 'image'; fileToken: string } | null {
    const blockType = block.block_type as number;
    const getTextFromElements = (elements?: Array<{ text_run?: { content?: string } }>) =>
      (elements ?? []).map((e) => e.text_run?.content || '').join('');

    switch (blockType) {
      case 2: {
        const b = block as { text?: { elements?: Array<{ text_run?: { content?: string } }> } };
        const v = getTextFromElements(b.text?.elements);
        return v ? { type: 'text', value: v } : null;
      }
      case 3: {
        const b = block as { heading1?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `# ${getTextFromElements(b.heading1?.elements)}` };
      }
      case 4: {
        const b = block as { heading2?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `## ${getTextFromElements(b.heading2?.elements)}` };
      }
      case 5: {
        const b = block as { heading3?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `### ${getTextFromElements(b.heading3?.elements)}` };
      }
      case 10: {
        const b = block as { bullet?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `- ${getTextFromElements(b.bullet?.elements)}` };
      }
      case 11: {
        const b = block as { ordered?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `1. ${getTextFromElements(b.ordered?.elements)}` };
      }
      case 12: {
        const b = block as { code?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `\`\`\`\n${getTextFromElements(b.code?.elements)}\n\`\`\`` };
      }
      case 15: {
        const b = block as { quote?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `> ${getTextFromElements(b.quote?.elements)}` };
      }
      case 22: {
        const b = block as { image?: { file_token?: string } };
        const ft = b.image?.file_token;
        return ft ? { type: 'image', fileToken: ft } : null;
      }
      default:
        return null;
    }
  }

  /**
   * uploadFile method 上传文件到飞书.
   */
  public async uploadFile(
    accessToken: string,
    filePath: string,
    fileType: 'image' | 'file',
  ): Promise<string> {
    // 读取文件
    const fs = await import('node:fs');
    const path = await import('node:path');

    if (!fs.existsSync(filePath)) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `文件不存在: ${filePath}`,
      );
    }

    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    return this.uploadFileBuffer(accessToken, buffer, fileName, fileType);
  }

  /**
   * uploadFileBuffer method 上传文件 Buffer 到飞书.
   */
  public async uploadFileBuffer(
    accessToken: string,
    buffer: Buffer,
    fileName: string,
    fileType: 'image' | 'file',
  ): Promise<string> {
    const boundary = `---${Date.now()}${Math.random().toString(36).substring(2)}`;
    const parentType = fileType === 'image' ? 'docx_image' : 'docx_file';

    // 构建 multipart/form-data
    const parts: Buffer[] = [];

    // file_name 字段
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(
      Buffer.from('Content-Disposition: form-data; name="file_name"\r\n\r\n'),
    );
    parts.push(Buffer.from(`${fileName}\r\n`));

    // parent_type 字段
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(
      Buffer.from('Content-Disposition: form-data; name="parent_type"\r\n\r\n'),
    );
    parts.push(Buffer.from(`${parentType}\r\n`));

    // size 字段
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(
      Buffer.from('Content-Disposition: form-data; name="size"\r\n\r\n'),
    );
    parts.push(Buffer.from(`${buffer.length}\r\n`));

    // file 字段
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(
      Buffer.from(
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
      ),
    );
    parts.push(
      Buffer.from(`Content-Type: ${this.getMimeType(fileName)}\r\n\r\n`),
    );
    parts.push(buffer);
    parts.push(Buffer.from('\r\n'));

    // 结束边界
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await this.requestWithAuth<
      FeishuApiResponse<{ file_token: string }>
    >(FEISHU_CONFIG.UPLOAD_URL, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (response.code !== 0 || !response.data) {
      const errorMsg =
        FEISHU_ERROR_MESSAGES[response.code] ?? response.msg ?? '文件上传失败';
      throw new McpError(JsonRpcErrorCode.InternalError, errorMsg);
    }

    return response.data.file_token;
  }

  /**
   * listFolders method 列出云空间文件夹.
   */
  public async listFolders(
    accessToken: string,
    parentId?: string,
  ): Promise<FeishuFolder[]> {
    const url = `${FEISHU_CONFIG.BASE_URL}/drive/v1/files`;
    const params = new URLSearchParams({ page_size: '50' });
    if (parentId) {
      params.set('folder_token', parentId);
    }

    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.listFolders',
    });

    logger.debug('调用飞书文件夹列表API', {
      ...ctx,
      url: `${url}?${params.toString()}`,
      parentId,
    });

    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        files: Array<{
          token: string;
          name: string;
          type: string;
          parent_token: string;
          created_time: string;
          modified_time: string;
        }>;
        has_more: boolean;
      }>
    >(`${url}?${params.toString()}`, accessToken, { method: 'GET' });

    logger.debug('飞书文件夹列表API响应', {
      ...ctx,
      code: response.code,
      msg: response.msg,
      fileCount: response.data?.files?.length || 0,
      folderCount:
        response.data?.files?.filter((f) => f.type === 'folder').length || 0,
      hasMore: response.data?.has_more,
    });

    if (response.code !== 0 || !response.data) {
      logger.error(
        '获取文件夹列表失败',
        new Error(`API错误: ${response.code} - ${response.msg}`),
        ctx,
      );
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `获取文件夹列表失败: ${response.msg || '未知错误'}`,
      );
    }

    return response.data.files
      .filter((file) => file.type === 'folder')
      .map((file) => ({
        token: file.token,
        name: file.name,
        parentToken: file.parent_token,
        createdAt: file.created_time,
        modifiedAt: file.modified_time,
      }));
  }

  /**
   * listWikis method 列出知识库空间.
   */
  public async listWikis(accessToken: string): Promise<FeishuWikiSpace[]> {
    const url = `${FEISHU_CONFIG.BASE_URL}/wiki/v2/spaces`;
    const params = new URLSearchParams({ page_size: '50' });

    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.listWikis',
    });

    logger.debug('调用飞书知识库列表API', {
      ...ctx,
      url: `${url}?${params.toString()}`,
    });

    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        items: Array<{
          space_id: string;
          name: string;
          description?: string;
          space_type?: string;
          visibility?: string;
        }>;
        has_more: boolean;
      }>
    >(`${url}?${params.toString()}`, accessToken, { method: 'GET' });

    logger.debug('飞书知识库列表API响应', {
      ...ctx,
      code: response.code,
      msg: response.msg,
      itemCount: response.data?.items?.length || 0,
      hasMore: response.data?.has_more,
    });

    if (response.code !== 0 || !response.data) {
      logger.error(
        '获取知识库列表失败',
        new Error(`API错误: ${response.code} - ${response.msg}`),
        ctx,
      );
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `获取知识库列表失败: ${response.msg || '未知错误'}`,
      );
    }

    return response.data.items.map((item) => {
      const result: FeishuWikiSpace = {
        spaceId: item.space_id,
        name: item.name,
      };
      if (item.description !== undefined) {
        result.description = item.description;
      }
      if (item.space_type !== undefined) {
        result.spaceType = item.space_type;
      }
      if (item.visibility !== undefined) {
        result.visibility = item.visibility;
      }
      return result;
    });
  }

  /**
   * getWikiNodes method 获取知识库节点.
   */
  public async getWikiNodes(
    accessToken: string,
    wikiId: string,
    parentNodeToken?: string,
  ): Promise<FeishuWikiNode[]> {
    const url = `${FEISHU_CONFIG.BASE_URL}/wiki/v2/spaces/${wikiId}/nodes`;
    const params = new URLSearchParams({ page_size: '50' });
    if (parentNodeToken) {
      params.set('parent_node_token', parentNodeToken);
    }

    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        items: Array<{
          space_id: string;
          node_token: string;
          obj_token: string;
          obj_type: string;
          parent_node_token?: string;
          title: string;
          has_child: boolean;
        }>;
        has_more: boolean;
      }>
    >(`${url}?${params.toString()}`, accessToken, { method: 'GET' });

    if (response.code !== 0 || !response.data) {
      throw new McpError(JsonRpcErrorCode.InternalError, '获取知识库节点失败');
    }

    return response.data.items.map((item) => {
      const result: FeishuWikiNode = {
        spaceId: item.space_id,
        nodeToken: item.node_token,
        objToken: item.obj_token,
        objType: item.obj_type,
        title: item.title,
        hasChild: item.has_child,
      };
      if (item.parent_node_token !== undefined) {
        result.parentNodeToken = item.parent_node_token;
      }
      return result;
    });
  }

  /**
   * healthCheck method 健康检查.
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 简单检查 API 是否可达
      const response = await fetch(
        `${FEISHU_CONFIG.BASE_URL}/auth/v3/app_access_token/internal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: 'test', app_secret: 'test' }),
        },
      );
      return response.status === 200 || response.status === 400; // 400 表示参数错误但 API 可达
    } catch {
      return false;
    }
  }

  /**
   * isTokenExpiredError method 判断是否为 token 过期错误.
   */
  public isTokenExpiredError(code: number): boolean {
    return TOKEN_EXPIRED_CODES.includes(code);
  }

  /**
   * moveDocToWiki method 将云文档移动到知识库.
   */
  public async moveDocToWiki(
    accessToken: string,
    spaceId: string,
    objToken: string,
    objType: string,
    parentNodeToken?: string,
  ): Promise<{ success: boolean; wikiToken?: string; error?: string }> {
    const url = `${FEISHU_CONFIG.BASE_URL}/wiki/v2/spaces/${spaceId}/nodes/move_docs_to_wiki`;

    const requestData: Record<string, string> = {
      obj_type: objType,
      obj_token: objToken,
    };

    if (parentNodeToken) {
      requestData.parent_wiki_token = parentNodeToken;
    }

    try {
      const response = await this.requestWithAuth<
        FeishuApiResponse<{
          wiki_token?: string;
          task_id?: string;
        }>
      >(url, accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (response.code === 0) {
        const result: { success: boolean; wikiToken?: string } = {
          success: true,
        };
        if (response.data?.wiki_token !== undefined) {
          result.wikiToken = response.data.wiki_token;
        }
        return result;
      }

      return {
        success: false,
        error: response.msg ?? '移动文档到知识库失败',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '移动文档到知识库失败',
      };
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * request method 发送 HTTP 请求（带重试机制 T605, T608）.
   */
  private async request<T>(
    url: string,
    options: RequestOptions,
    retryCount = 0,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = options.timeout ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method: options.method,
        signal: controller.signal,
      };

      // 只有当 headers 存在时才添加
      if (options.headers) {
        fetchOptions.headers = options.headers;
      }

      // 只有当 body 存在时才添加
      if (options.body !== undefined) {
        fetchOptions.body = options.body as BodyInit;
      }

      const response = await fetch(url, fetchOptions);

      const text = await response.text();

      try {
        const result = JSON.parse(text) as T;

        // 检查是否需要重试（频率限制等）
        const apiResponse = result as unknown as { code?: number };
        if (apiResponse.code === 99991429 && retryCount < this.maxRetries) {
          // 频率限制，使用指数退避重试
          const delay = this.retryDelayMs * Math.pow(2, retryCount);
          await this.sleep(delay);
          return this.request<T>(url, options, retryCount + 1);
        }

        return result;
      } catch {
        throw new McpError(
          JsonRpcErrorCode.InternalError,
          `无效的 JSON 响应: ${text.substring(0, 200)}`,
        );
      }
    } catch (error) {
      if (error instanceof McpError) throw error;

      // 网络错误重试（T608）
      if (retryCount < this.maxRetries) {
        const isNetworkError =
          error instanceof Error &&
          (error.name === 'AbortError' ||
            error.message.includes('network') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT'));

        if (isNetworkError || error instanceof TypeError) {
          const delay = this.retryDelayMs * Math.pow(2, retryCount);
          const ctx = requestContextService.createRequestContext({
            operation: 'feishu.request.retry',
          });
          logger.warning(
            `请求失败，${delay}ms 后重试 (${retryCount + 1}/${this.maxRetries})`,
            ctx,
          );
          await this.sleep(delay);
          return this.request<T>(url, options, retryCount + 1);
        }
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new McpError(JsonRpcErrorCode.InternalError, '请求超时');
      }
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `请求失败: ${String(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * sleep method 延迟执行.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * requestWithAuth method 发送带认证的 HTTP 请求.
   */
  private async requestWithAuth<T>(
    url: string,
    accessToken: string,
    options: RequestOptions,
  ): Promise<T> {
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    };

    return this.request<T>(url, { ...options, headers });
  }

  /**
   * uploadMarkdownFile method 上传Markdown文件到飞书.
   * 基于feishushare的实现
   */
  private async uploadMarkdownFile(
    accessToken: string,
    fileName: string,
    content: string,
  ): Promise<{ success: boolean; fileToken?: string; error?: string }> {
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.uploadMarkdownFile',
      tenantId: 'feishu-service',
    });

    try {
      logger.debug('开始上传Markdown文件', {
        ...ctx,
        fileName,
        contentLength: content.length,
      });

      const boundary = '---7MA4YWxkTrZu0gW';
      const finalFileName = fileName.endsWith('.md')
        ? fileName
        : `${fileName}.md`;

      // 将内容转换为UTF-8字节
      const utf8Content = new TextEncoder().encode(content);
      const contentLength = utf8Content.length;

      logger.debug('文件信息', { ...ctx, finalFileName, contentLength });

      // 构建multipart/form-data
      const parts: string[] = [];

      // file_name
      parts.push(`--${boundary}`);
      parts.push(`Content-Disposition: form-data; name="file_name"`);
      parts.push('');
      parts.push(finalFileName);

      // parent_type
      parts.push(`--${boundary}`);
      parts.push(`Content-Disposition: form-data; name="parent_type"`);
      parts.push('');
      parts.push('ccm_import_open');

      // size
      parts.push(`--${boundary}`);
      parts.push(`Content-Disposition: form-data; name="size"`);
      parts.push('');
      parts.push(contentLength.toString());

      // extra
      parts.push(`--${boundary}`);
      parts.push(`Content-Disposition: form-data; name="extra"`);
      parts.push('');
      parts.push('{"obj_type":"docx","file_extension":"md"}');

      // file
      parts.push(`--${boundary}`);
      parts.push(
        `Content-Disposition: form-data; name="file"; filename="${finalFileName}"`,
      );
      parts.push(`Content-Type: text/markdown`);
      parts.push('');

      // 组合请求体
      const textPart = parts.join('\r\n') + '\r\n';
      const endBoundary = `\r\n--${boundary}--\r\n`;

      const textPartBytes = new TextEncoder().encode(textPart);
      const endBoundaryBytes = new TextEncoder().encode(endBoundary);

      const totalLength =
        textPartBytes.length + utf8Content.length + endBoundaryBytes.length;
      const bodyBytes = new Uint8Array(totalLength);

      let offset = 0;
      bodyBytes.set(textPartBytes, offset);
      offset += textPartBytes.length;
      bodyBytes.set(utf8Content, offset);
      offset += utf8Content.length;
      bodyBytes.set(endBoundaryBytes, offset);

      logger.debug('发送上传请求', {
        ...ctx,
        totalLength,
        url: FEISHU_CONFIG.UPLOAD_URL,
      });

      const response = await this.requestWithAuth<
        FeishuApiResponse<{ file_token: string }>
      >(FEISHU_CONFIG.UPLOAD_URL, accessToken, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: bodyBytes.buffer, // 直接使用 ArrayBuffer，不转换为 Buffer
      });

      logger.debug('上传响应', {
        ...ctx,
        code: response.code,
        msg: response.msg,
      });

      if (response.code === 0 && response.data) {
        logger.info('文件上传成功', {
          ...ctx,
          fileToken: response.data.file_token,
        });
        return {
          success: true,
          fileToken: response.data.file_token,
        };
      } else {
        logger.error(
          '文件上传失败',
          new Error(`API错误: ${response.code} - ${response.msg}`),
          ctx,
        );
        return {
          success: false,
          error: response.msg || '文件上传失败',
        };
      }
    } catch (error) {
      logger.error(
        '文件上传异常',
        error instanceof Error ? error : new Error(String(error)),
        ctx,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : '文件上传失败',
      };
    }
  }

  /**
   * createImportTask method 创建导入任务.
   * 基于feishushare的实现，支持指定目标文件夹
   * 注意：飞书 API 要求必须提供 point 参数，即使上传到根目录
   */
  private async createImportTask(
    accessToken: string,
    fileToken: string,
    title: string,
    targetFolderId?: string,
  ): Promise<{ success: boolean; ticket?: string; error?: string }> {
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.createImportTask',
      tenantId: 'feishu-service',
    });

    try {
      const url = `${FEISHU_CONFIG.BASE_URL}/drive/v1/import_tasks`;
      
      // 构建请求体
      // 注意：根据参考项目 feishushare 的实现，point 参数是必需的
      // 如果不提供 targetFolderId，使用空字符串表示用户的根目录（我的空间）
      const requestBody: Record<string, unknown> = {
        file_extension: 'md',
        file_token: fileToken,
        type: 'docx',
        file_name: title,
        point: {
          mount_type: 1, // 1=云空间
          mount_key: targetFolderId || '', // 空字符串表示根目录
        },
      };

      logger.debug('创建导入任务请求', {
        ...ctx,
        url,
        requestBody,
        hasTargetFolder: !!targetFolderId,
      });

      const response = await this.requestWithAuth<
        FeishuApiResponse<{ ticket: string }>
      >(url, accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      logger.debug('创建导入任务响应', {
        ...ctx,
        code: response.code,
        msg: response.msg,
        hasData: !!response.data,
      });

      if (response.code === 0 && response.data) {
        logger.info('导入任务创建成功', {
          ...ctx,
          ticket: response.data.ticket,
        });
        return {
          success: true,
          ticket: response.data.ticket,
        };
      } else {
        logger.error(
          '创建导入任务失败',
          new Error(`API错误: ${response.code} - ${response.msg}`),
          {
            ...ctx,
            code: response.code,
            msg: response.msg,
            requestBody,
          },
        );
        return {
          success: false,
          error: response.msg || '创建导入任务失败',
        };
      }
    } catch (error) {
      logger.error(
        '创建导入任务异常',
        error instanceof Error ? error : new Error(String(error)),
        ctx,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建导入任务失败',
      };
    }
  }

  /**
   * waitForImportCompletion method 等待导入完成.
   * 基于feishushare的实现，改进了状态处理逻辑
   * 增加超时时间到60秒，更宽容的状态处理
   */
  private async waitForImportCompletion(
    accessToken: string,
    ticket: string,
    timeoutMs: number = 60000, // 增加到60秒
  ): Promise<{ success: boolean; documentToken?: string; error?: string }> {
    const startTime = Date.now();
    const maxAttempts = 30; // 增加最大尝试次数

    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.waitForImportCompletion',
      tenantId: 'feishu-service',
    });

    logger.info('开始等待导入任务完成', {
      ...ctx,
      ticket,
      timeoutMs,
      maxAttempts,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const elapsedTime = Date.now() - startTime;

      // 检查是否超时
      if (elapsedTime >= timeoutMs) {
        logger.warning('导入任务超时', {
          ...ctx,
          elapsedTime,
          timeoutMs,
          totalAttempts: attempt,
        });
        return {
          success: false,
          error: `导入任务超时 (${timeoutMs}ms)`,
        };
      }

      try {
        const url = `${FEISHU_CONFIG.BASE_URL}/drive/v1/import_tasks/${ticket}`;
        const response = await this.requestWithAuth<
          FeishuApiResponse<{
            result: {
              job_status: number;
              job_error_msg?: string;
              token?: string;
            };
          }>
        >(url, accessToken, { method: 'GET' });

        if (response.code === 0 && response.data) {
          const jobStatus = response.data.result.job_status;
          const documentToken = response.data.result.token;
          const errorMsg = response.data.result.job_error_msg;

          logger.debug('导入任务状态检查', {
            ...ctx,
            attempt,
            jobStatus,
            documentToken: documentToken ? 'present' : 'missing',
            errorMsg,
            elapsedTime,
          });

          // 状态 0 或 3 = 成功
          if (jobStatus === 0 || jobStatus === 3) {
            if (documentToken) {
              logger.info('导入任务成功完成', {
                ...ctx,
                documentToken,
                totalAttempts: attempt,
                totalTime: elapsedTime,
              });
              return {
                success: true,
                documentToken,
              };
            } else {
              logger.debug('成功状态但token未返回，继续等待', {
                ...ctx,
                attempt,
              });
              // 继续等待，可能token还没有返回
            }
          }
          // 状态 2 = 失败，但要宽容处理
          else if (jobStatus === 2) {
            // 如果有document token，即使显示失败也认为成功
            if (documentToken) {
              logger.info('状态显示失败但有token，认为成功', {
                ...ctx,
                documentToken,
                errorMsg,
                attempt,
              });
              return {
                success: true,
                documentToken,
              };
            }
            // 前15次尝试时，即使显示失败也继续等待（更宽容）
            else if (attempt <= 15) {
              logger.debug('失败状态但继续等待', {
                ...ctx,
                attempt,
                errorMsg,
              });
              // 继续等待
            }
            // 15次后才真正认为失败
            else {
              logger.error(
                '导入任务最终失败',
                new Error(errorMsg || '导入任务失败'),
                {
                  ...ctx,
                  totalAttempts: attempt,
                  errorMsg,
                },
              );
              return {
                success: false,
                error: errorMsg || '导入任务失败',
              };
            }
          }
          // 状态 -1 = 明确失败
          else if (jobStatus === -1) {
            logger.error(
              '导入任务明确失败',
              new Error(errorMsg || '导入失败'),
              {
                ...ctx,
                attempt,
                errorMsg,
              },
            );
            return {
              success: false,
              error: errorMsg || '导入失败',
            };
          }
          // 状态 1 = 进行中
          else if (jobStatus === 1) {
            logger.debug('导入任务进行中', { ...ctx, attempt, elapsedTime });
          }
          // 状态 116 = 权限错误
          else if (jobStatus === 116) {
            logger.error(
              '导入任务权限错误',
              new Error(errorMsg || '无权限访问目标位置'),
              {
                ...ctx,
                attempt,
                errorMsg,
              },
            );
            return {
              success: false,
              error: `权限错误: ${errorMsg || '无权限访问目标位置'}。请检查：1) 应用是否有知识库权限 2) 知识库ID是否正确 3) 尝试先上传到云空间`,
            };
          }
          // 未知状态
          else {
            logger.warning('未知的导入任务状态', {
              ...ctx,
              attempt,
              jobStatus,
              documentToken,
              errorMsg,
            });
          }
        } else {
          logger.warning('导入任务状态查询失败', {
            ...ctx,
            attempt,
            code: response.code,
            msg: response.msg,
          });
        }

        // 渐进式延迟
        if (attempt < maxAttempts) {
          const delay = this.getDelayForAttempt(attempt);
          await this.sleep(delay);
        }
      } catch (error) {
        // 轮询过程中的错误，记录但继续尝试
        logger.debug('导入任务状态查询异常，继续尝试', {
          ...ctx,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        const delay = this.getDelayForAttempt(attempt);
        await this.sleep(delay);
      }
    }

    logger.error('导入任务达到最大尝试次数', {
      ...ctx,
      maxAttempts,
      totalTime: Date.now() - startTime,
    });

    return {
      success: false,
      error: '导入任务超时',
    };
  }

  /**
   * getDelayForAttempt method 获取渐进式延迟时间.
   * 优化延迟策略，更快速地检查状态
   */
  private getDelayForAttempt(attempt: number): number {
    // 渐进式延迟策略：
    // 前5次：500ms (快速检查)
    // 6-10次：1秒 (正常检查)
    // 11-20次：2秒 (中速检查)
    // 21次以后：3秒 (慢速检查)
    if (attempt <= 5) {
      return 500; // 500ms
    } else if (attempt <= 10) {
      return 1000; // 1秒
    } else if (attempt <= 20) {
      return 2000; // 2秒
    } else {
      return 3000; // 3秒
    }
  }

  /**
   * generateRandomState method 生成随机状态值.
   */
  private generateRandomState(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * getMimeType method 获取文件 MIME 类型.
   */
  private getMimeType(fileName: string): string {
    const ext = fileName.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
    };
    return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
  }
}
