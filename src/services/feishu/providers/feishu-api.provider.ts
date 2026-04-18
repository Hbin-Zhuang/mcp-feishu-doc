/**
 * @fileoverview 飞书 API 提供者实现.
 * @module src/services/feishu/providers/feishu-api.provider
 */

import { injectable } from 'tsyringe';
import type { IFeishuApiProvider } from '../core/IFeishuProvider.js';
import type {
  FeishuAuth,
  FeishuDocument,
  FeishuDocumentAsset,
  FeishuDocumentContent,
  FeishuDocumentMediaPatch,
  FeishuDocumentMediaPatchResult,
  FeishuDocumentReadBlock,
  FeishuFolder,
  FeishuUserInfo,
  FeishuWikiSpace,
  FeishuWikiNode,
  FeishuOAuthResponse,
  FeishuApiResponse,
  MediaUploadFailure,
  UploadedFile,
} from '../types.js';
import {
  FEISHU_CONFIG,
  DOC_IMAGE_EMBED_LIMITS,
  DOC_MEDIA_READ_LIMITS,
  TOKEN_EXPIRED_CODES,
  FEISHU_ERROR_MESSAGES,
  DOC_FILE_PREVIEW_LIMITS,
  DOC_MEDIA_UPLOAD_LIMITS,
} from '../constants.js';
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';
import { logger, pdfParser, requestContextService } from '@/utils/index.js';

/** HTTP 请求选项 */
interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | Buffer | FormData | ArrayBuffer;
  timeout?: number;
}

interface DocumentBlockRecord extends Record<string, unknown> {
  block_id: string;
  block_type: number;
  parent_id: string;
  children?: string[];
}

type ExtractedDocumentBlockContent =
  | { type: 'text'; value: string }
  | { type: 'image'; fileToken: string }
  | { type: 'file'; fileToken: string };

interface FetchedMediaArtifact {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  localPath?: string;
}

interface ImageDeliveryDecision {
  deliveryMode: FeishuDocumentAsset['deliveryMode'];
  status: FeishuDocumentAsset['status'];
  reason?: string;
}

interface BlockPatchGroup {
  targetBlockId: string;
  patches: FeishuDocumentMediaPatch[];
}

interface BlockReplacementPlanItem {
  kind: 'media' | 'text';
  patch?: FeishuDocumentMediaPatch;
  text?: string;
}

/**
 * FeishuApiProvider class 飞书 API 提供者.
 * 封装所有飞书开放平台 API 调用.
 */
