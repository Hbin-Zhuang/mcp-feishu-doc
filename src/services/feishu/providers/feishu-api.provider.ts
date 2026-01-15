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
        user_id: string;
      }>
    >(FEISHU_CONFIG.USER_INFO_URL, accessToken, { method: 'GET' });

    if (response.code !== 0 || !response.data) {
      throw new McpError(JsonRpcErrorCode.InternalError, '获取用户信息失败');
    }

    return {
      userId: response.data.user_id,
      name: response.data.name,
      email: response.data.email,
      avatarUrl: response.data.avatar_url,
    };
  }

  /**
   * createDocument method 创建飞书文档.
   * 使用飞书的导入API，先上传Markdown文件，然后导入为富文本文档
   */
  public async createDocument(
    accessToken: string,
    title: string,
    content: string,
    _targetType: 'drive' | 'wiki',
    _targetId?: string,
  ): Promise<FeishuDocument> {
    const ctx = requestContextService.createRequestContext({
      operation: 'feishu.createDocument',
      tenantId: 'feishu-service',
    });

    logger.info('开始创建飞书文档', { ...ctx, title });

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

    // 第二步：创建导入任务
    logger.debug('第二步：创建导入任务', ctx);
    const importResult = await this.createImportTask(
      accessToken,
      uploadResult.fileToken,
      title,
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
   * 注意：目前暂不支持更新，需要重新创建文档
   */
  public updateDocument(
    _accessToken: string,
    _documentId: string,
    _content: string,
  ): Promise<FeishuDocument> {
    // TODO: 实现文档更新功能
    throw new McpError(
      JsonRpcErrorCode.InternalError,
      '暂不支持文档更新，请重新创建文档',
    );
  }

  /**
   * getDocumentMeta method 获取文档元数据.
   */
  public async getDocumentMeta(
    accessToken: string,
    documentId: string,
  ): Promise<{ documentId: string; updatedAt: number }> {
    const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}`;
    const response = await this.requestWithAuth<
      FeishuApiResponse<{
        document: { document_id: string; revision_id: number; title: string };
      }>
    >(url, accessToken, { method: 'GET' });

    if (response.code !== 0) {
      throw new McpError(JsonRpcErrorCode.InternalError, '获取文档元数据失败');
    }

    return {
      documentId,
      updatedAt: Date.now(), // 飞书 API 不直接返回更新时间，需要通过其他方式获取
    };
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
   * 基于feishushare的实现，添加了point参数指定文档位置
   */
  private async createImportTask(
    accessToken: string,
    fileToken: string,
    title: string,
  ): Promise<{ success: boolean; ticket?: string; error?: string }> {
    try {
      const url = `${FEISHU_CONFIG.BASE_URL}/drive/v1/import_tasks`;
      const requestBody = {
        file_extension: 'md',
        file_token: fileToken,
        type: 'docx',
        file_name: title,
        point: {
          mount_type: 1, // 1=云空间
          mount_key: 'nodcn2EG5YG1i5Rsh5uZs0FsUje', // 默认根文件夹
        },
      };

      const response = await this.requestWithAuth<
        FeishuApiResponse<{ ticket: string }>
      >(url, accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (response.code === 0 && response.data) {
        return {
          success: true,
          ticket: response.data.ticket,
        };
      } else {
        return {
          success: false,
          error: response.msg || '创建导入任务失败',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建导入任务失败',
      };
    }
  }

  /**
   * waitForImportCompletion method 等待导入完成.
   * 基于feishushare的实现，改进了状态处理逻辑
   */
  private async waitForImportCompletion(
    accessToken: string,
    ticket: string,
    timeoutMs: number = 15000,
  ): Promise<{ success: boolean; documentToken?: string; error?: string }> {
    const startTime = Date.now();
    const maxAttempts = 25;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const elapsedTime = Date.now() - startTime;

      // 检查是否超时
      if (elapsedTime >= timeoutMs) {
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

          const ctx = requestContextService.createRequestContext({
            operation: 'feishu.waitForImportCompletion',
            tenantId: 'feishu-service',
          });

          logger.debug('导入任务状态检查', {
            ...ctx,
            attempt,
            jobStatus,
            documentToken: documentToken ? 'present' : 'missing',
            errorMsg,
            elapsedTime: Date.now() - startTime,
          });

          if (jobStatus === 0 || jobStatus === 3) {
            // 成功状态
            if (documentToken) {
              logger.info('导入任务成功完成', {
                ...ctx,
                documentToken,
                totalAttempts: attempt,
                totalTime: Date.now() - startTime,
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
          } else if (jobStatus === 2) {
            // 失败状态，但检查是否有document token
            if (documentToken) {
              // 即使显示失败，如果有token也认为成功
              logger.info('状态显示失败但有token，认为成功', {
                ...ctx,
                documentToken,
                errorMsg,
              });
              return {
                success: true,
                documentToken,
              };
            } else if (attempt <= 8) {
              // 前8次尝试时，即使显示失败也继续等待
              logger.debug('失败状态但继续等待', { ...ctx, attempt, errorMsg });
              // 继续等待
            } else {
              // 8次后才真正认为失败
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
          } else if (jobStatus === -1) {
            // 明确的失败状态
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
          } else if (jobStatus === 1) {
            // 进行中状态
            logger.debug('导入任务进行中', { ...ctx, attempt });
          } else {
            // 未知状态
            logger.warning('未知的导入任务状态', {
              ...ctx,
              attempt,
              jobStatus,
              documentToken,
              errorMsg,
            });
          }
        }

        // 渐进式延迟
        if (attempt < maxAttempts) {
          const delay = this.getDelayForAttempt(attempt);
          await this.sleep(delay);
        }
      } catch (_error) {
        // 轮询过程中的错误，继续尝试
        const delay = this.getDelayForAttempt(attempt);
        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: '导入任务超时',
    };
  }

  /**
   * getDelayForAttempt method 获取渐进式延迟时间.
   */
  private getDelayForAttempt(attempt: number): number {
    // 渐进式延迟策略：
    // 前3次：1秒 (快速检查)
    // 4-8次：2秒 (正常检查)
    // 9次以后：3秒 (慢速检查)
    if (attempt <= 3) {
      return 1000; // 1秒
    } else if (attempt <= 8) {
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