@injectable()
export class FeishuApiProvider implements IFeishuApiProvider {
  public readonly name = 'feishu-api';
  private refreshPromise: Promise<FeishuAuth | null> | null = null;
  private lastTempCleanupAt = 0;

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
  ): Promise<FeishuDocumentContent> {
    // 获取文档基础信息
    const meta = await this.getDocumentMeta(accessToken, documentId);
    const allBlocks = await this.fetchAllDocumentBlocks(accessToken, documentId);

    const normalizedBlocks = this.normalizeDocumentReadBlocks(allBlocks);
    const assetsByToken = await this.resolveDocumentReadAssets(
      accessToken,
      documentId,
      normalizedBlocks,
    );
    const blocks = this.decorateDocumentReadBlocks(
      normalizedBlocks,
      assetsByToken,
    );

    return {
      title: this.extractDocumentReadTitle(allBlocks, documentId),
      content: this.renderDocumentReadText(blocks),
      revisionId: meta.revisionId,
      blocks,
      assets: Array.from(assetsByToken.values()),
    };
  }

  /**
   * replaceDocumentPlaceholdersWithMedia method 将占位符文本替换为图片或附件块.
   */
  public async replaceDocumentPlaceholdersWithMedia(
    accessToken: string,
    documentId: string,
    patches: FeishuDocumentMediaPatch[],
  ): Promise<FeishuDocumentMediaPatchResult> {
    const uploadedFiles: UploadedFile[] = [];
    const mediaUploadFailures: MediaUploadFailure[] = [];
    const blocks =
      patches.length > 0
        ? await this.fetchAllDocumentBlocks(accessToken, documentId)
        : [];
    const { groups, unresolvedPatches } = this.groupPatchesByTargetBlock(
      blocks,
      patches,
    );

    mediaUploadFailures.push(
      ...unresolvedPatches.map((patch) => ({
        originalPath: patch.originalPath,
        fileName: patch.fileName,
        isImage: patch.type === 'image',
        error: `未找到占位符: ${patch.placeholder}`,
        status: 'upload_failed' as const,
      })),
    );

    for (const group of groups) {
      const groupResult = await this.replaceBlockPlaceholdersWithMedia(
        accessToken,
        documentId,
        group,
        blocks,
      );
      uploadedFiles.push(...groupResult.uploadedFiles);
      mediaUploadFailures.push(...groupResult.mediaUploadFailures);
    }

    return {
      uploadedFiles,
      mediaUploadFailures,
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

    // 为了与工具的 OutputSchema 严格对齐，确保所有字段都为字符串，
    // 即便飞书返回中缺少某些字段，也会使用安全的兜底值。
    return (response.data.docs_entities ?? []).map((doc) => ({
      token: doc.doc_token ?? '',
      name: doc.title ?? '',
      url: doc.url ?? '',
      type: doc.doc_type ?? '',
      ownerName: doc.owner_id ?? '',
    }));
  }

  /**
   * normalizeDocumentReadBlocks method 归一化文档读取块.
   */
  private normalizeDocumentReadBlocks(
    blocks: DocumentBlockRecord[],
  ): FeishuDocumentReadBlock[] {
    const normalized: FeishuDocumentReadBlock[] = [];

    for (const block of blocks) {
      if (block.block_type === 1) {
        continue;
      }

      const content = this.extractBlockContent(block);
      if (!content) {
        continue;
      }

      if (content.type === 'text') {
        const text = content.value.trim();
        if (!text) {
          continue;
        }

        normalized.push({
          blockId: block.block_id,
          type: 'text',
          text,
        });
        continue;
      }

      normalized.push({
        blockId: block.block_id,
        type: content.type,
        fileToken: content.fileToken,
      });
    }

    return normalized;
  }

  /**
   * resolveDocumentReadAssets method 解析文档中的图片与附件资产.
   */
  private async resolveDocumentReadAssets(
    accessToken: string,
    documentId: string,
    blocks: FeishuDocumentReadBlock[],
  ): Promise<Map<string, FeishuDocumentAsset>> {
    await this.cleanupExpiredTempArtifacts();

    const fileTokens = Array.from(
      new Set(
        blocks
          .map((block) => block.fileToken)
          .filter((fileToken): fileToken is string => Boolean(fileToken)),
      ),
    );

    const urlMap = await this.batchGetTmpDownloadUrls(accessToken, fileTokens);
    const assets = new Map<string, FeishuDocumentAsset>();
    let inlineImageCount = 0;
    let inlineImageBytes = 0;
    const uniqueMediaBlocks = blocks.filter((block, index) => {
      if (!block.fileToken) {
        return false;
      }

      return (
        fileTokens.includes(block.fileToken) &&
        blocks.findIndex(
          (candidate) => candidate.fileToken === block.fileToken,
        ) === index
      );
    });
    const artifacts = await this.mapWithConcurrencyLimit(
      uniqueMediaBlocks,
      DOC_MEDIA_READ_LIMITS.downloadConcurrency,
      async (block) => {
        const fileToken = block.fileToken;
        if (!fileToken) {
          return null;
        }

        const tmpUrl = urlMap.get(fileToken);
        if (!tmpUrl) {
          return null;
        }

        const artifact = await this.fetchMediaArtifact(
          tmpUrl,
          accessToken,
          documentId,
          fileToken,
        );
        if (!artifact) {
          return null;
        }

        return { fileToken, artifact };
      },
    );
    const artifactsByToken = new Map(
      artifacts
        .filter(
          (
            item,
          ): item is { fileToken: string; artifact: FetchedMediaArtifact } =>
            Boolean(item),
        )
        .map((item) => [item.fileToken, item.artifact]),
    );

    for (const block of uniqueMediaBlocks) {
      const fileToken = block.fileToken;
      if (!fileToken || assets.has(fileToken)) {
        continue;
      }

      const artifact = artifactsByToken.get(fileToken);
      if (!artifact) {
        continue;
      }

      const mimeType = this.normalizeMimeType(artifact.mimeType);
      const asset: FeishuDocumentAsset = {
        fileToken,
        type: block.type === 'image' ? 'image' : 'file',
        fileName: artifact.fileName,
        mimeType,
        byteLength: artifact.bytes.length,
      };

      if (artifact.localPath) {
        asset.localPath = artifact.localPath;
      }

      if (block.type === 'image') {
        const decision = this.decideImageDeliveryMode(
          artifact.bytes.length,
          inlineImageCount,
          inlineImageBytes,
        );
        if (decision.deliveryMode) {
          asset.deliveryMode = decision.deliveryMode;
        }
        if (decision.status) {
          asset.status = decision.status;
        }
        if (decision.reason) {
          asset.reason = decision.reason;
        }

        if (decision.deliveryMode === 'inline_base64') {
          asset.base64Data = Buffer.from(artifact.bytes).toString('base64');
          inlineImageCount += 1;
          inlineImageBytes += artifact.bytes.length;
        }
      } else {
        asset.deliveryMode = 'local_file_only';
        asset.status = 'downloaded';
        const previewText = await this.extractDocumentFilePreview(
          artifact.bytes,
          mimeType,
        );
        if (previewText) {
          asset.previewText = previewText;
        }
      }

      assets.set(fileToken, asset);
    }

    return assets;
  }

  /**
   * mapWithConcurrencyLimit method 以有限并发执行异步映射.
   */
  private async mapWithConcurrencyLimit<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) {
      return [];
    }

    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
        }
      }),
    );

    return results;
  }

  /**
   * decideImageDeliveryMode method 根据限制决定图片返回方式.
   */
  private decideImageDeliveryMode(
    byteLength: number,
    inlineImageCount: number,
    inlineImageBytes: number,
  ): ImageDeliveryDecision {
    if (byteLength > DOC_IMAGE_EMBED_LIMITS.maxSingleImageBytes) {
      return {
        deliveryMode: 'local_file_only',
        status: 'skipped_too_large',
        reason: '图片超过单张内联大小限制',
      };
    }

    if (inlineImageCount >= DOC_IMAGE_EMBED_LIMITS.maxImages) {
      return {
        deliveryMode: 'local_file_only',
        status: 'skipped_over_limit',
        reason: '图片数量超过内联上限',
      };
    }

    if (
      inlineImageBytes + byteLength > DOC_IMAGE_EMBED_LIMITS.maxTotalBytes
    ) {
      return {
        deliveryMode: 'local_file_only',
        status: 'skipped_over_limit',
        reason: '图片总内联大小超过限制',
      };
    }

    return {
      deliveryMode: 'inline_base64',
      status: 'downloaded',
    };
  }

  /**
   * decorateDocumentReadBlocks method 为文档块补齐占位文本.
   */
  private decorateDocumentReadBlocks(
    blocks: FeishuDocumentReadBlock[],
    assetsByToken: Map<string, FeishuDocumentAsset>,
  ): FeishuDocumentReadBlock[] {
    let imageIndex = 0;
    let fileIndex = 0;

    return blocks.map((block) => {
      if (block.type === 'text') {
        return block;
      }

      const asset = block.fileToken
        ? assetsByToken.get(block.fileToken)
        : undefined;
      const fileName = asset?.fileName || block.fileToken || 'unknown';

      if (block.type === 'image') {
        imageIndex += 1;
        return {
          ...block,
          placeholderText: `[图片${imageIndex}：${fileName}]`,
        };
      }

      fileIndex += 1;
      return {
        ...block,
        placeholderText: `[附件${fileIndex}：${fileName}]`,
      };
    });
  }

  /**
   * renderDocumentReadText method 生成最终文本表示.
   */
  private renderDocumentReadText(blocks: FeishuDocumentReadBlock[]): string {
    return blocks
      .map((block) => {
        if (block.type === 'text') {
          return block.text ?? '';
        }
        return block.placeholderText ?? '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * extractDocumentReadTitle method 提取文档标题.
   */
  private extractDocumentReadTitle(
    blocks: DocumentBlockRecord[],
    fallbackTitle: string,
  ): string {
    const pageBlock = blocks.find((block) => block.block_type === 1) as
      | (DocumentBlockRecord & {
          page?: { elements?: Array<{ text_run?: { content?: string } }> };
        })
      | undefined;

    const title = this.extractTextFromElements(pageBlock?.page?.elements).trim();
    return title || fallbackTitle;
  }

  /**
   * fetchMediaArtifact method 拉取媒体文件并写入临时目录.
   */
  private async fetchMediaArtifact(
    tmpUrl: string,
    accessToken: string,
    documentId: string,
    fileToken: string,
  ): Promise<FetchedMediaArtifact | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(tmpUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const fileName =
        this.extractFileNameFromHeaders(response.headers, fileToken) || fileToken;
      const mimeType =
        response.headers.get('content-type') || 'application/octet-stream';
      const localPath = await this.writeTempArtifact(
        documentId,
        fileToken,
        fileName,
        bytes,
      );

      return {
        fileName,
        mimeType,
        bytes,
        ...(localPath ? { localPath } : {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * writeTempArtifact method 写入本地临时文件.
   */
  private async writeTempArtifact(
    documentId: string,
    fileToken: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<string | undefined> {
    try {
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');

      const rootDir = path.join(os.tmpdir(), 'mcp-feishu-doc', 'feishu-assets');
      const documentDir = path.join(rootDir, documentId);
      const safeName = this.sanitizeFileName(fileName);
      const targetPath = path.join(documentDir, `${fileToken}-${safeName}`);

      await fs.mkdir(documentDir, { recursive: true });
      await fs.writeFile(targetPath, bytes);

      return targetPath;
    } catch {
      return undefined;
    }
  }

  /**
   * cleanupExpiredTempArtifacts method 清理过期临时文件目录.
   */
  private async cleanupExpiredTempArtifacts(): Promise<void> {
    const now = Date.now();
    if (
      now - this.lastTempCleanupAt <
      DOC_FILE_PREVIEW_LIMITS.tempArtifactTtlMs / 4
    ) {
      return;
    }

    this.lastTempCleanupAt = now;

    try {
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');

      const rootDir = path.join(os.tmpdir(), 'mcp-feishu-doc', 'feishu-assets');
      const entries = await fs.readdir(rootDir, { withFileTypes: true });

      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isDirectory()) {
            return;
          }

          const fullPath = path.join(rootDir, entry.name);
          const stats = await fs.stat(fullPath);
          if (
            now - stats.mtimeMs >
            DOC_FILE_PREVIEW_LIMITS.tempArtifactTtlMs
          ) {
            await fs.rm(fullPath, { recursive: true, force: true });
          }
        }),
      );
    } catch {
      return;
    }
  }

  /**
   * extractDocumentFilePreview method 提取附件文本预览.
   */
  private async extractDocumentFilePreview(
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<string | undefined> {
    if (bytes.length > DOC_FILE_PREVIEW_LIMITS.maxPreviewBytes) {
      return undefined;
    }

    const normalizedMimeType = this.normalizeMimeType(mimeType);
    const textLikeMimeTypes = [
      'text/',
      'application/json',
      'application/xml',
      'application/javascript',
      'image/svg+xml',
    ];

    try {
      if (
        textLikeMimeTypes.some((prefix) =>
          normalizedMimeType.startsWith(prefix),
        )
      ) {
        return this.limitPreviewText(Buffer.from(bytes).toString('utf8'));
      }

      if (normalizedMimeType === 'application/pdf') {
        const document = await pdfParser.loadDocument(bytes);
        const extracted = await pdfParser.extractText(document, {
          mergePages: true,
        });

        return this.limitPreviewText(
          typeof extracted.text === 'string'
            ? extracted.text
            : extracted.text.join('\n\n'),
        );
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  /**
   * extractFileNameFromHeaders method 从响应头解析文件名.
   */
  private extractFileNameFromHeaders(
    headers: Headers,
    fallbackName: string,
  ): string {
    const disposition = headers.get('content-disposition');
    if (!disposition) {
      return fallbackName;
    }

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1]);
    }

    const quotedMatch = disposition.match(/filename="([^"]+)"/i);
    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const plainMatch = disposition.match(/filename=([^;]+)/i);
    if (plainMatch?.[1]) {
      return plainMatch[1].trim();
    }

    return fallbackName;
  }

  /**
   * limitPreviewText method 限制附件预览长度.
   */
  private limitPreviewText(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) {
      return undefined;
    }

    return trimmed.slice(0, DOC_FILE_PREVIEW_LIMITS.maxPreviewChars);
  }

  /**
   * normalizeMimeType method 归一化 MIME 类型.
   */
  private normalizeMimeType(mimeType: string): string {
    return mimeType.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
  }

  /**
   * sanitizeFileName method 清理文件名.
   */
  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^\w.\-]+/g, '_');
  }

  /**
   * extractTextFromElements method 提取文本元素中的文本.
   */
  private extractTextFromElements(
    elements?: Array<{ text_run?: { content?: string } }>,
  ): string {
    return (elements ?? []).map((e) => e.text_run?.content || '').join('');
  }

  /**
   * batchGetTmpDownloadUrls method 批量获取素材临时下载链接.
   */
  private async batchGetTmpDownloadUrls(
    accessToken: string,
    fileTokens: string[],
  ): Promise<Map<string, string>> {
    if (fileTokens.length === 0) return new Map();

    const map = new Map<string, string>();
    for (
      let start = 0;
      start < fileTokens.length;
      start += DOC_MEDIA_READ_LIMITS.tmpDownloadUrlBatchSize
    ) {
      const batch = fileTokens.slice(
        start,
        start + DOC_MEDIA_READ_LIMITS.tmpDownloadUrlBatchSize,
      );
      const params = new URLSearchParams();
      batch.forEach((t) => params.append('file_tokens', t));
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
        continue;
      }

      for (const item of resp.data.tmp_download_urls) {
        if (item.file_token && item.tmp_download_url) {
          map.set(item.file_token, item.tmp_download_url);
        }
      }
    }

    return map;
  }

  /**
   * extractBlockContent method 从 block 提取内容（文本或图片 file_token）.
   */
  private extractBlockContent(
    block: Record<string, unknown>,
  ): ExtractedDocumentBlockContent | null {
    const blockType = block.block_type as number;

    switch (blockType) {
      case 2: {
        const b = block as { text?: { elements?: Array<{ text_run?: { content?: string } }> } };
        const v = this.extractTextFromElements(b.text?.elements);
        return v ? { type: 'text', value: v } : null;
      }
      case 3: {
        const b = block as { heading1?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `# ${this.extractTextFromElements(b.heading1?.elements)}` };
      }
      case 4: {
        const b = block as { heading2?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `## ${this.extractTextFromElements(b.heading2?.elements)}` };
      }
      case 5: {
        const b = block as { heading3?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `### ${this.extractTextFromElements(b.heading3?.elements)}` };
      }
      case 10: {
        const b = block as { bullet?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `- ${this.extractTextFromElements(b.bullet?.elements)}` };
      }
      case 11: {
        const b = block as { ordered?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `1. ${this.extractTextFromElements(b.ordered?.elements)}` };
      }
      case 12: {
        const b = block as { code?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `\`\`\`\n${this.extractTextFromElements(b.code?.elements)}\n\`\`\`` };
      }
      case 15: {
        const b = block as { quote?: { elements?: Array<{ text_run?: { content?: string } }> } };
        return { type: 'text', value: `> ${this.extractTextFromElements(b.quote?.elements)}` };
      }
      case 22:
      case 27: {
        const b = block as { image?: { file_token?: string; token?: string } };
        const ft = b.image?.file_token ?? b.image?.token;
        return ft ? { type: 'image', fileToken: ft } : null;
      }
      case 23: {
        const b = block as { file?: { file_token?: string; token?: string } };
        const ft = b.file?.file_token ?? b.file?.token;
        return ft ? { type: 'file', fileToken: ft } : null;
      }
      default: {
        // 为了兼容未来可能新增的 block 类型，这里做一个宽松的兜底：
        // 在未知类型中，遍历其子对象，尝试查找任何包含 elements[].text_run.content 的结构，
        // 将其拼接为纯文本返回，避免丢失内容（例如代码块、段落等结构发生变更时）。
        const candidates: Array<{ text_run?: { content?: string } }> = [];
        const visit = (value: unknown) => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
          }
          const obj = value as { elements?: Array<{ text_run?: { content?: string } }> };
          if (Array.isArray(obj.elements)) {
            candidates.push(...obj.elements);
          }
          for (const v of Object.values(obj)) {
            visit(v);
          }
        };

        visit(block);
        const text = this.extractTextFromElements(candidates);
        return text ? { type: 'text', value: text } : null;
      }
    }
  }

  /**
   * uploadFile method 上传文件到飞书.
   */
  public async uploadFile(
    accessToken: string,
    filePath: string,
    fileType: 'image' | 'file',
    parentNodeToken: string,
  ): Promise<string> {
    const fs = await import('node:fs');
    const path = await import('node:path');

    if (!fs.existsSync(filePath)) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `文件不存在: ${filePath}`,
      );
    }

    const fileName = path.basename(filePath);
    const mimeType = this.getMimeType(fileName);
    const fileStat = fs.statSync(filePath);
    const formData = new FormData();
    const openAsBlob = (fs as typeof fs & {
      openAsBlob?: (
        path: string,
        options?: { type?: string },
      ) => Promise<Blob>;
    }).openAsBlob;
    const fileBlob =
      typeof openAsBlob === 'function'
        ? await openAsBlob(filePath, { type: mimeType })
        : new Blob([fs.readFileSync(filePath)], { type: mimeType });

    formData.append('file_name', fileName);
    formData.append(
      'parent_type',
      fileType === 'image' ? 'docx_image' : 'docx_file',
    );
    formData.append('parent_node', parentNodeToken);
    formData.append('size', String(fileStat.size));
    formData.append('file', fileBlob, fileName);

    const response = await this.requestWithAuth<
      FeishuApiResponse<{ file_token: string }>
    >(FEISHU_CONFIG.UPLOAD_URL, accessToken, {
      method: 'POST',
      body: formData,
    });

    if (response.code !== 0 || !response.data) {
      const errorMsg =
        FEISHU_ERROR_MESSAGES[response.code] ?? response.msg ?? '文件上传失败';
      throw new McpError(JsonRpcErrorCode.InternalError, errorMsg);
    }

    return response.data.file_token;
  }

  /**
   * uploadFileBuffer method 上传文件 Buffer 到飞书.
   */
  public async uploadFileBuffer(
    accessToken: string,
    buffer: Buffer,
    fileName: string,
    fileType: 'image' | 'file',
    parentNodeToken: string,
  ): Promise<string> {
    if (!parentNodeToken) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        '上传文档媒体时必须提供 parentNodeToken',
      );
    }

    const formData = new FormData();
    formData.append('file_name', fileName);
    formData.append(
      'parent_type',
      fileType === 'image' ? 'docx_image' : 'docx_file',
    );
    formData.append('parent_node', parentNodeToken);
    formData.append('size', String(buffer.length));
    formData.append(
      'file',
      new Blob([buffer], { type: this.getMimeType(fileName) }),
      fileName,
    );

    const response = await this.requestWithAuth<
      FeishuApiResponse<{ file_token: string }>
    >(FEISHU_CONFIG.UPLOAD_URL, accessToken, {
      method: 'POST',
      body: formData,
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
   * fetchAllDocumentBlocks method 获取文档全部 block.
   */
  private async fetchAllDocumentBlocks(
    accessToken: string,
    documentId: string,
  ): Promise<DocumentBlockRecord[]> {
    const allBlocks: DocumentBlockRecord[] = [];

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        page_size: '200',
        document_revision_id: '-1',
      });
      if (pageToken) params.set('page_token', pageToken);
      const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}/blocks?${params.toString()}`;
      const resp = await this.requestWithAuth<
        FeishuApiResponse<{
          items: DocumentBlockRecord[];
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

    return allBlocks;
  }

  /**
   * replaceSinglePlaceholderWithMedia method 将单个占位符替换为媒体块.
   */
  private groupPatchesByTargetBlock(
    blocks: DocumentBlockRecord[],
    patches: FeishuDocumentMediaPatch[],
  ): {
    groups: BlockPatchGroup[];
    unresolvedPatches: FeishuDocumentMediaPatch[];
  } {
    const groupedPatches = new Map<string, FeishuDocumentMediaPatch[]>();
    const unresolvedPatches: FeishuDocumentMediaPatch[] = [];

    for (const patch of patches) {
      const placeholderVariants = this.buildPlaceholderVariants(patch.placeholder);
      const targetBlock = blocks.find((block) => {
        const text = this.extractTextContentForPatch(block);
        return placeholderVariants.some((placeholder) => text.includes(placeholder));
      });

      if (!targetBlock) {
        unresolvedPatches.push(patch);
        continue;
      }

      const group = groupedPatches.get(targetBlock.block_id) ?? [];
      group.push(patch);
      groupedPatches.set(targetBlock.block_id, group);
    }

    const groups = blocks
      .map((block) => {
        const targetPatches = groupedPatches.get(block.block_id);
        if (!targetPatches?.length) {
          return null;
        }

        return {
          targetBlockId: block.block_id,
          patches: targetPatches,
        } satisfies BlockPatchGroup;
      })
      .filter((group): group is BlockPatchGroup => Boolean(group));

    return {
      groups,
      unresolvedPatches,
    };
  }

  private async replaceBlockPlaceholdersWithMedia(
    accessToken: string,
    documentId: string,
    group: BlockPatchGroup,
    blocks: DocumentBlockRecord[],
  ): Promise<FeishuDocumentMediaPatchResult> {
    const targetBlock = blocks.find(
      (block) => block.block_id === group.targetBlockId,
    );
    if (!targetBlock) {
      return {
        uploadedFiles: [],
        mediaUploadFailures: group.patches.map((patch) => ({
          originalPath: patch.originalPath,
          fileName: patch.fileName,
          isImage: patch.type === 'image',
          error: `未找到占位符: ${patch.placeholder}`,
          status: 'upload_failed',
        })),
      };
    }

    const originalText = this.extractTextContentForPatch(targetBlock);
    const parentId = targetBlock.parent_id || documentId;
    const siblingIndex = this.resolveSiblingIndex(blocks, targetBlock, parentId);
    let insertIndex = siblingIndex;
    let createdChildren: DocumentBlockRecord[] = [];
    let originalTextUpdated = false;
    let originalBlockDeleted = false;

    try {
      const occurrences = group.patches
        .map((patch) => {
          const placeholderVariants = this.buildPlaceholderVariants(
            patch.placeholder,
          );
          const matchedPlaceholder = placeholderVariants.find((placeholder) =>
            originalText.includes(placeholder),
          );
          if (!matchedPlaceholder) {
            return null;
          }

          return {
            patch,
            matchedPlaceholder,
            index: originalText.indexOf(matchedPlaceholder),
          };
        })
        .filter(
          (
            occurrence,
          ): occurrence is {
            patch: FeishuDocumentMediaPatch;
            matchedPlaceholder: string;
            index: number;
          } => Boolean(occurrence),
        )
        .sort((left, right) => left.index - right.index);

      if (occurrences.length !== group.patches.length) {
        throw new McpError(
          JsonRpcErrorCode.InvalidParams,
          '存在无法定位的占位符',
        );
      }

      const textSegments: string[] = [];
      let cursor = 0;
      for (const occurrence of occurrences) {
        textSegments.push(originalText.slice(cursor, occurrence.index).trim());
        cursor = occurrence.index + occurrence.matchedPlaceholder.length;
      }
      textSegments.push(originalText.slice(cursor).trim());

      const leadingText = textSegments[0] ?? '';
      const planItems: BlockReplacementPlanItem[] = [];
      for (let index = 0; index < occurrences.length; index += 1) {
        planItems.push({
          kind: 'media',
          patch: occurrences[index]!.patch,
        });
        const trailingText = textSegments[index + 1] ?? '';
        if (trailingText) {
          planItems.push({
            kind: 'text',
            text: trailingText,
          });
        }
      }

      insertIndex = leadingText ? siblingIndex + 1 : siblingIndex;
      createdChildren = await this.createBlocksAfterIndex(
        accessToken,
        documentId,
        parentId,
        insertIndex,
        planItems.map((item) =>
          item.kind === 'media'
            ? this.buildMediaChildBlock(item.patch!)
            : this.buildTextChildBlock(item.text!),
        ),
      );

      this.mergeCreatedChildrenIntoBlockState(
        blocks,
        parentId,
        insertIndex,
        createdChildren,
      );

      const mediaAssignments = planItems
        .map((item, index) => ({
          item,
          createdBlock: createdChildren[index],
        }))
        .filter(
          (
            assignment,
          ): assignment is {
            item: BlockReplacementPlanItem & { kind: 'media'; patch: FeishuDocumentMediaPatch };
            createdBlock: DocumentBlockRecord | undefined;
          } => assignment.item.kind === 'media',
        );

      const uploadedFiles = await this.mapWithConcurrencyLimit(
        mediaAssignments,
        DOC_MEDIA_UPLOAD_LIMITS.uploadConcurrency,
        async ({ item, createdBlock }) => {
          const mediaBlockId = this.resolveCreatedMediaBlockId(
            createdBlock,
            item.patch,
          );
          const uploadPath = item.patch.resolvedPath ?? item.patch.originalPath;
          const fileToken = await this.uploadFile(
            accessToken,
            uploadPath,
            item.patch.type,
            mediaBlockId,
          );

          await this.replaceMediaBlockToken(
            accessToken,
            documentId,
            mediaBlockId,
            item.patch.type,
            fileToken,
          );

          return {
            originalPath: item.patch.originalPath,
            fileName: item.patch.fileName,
            fileKey: fileToken,
            isImage: item.patch.type === 'image',
          } satisfies UploadedFile;
        },
      );

      if (leadingText) {
        await this.updateTextBlock(
          accessToken,
          documentId,
          targetBlock.block_id,
          leadingText,
        );
        this.setTextContentForPatchBlock(targetBlock, leadingText);
        originalTextUpdated = true;
      } else {
        await this.deleteChildBlock(
          accessToken,
          documentId,
          parentId,
          insertIndex + createdChildren.length,
          insertIndex + createdChildren.length + 1,
        );
        this.removeBlockFromState(blocks, parentId, targetBlock.block_id);
        originalBlockDeleted = true;
      }

      return {
        uploadedFiles,
        mediaUploadFailures: [],
      };
    } catch (error) {
      await this.rollbackGroupedReplacement({
        accessToken,
        documentId,
        parentId,
        insertIndex,
        createdChildren,
        blocks,
        targetBlock,
        originalText,
        originalTextUpdated,
        originalBlockDeleted,
      });

      const message =
        error instanceof Error ? error.message : '文档媒体回填失败';
      return {
        uploadedFiles: [],
        mediaUploadFailures: group.patches.map((patch) => ({
          originalPath: patch.originalPath,
          fileName: patch.fileName,
          isImage: patch.type === 'image',
          error: message,
          status: 'upload_failed',
        })),
      };
    }
  }

  /**
   * buildPlaceholderVariants method 生成占位符的兼容匹配候选.
   */
  private buildPlaceholderVariants(placeholder: string): string[] {
    const variants = new Set([placeholder]);
    const normalized = placeholder.replace(/^_+|_+$/g, '');
    if (normalized) {
      variants.add(normalized);
    }
    return Array.from(variants);
  }

  /**
   * rollbackGroupedReplacement method 清理分组回填失败时创建的临时块并尽力恢复原文本.
   */
  private async rollbackGroupedReplacement(params: {
    accessToken: string;
    documentId: string;
    parentId: string;
    insertIndex: number;
    createdChildren: DocumentBlockRecord[];
    blocks: DocumentBlockRecord[];
    targetBlock: DocumentBlockRecord;
    originalText: string;
    originalTextUpdated: boolean;
    originalBlockDeleted: boolean;
  }): Promise<void> {
    const {
      accessToken,
      documentId,
      parentId,
      insertIndex,
      createdChildren,
      blocks,
      targetBlock,
      originalText,
      originalTextUpdated,
      originalBlockDeleted,
    } = params;

    const ctx = requestContextService.createRequestContext({
      operation: 'feishuRollbackGroupedMediaReplacement',
      additionalContext: {
        documentId,
        parentId,
        targetBlockId: targetBlock.block_id,
      },
    });

    if (createdChildren.length > 0) {
      try {
        await this.deleteChildBlock(
          accessToken,
          documentId,
          parentId,
          insertIndex,
          insertIndex + createdChildren.length,
        );
        this.removeCreatedChildrenFromState(
          blocks,
          parentId,
          createdChildren.map((child) => child.block_id),
        );
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        logger.warning(
          '文档媒体回填失败后清理创建的子块失败',
          { ...ctx, cleanupError: cleanupMessage },
        );
      }
    }

    if (originalTextUpdated && !originalBlockDeleted) {
      try {
        await this.updateTextBlock(
          accessToken,
          documentId,
          targetBlock.block_id,
          originalText,
        );
        this.setTextContentForPatchBlock(targetBlock, originalText);
      } catch (restoreError) {
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError);
        logger.warning(
          '文档媒体回填失败后恢复原始文本失败',
          { ...ctx, restoreError: restoreMessage },
        );
      }
    }
  }

  /**
   * mergeCreatedChildrenIntoBlockState method 将新创建的块合并到本地 block 状态.
   */
  private mergeCreatedChildrenIntoBlockState(
    blocks: DocumentBlockRecord[],
    parentId: string,
    insertIndex: number,
    createdChildren: DocumentBlockRecord[],
  ): void {
    if (createdChildren.length === 0) {
      return;
    }

    const existingIds = new Set(blocks.map((block) => block.block_id));
    const childrenToInsert = createdChildren.filter(
      (child) => !existingIds.has(child.block_id),
    );

    if (childrenToInsert.length === 0) {
      return;
    }

    blocks.push(...childrenToInsert);

    const parentBlock = blocks.find((block) => block.block_id === parentId);
    if (!parentBlock) {
      return;
    }

    if (!parentBlock.children) {
      parentBlock.children = [];
    }

    parentBlock.children.splice(
      insertIndex,
      0,
      ...childrenToInsert.map((child) => child.block_id),
    );
  }

  /**
   * setTextContentForPatchBlock method 更新本地 block 状态中的文本内容.
   */
  private setTextContentForPatchBlock(
    block: DocumentBlockRecord,
    text: string,
  ): void {
    block.text = {
      elements: [
        {
          text_run: {
            content: text,
          },
        },
      ],
    };
  }

  /**
   * removeBlockFromState method 从本地 block 状态中移除块.
   */
  private removeBlockFromState(
    blocks: DocumentBlockRecord[],
    parentId: string,
    blockId: string,
  ): void {
    const blockIndex = blocks.findIndex((block) => block.block_id === blockId);
    if (blockIndex >= 0) {
      blocks.splice(blockIndex, 1);
    }

    const parentBlock = blocks.find((block) => block.block_id === parentId);
    if (!parentBlock?.children) {
      return;
    }

    parentBlock.children = parentBlock.children.filter((child) => child !== blockId);
  }

  /**
   * removeCreatedChildrenFromState method 从本地状态中移除一批新建子块.
   */
  private removeCreatedChildrenFromState(
    blocks: DocumentBlockRecord[],
    parentId: string,
    blockIds: string[],
  ): void {
    const blockIdSet = new Set(blockIds);

    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blockIdSet.has(blocks[index]!.block_id)) {
        blocks.splice(index, 1);
      }
    }

    const parentBlock = blocks.find((block) => block.block_id === parentId);
    if (!parentBlock?.children) {
      return;
    }

    parentBlock.children = parentBlock.children.filter(
      (child) => !blockIdSet.has(child),
    );
  }

  /**
   * resolveSiblingIndex method 获取目标块在父块中的子序号.
   */
  private resolveSiblingIndex(
    blocks: DocumentBlockRecord[],
    targetBlock: DocumentBlockRecord,
    parentId: string,
  ): number {
    const parentBlock = blocks.find((block) => block.block_id === parentId);
    if (parentBlock?.children?.length) {
      const index = parentBlock.children.indexOf(targetBlock.block_id);
      if (index >= 0) {
        return index;
      }
    }

    return blocks
      .filter((block) => block.parent_id === parentId)
      .findIndex((block) => block.block_id === targetBlock.block_id);
  }

  /**
   * extractTextContentForPatch method 提取用于占位符匹配的原始文本.
   */
  private extractTextContentForPatch(block: DocumentBlockRecord): string {
    const textKeys = [
      'text',
      'heading1',
      'heading2',
      'heading3',
      'bullet',
      'ordered',
      'code',
      'quote',
      'page',
    ] as const;

    for (const key of textKeys) {
      const value = block[key];
      if (value && typeof value === 'object') {
        const elements = (value as { elements?: Array<{ text_run?: { content?: string } }> })
          .elements;
        const text = this.extractTextFromElements(elements);
        if (text) {
          return text;
        }
      }
    }

    return '';
  }

  /**
   * updateTextBlock method 更新文本块文本内容.
   */
  private async updateTextBlock(
    accessToken: string,
    documentId: string,
    blockId: string,
    text: string,
  ): Promise<void> {
    const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}/blocks/${blockId}`;
    const response = await this.requestWithAuth<FeishuApiResponse>(
      url,
      accessToken,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          update_text_elements: {
            elements: [
              {
                text_run: {
                  content: text,
                },
              },
            ],
          },
        }),
      },
    );

    if (response.code !== 0) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `更新文本块失败: ${response.msg || '未知错误'}`,
      );
    }
  }

  /**
   * createBlocksAfterIndex method 创建一批子块.
   */
  private async createBlocksAfterIndex(
    accessToken: string,
    documentId: string,
    parentId: string,
    index: number,
    children: Array<Record<string, unknown>>,
  ): Promise<DocumentBlockRecord[]> {
    const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}/blocks/${parentId}/children`;
    const response = await this.requestWithAuth<
      FeishuApiResponse<{ children?: DocumentBlockRecord[] }>
    >(
      url,
      accessToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          index,
          children,
        }),
      },
    );

    if (response.code !== 0) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `创建文档块失败: ${response.msg || '未知错误'}`,
      );
    }

    return response.data?.children ?? [];
  }

  /**
   * resolveCreatedMediaBlockId method 从创建块响应中解析真实媒体块 ID.
   */
  private resolveCreatedMediaBlockId(
    createdBlock: DocumentBlockRecord | undefined,
    patch: FeishuDocumentMediaPatch,
  ): string {
    if (!createdBlock) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        '创建媒体块成功但未返回块信息',
      );
    }

    if (patch.type === 'image') {
      return createdBlock.block_id;
    }

    const fileBlockId = createdBlock.children?.find(
      (child): child is string => typeof child === 'string' && child.length > 0,
    );
    if (fileBlockId) {
      return fileBlockId;
    }

    if (createdBlock.block_type === 23) {
      return createdBlock.block_id;
    }

    throw new McpError(
      JsonRpcErrorCode.InternalError,
      '创建附件块成功但未返回 file block ID',
    );
  }

  /**
   * replaceMediaBlockToken method 将已上传媒体 token 写回文档块.
   */
  private async replaceMediaBlockToken(
    accessToken: string,
    documentId: string,
    blockId: string,
    type: 'image' | 'file',
    fileToken: string,
  ): Promise<void> {
    const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}/blocks/${blockId}`;
    const response = await this.requestWithAuth<FeishuApiResponse>(
      url,
      accessToken,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          type === 'image'
            ? {
                replace_image: {
                  token: fileToken,
                },
              }
            : {
                replace_file: {
                  token: fileToken,
                },
              },
        ),
      },
    );

    if (response.code !== 0) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `更新媒体块失败: ${response.msg || '未知错误'}`,
      );
    }
  }

  /**
   * deleteChildBlock method 删除父块下指定索引范围的子块.
   */
  private async deleteChildBlock(
    accessToken: string,
    documentId: string,
    parentId: string,
    startIndex: number,
    endIndex: number,
  ): Promise<void> {
    const url = `${FEISHU_CONFIG.BASE_URL}/docx/v1/documents/${documentId}/blocks/${parentId}/children/batch_delete`;
    const response = await this.requestWithAuth<FeishuApiResponse>(
      url,
      accessToken,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          start_index: startIndex,
          end_index: endIndex,
        }),
      },
    );

    if (response.code !== 0) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        `删除文档块失败: ${response.msg || '未知错误'}`,
      );
    }
  }

  /**
   * buildMediaChildBlock method 构造空图片或附件块请求体.
   */
  private buildMediaChildBlock(
    patch: FeishuDocumentMediaPatch,
  ): Record<string, unknown> {
    if (patch.type === 'image') {
      return {
        block_type: 27,
        image: {},
      };
    }

    return {
      block_type: 23,
      file: {
        token: '',
      },
    };
  }

  /**
   * buildTextChildBlock method 构造普通文本块请求体.
   */
  private buildTextChildBlock(text: string): Record<string, unknown> {
    return {
      block_type: 2,
      text: {
        elements: [
          {
            text_run: {
              content: text,
            },
          },
        ],
      },
    };
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
