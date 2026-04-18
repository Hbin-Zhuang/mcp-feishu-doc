/**
 * @fileoverview 飞书服务编排器.
 * 协调 API Provider、Markdown Processor 和 Rate Limiter 完成高层业务逻辑.
 * @module src/services/feishu/core/FeishuService
 */

import { inject, injectable } from 'tsyringe';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';
import { StorageService } from '@/container/tokens.js';
import {
  logger,
  requestContextService,
  type RequestContext,
} from '@/utils/index.js';
import type { StorageService as IStorageService } from '@/storage/core/StorageService.js';
import type {
  IFeishuApiProvider,
  IFeishuService,
  IMarkdownProcessor,
  IRateLimiter,
} from './IFeishuProvider.js';
import type {
  FeishuAuth,
  FeishuDocumentMediaPatch,
  FeishuDocumentMediaPatchResult,
  FeishuDocumentContent,
  FeishuFolder,
  FeishuUserInfo,
  FeishuWikiSpace,
  FeishuWikiNode,
  LocalFileInfo,
  MediaUploadFailure,
  MediaUploadFailureStatus,
  MarkdownDocument,
  StoredFeishuAuth,
  UploadConfig,
  UploadResult,
} from '../types.js';
import {
  DOC_MEDIA_UPLOAD_LIMITS,
  FEISHU_CONFIG,
  FILE_SIZE_LIMITS,
} from '../constants.js';

/**
 * FeishuService class 飞书服务编排器.
 * 实现 IFeishuService 接口，协调各个提供者完成业务逻辑.
 */
@injectable()
export class FeishuService implements IFeishuService {
  private readonly storage: IStorageService;
  private apiProvider: IFeishuApiProvider | null = null;
  private markdownProcessor: IMarkdownProcessor | null = null;
  private rateLimiter: IRateLimiter | null = null;

  // 性能优化 T606: 配置缓存
  private configCache: Map<string, { value: unknown; expiresAt: number }> =
    new Map();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 分钟缓存

  private readonly mediaPatchWarningMessage = '文档媒体回填失败';
  private readonly remoteMediaTempRoot = join(
    tmpdir(),
    'mcp-feishu-doc',
    'feishu-upload-remote',
  );

  constructor(@inject(StorageService) storage: IStorageService) {
    this.storage = storage;
  }

  /** createContext method 创建请求上下文. */
  private createContext(
    operation: string,
    tenantId = 'feishu-service',
  ): RequestContext {
    const context = requestContextService.createRequestContext({
      operation,
      tenantId,
    });
    logger.debug('创建请求上下文', context);
    return context;
  }

  /** setProviders method 设置服务提供者. */
  setProviders(
    apiProvider: IFeishuApiProvider,
    markdownProcessor: IMarkdownProcessor,
    rateLimiter: IRateLimiter,
  ): void {
    this.apiProvider = apiProvider;
    this.markdownProcessor = markdownProcessor;
    this.rateLimiter = rateLimiter;
  }

  /**
   * getCached method 从缓存获取值（性能优化 T606）.
   */
  private getCached<T>(key: string): T | null {
    const cached = this.configCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    if (cached) {
      this.configCache.delete(key);
    }
    return null;
  }

  /**
   * setCache method 设置缓存值（性能优化 T606）.
   */
  private setCache(key: string, value: unknown): void {
    this.configCache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * clearCache method 清除缓存.
   */
  public clearCache(): void {
    this.configCache.clear();
  }

  /** uploadMarkdown method 上传 Markdown 文档. */
  async uploadMarkdown(
    document: MarkdownDocument,
    config: UploadConfig,
  ): Promise<UploadResult> {
    this.ensureProviders();
    const ctx = this.createContext('feishu.uploadMarkdown');
    const tempFilesToCleanup = new Set<string>();

    const appId = config.appId || (await this.getDefaultAppId(ctx));
    if (!appId) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        '未配置应用 ID，请先完成 OAuth 认证或指定 appId',
      );
    }

    const auth = await this.getAuth(appId, ctx);
    if (!auth) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${appId} 未认证，请先完成 OAuth 认证`,
      );
    }

    const validAuth = await this.ensureValidToken(auth, ctx);
    const baseDirectory =
      document.workingDirectory ||
      (document.filePath
        ? this.getDirectoryFromPath(document.filePath)
        : process.cwd());

    const processResult = this.markdownProcessor!.process(
      document.content,
      baseDirectory,
      {
        removeFrontMatter: config.removeFrontMatter ?? true,
        processImages: config.uploadImages ?? true,
        downloadRemoteImages: config.downloadRemoteImages ?? false,
        processAttachments: config.uploadAttachments ?? true,
        downloadRemoteAttachments: config.downloadRemoteAttachments ?? false,
        codeBlockFilterLanguages: config.codeBlockFilterLanguages ?? [],
      },
    );

    const title = document.title || processResult.extractedTitle || 'Untitled';
    await this.rateLimiter!.throttle('document');

    const feishuDoc = await this.apiProvider!.createDocument(
      validAuth.accessToken,
      title,
      processResult.content,
      config.targetType,
      config.targetId,
      config.parentNodeToken,
    );

    try {
      const { result: mediaPatchResult, tempFiles } =
        await this.patchDocumentMediaPlaceholders(
          validAuth.accessToken,
          feishuDoc.documentId,
          processResult.localFiles,
          config,
          ctx,
        );
      tempFiles.forEach((file) => tempFilesToCleanup.add(file));

      // 获取文档实际的 revisionId 用于冲突检测
      let lastRevisionId: number | undefined;
      try {
        const meta = await this.apiProvider!.getDocumentMeta(
          validAuth.accessToken,
          feishuDoc.documentId,
        );
        lastRevisionId = meta.revisionId;
      } catch {
        // 非关键错误，忽略
      }

      await this.storeDocumentMeta(
        feishuDoc.documentId,
        {
          documentId: feishuDoc.documentId,
          url: feishuDoc.url,
          title,
          appId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastUploadedAt: Date.now(),
          lastRevisionId,
          targetType: config.targetType,
          ...(config.targetId ? { targetId: config.targetId } : {}),
          ...(config.parentNodeToken ? { parentNodeToken: config.parentNodeToken } : {}),
        },
        ctx,
      );

      logger.info('文档上传成功', ctx);
      return {
        success: true,
        documentId: feishuDoc.documentId,
        url: feishuDoc.url,
        title,
        uploadedFiles: mediaPatchResult.uploadedFiles,
        ...(mediaPatchResult.mediaUploadFailures.length > 0
          ? { mediaUploadFailures: mediaPatchResult.mediaUploadFailures }
          : {}),
      };
    } finally {
      await this.cleanupRemoteUploadTempFiles(tempFilesToCleanup, ctx);
    }
  }

  /** updateDocument method 更新文档（删除旧文档并在原位置重建）. */
  async updateDocument(
    documentId: string,
    document: MarkdownDocument,
    config: UploadConfig,
    force = false,
  ): Promise<UploadResult> {
    this.ensureProviders();
    const ctx = this.createContext('feishu.updateDocument');
    const tempFilesToCleanup = new Set<string>();

    const appId = config.appId || (await this.getDefaultAppId(ctx));
    if (!appId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(appId, ctx);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${appId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, ctx);

    if (!force) {
      const conflict = await this.checkConflict(
        validAuth.accessToken,
        documentId,
        ctx,
      );
      if (conflict) {
        return {
          success: false,
          documentId,
          error:
            '检测到文档冲突：文档在上次上传后已被修改（revision_id 不匹配）。使用 force=true 强制覆盖。',
          conflictDetected: true,
        };
      }
    }

    // 从存储中读取文档的原始位置信息
    const storedMeta = await this.storage.get<{
      title?: string;
      targetType?: 'drive' | 'wiki';
      targetId?: string;
      parentNodeToken?: string;
    }>(`feishu/doc/${documentId}`, ctx);

    const baseDirectory =
      document.workingDirectory ||
      (document.filePath
        ? this.getDirectoryFromPath(document.filePath)
        : process.cwd());

    const processResult = this.markdownProcessor!.process(
      document.content,
      baseDirectory,
      {
        removeFrontMatter: config.removeFrontMatter ?? true,
        processImages: config.uploadImages ?? true,
        downloadRemoteImages: config.downloadRemoteImages ?? false,
        processAttachments: config.uploadAttachments ?? true,
        downloadRemoteAttachments: config.downloadRemoteAttachments ?? false,
        codeBlockFilterLanguages: config.codeBlockFilterLanguages ?? [],
      },
    );

    const title =
      document.title || processResult.extractedTitle || storedMeta?.title || 'Untitled';

    // 使用存储的位置信息（优先级：调用参数 > 存储元数据）
    const targetType = config.targetType || storedMeta?.targetType || 'drive';
    const targetId = config.targetId || storedMeta?.targetId;
    const parentNodeToken =
      config.parentNodeToken || storedMeta?.parentNodeToken;

    await this.rateLimiter!.throttle('document');

    const feishuDoc = await this.apiProvider!.updateDocument(
      validAuth.accessToken,
      documentId,
      processResult.content,
      title,
      targetType,
      targetId,
      parentNodeToken,
    );

    try {
      const { result: mediaPatchResult, tempFiles } =
        await this.patchDocumentMediaPlaceholders(
          validAuth.accessToken,
          feishuDoc.documentId,
          processResult.localFiles,
          config,
          ctx,
        );
      tempFiles.forEach((file) => tempFilesToCleanup.add(file));

      // 获取新文档的 revisionId
      let lastRevisionId: number | undefined;
      try {
        const meta = await this.apiProvider!.getDocumentMeta(
          validAuth.accessToken,
          feishuDoc.documentId,
        );
        lastRevisionId = meta.revisionId;
      } catch {
        // 非关键错误，忽略
      }

      await this.updateDocumentMeta(
        feishuDoc.documentId,
        {
          documentId: feishuDoc.documentId,
          url: feishuDoc.url,
          title,
          updatedAt: Date.now(),
          lastUploadedAt: Date.now(),
          lastRevisionId,
          targetType,
          ...(targetId ? { targetId } : {}),
          ...(parentNodeToken ? { parentNodeToken } : {}),
        },
        ctx,
      );

      return {
        success: true,
        documentId: feishuDoc.documentId,
        url: feishuDoc.url,
        title,
        uploadedFiles: mediaPatchResult.uploadedFiles,
        ...(mediaPatchResult.mediaUploadFailures.length > 0
          ? { mediaUploadFailures: mediaPatchResult.mediaUploadFailures }
          : {}),
      };
    } finally {
      await this.cleanupRemoteUploadTempFiles(tempFilesToCleanup, ctx);
    }
  }

  /** getAuthUrl method 获取授权 URL. */
  async getAuthUrl(
    appId?: string,
    redirectUri?: string,
  ): Promise<{ authUrl: string; state: string }> {
    this.ensureProviders();
    const ctx = this.createContext('feishu.getAuthUrl');

    const finalAppId = appId || FEISHU_CONFIG.DEFAULT_APP_ID;
    const finalRedirectUri = redirectUri || FEISHU_CONFIG.OAUTH_CALLBACK_URL;
    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const result = this.apiProvider!.generateAuthUrl(
      finalAppId,
      finalRedirectUri,
    );

    // 存储state用于后续验证
    const stateKey = `feishu/state/${result.state}`;
    logger.info(`存储 state: ${stateKey}`, ctx);

    await this.storage.set(
      stateKey,
      result.state,
      ctx,
      { ttl: 10 * 60 * 1000 }, // 10分钟过期
    );

    // 立即验证存储是否成功
    const verifyState = await this.storage.get<string>(stateKey, ctx);
    logger.info(`验证 state 存储: ${stateKey}, 读取到: ${verifyState}`, ctx);

    logger.info(`State 存储成功: ${result.state}`, ctx);

    return result;
  }

  /** handleAuthCallback method 处理授权回调. */
  async handleAuthCallback(
    code: string,
    state: string,
    appId?: string,
  ): Promise<{
    success: boolean;
    userInfo?: FeishuUserInfo;
    expiresAt?: number;
  }> {
    this.ensureProviders();
    const ctx = this.createContext('feishu.handleAuthCallback');

    const finalAppId = appId || FEISHU_CONFIG.DEFAULT_APP_ID;
    const appSecret = await this.getAppSecret(finalAppId, ctx);
    if (!finalAppId || !appSecret)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '应用配置不完整');

    const savedState = await this.storage.get<string>(
      `feishu/state/${state}`,
      ctx,
    );
    logger.info(`查找 state: feishu/state/${state}, 找到: ${savedState}`, ctx);
    if (!savedState)
      throw new McpError(JsonRpcErrorCode.InvalidParams, 'state 验证失败');

    const auth = await this.apiProvider!.exchangeCodeForToken(
      code,
      finalAppId,
      appSecret,
      FEISHU_CONFIG.OAUTH_CALLBACK_URL,
    );
    const userInfo = await this.apiProvider!.getUserInfo(auth.accessToken);

    await this.storeAuth(finalAppId, { ...auth, userInfo }, ctx);
    await this.storage.delete(`feishu/state/${state}`, ctx);

    // 检查是否只有一个应用，如果是则自动设置为默认应用
    const apps = await this.listApps(ctx);
    if (apps.length === 1) {
      logger.info('检测到只有一个应用，自动设置为默认应用', {
        ...ctx,
        appId: finalAppId,
      });
      await this.setDefaultApp(ctx, finalAppId);
    }

    logger.info('OAuth 认证成功', ctx);
    return { success: true, userInfo, expiresAt: auth.expiresAt };
  }

  /** listFolders method 列出文件夹. */
  async listFolders(
    context: RequestContext,
    parentId?: string,
    appId?: string,
  ): Promise<FeishuFolder[]> {
    this.ensureProviders();

    const finalAppId = appId || (await this.getDefaultAppId(context));
    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(finalAppId, context);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, context);
    await this.rateLimiter!.throttle('document');
    return this.apiProvider!.listFolders(validAuth.accessToken, parentId);
  }

  /** listWikis method 列出知识库. */
  async listWikis(
    context: RequestContext,
    appId?: string,
  ): Promise<FeishuWikiSpace[]> {
    this.ensureProviders();

    const finalAppId = appId || (await this.getDefaultAppId(context));
    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(finalAppId, context);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, context);
    await this.rateLimiter!.throttle('document');
    return this.apiProvider!.listWikis(validAuth.accessToken);
  }

  /** getUserInfo method 获取用户信息. */
  async getUserInfo(
    context: RequestContext,
    appId?: string,
  ): Promise<FeishuUserInfo>;
  async getUserInfo(appId?: string): Promise<FeishuUserInfo>;
  async getUserInfo(
    contextOrAppId?: RequestContext | string,
    appId?: string,
  ): Promise<FeishuUserInfo> {
    this.ensureProviders();

    let context: RequestContext;
    let finalAppId: string | undefined;

    // 判断第一个参数是上下文还是 appId
    if (typeof contextOrAppId === 'string' || contextOrAppId === undefined) {
      // 第一个参数是 appId 或 undefined
      context = this.createContext('feishu.getUserInfo');
      finalAppId = contextOrAppId;
    } else {
      // 第一个参数是 RequestContext
      context = contextOrAppId;
      finalAppId = appId;
    }

    // 如果没有提供 appId，尝试获取默认应用 ID
    if (!finalAppId) {
      const defaultAppId = await this.getDefaultAppId(context);
      finalAppId = defaultAppId || undefined;
    }

    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(finalAppId, context);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, context);
    return this.apiProvider!.getUserInfo(validAuth.accessToken);
  }

  /**
   * hasValidAuth method 检查是否有有效的认证.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @returns 是否有有效认证
   */
  async hasValidAuth(
    context: RequestContext,
    appId?: string,
  ): Promise<boolean> {
    try {
      const finalAppId = appId || (await this.getDefaultAppId(context));
      if (!finalAppId) return false;

      const auth = await this.getAuth(finalAppId, context);
      if (!auth) return false;

      // 检查 token 是否即将过期（5分钟内）
      if (auth.expiresAt - Date.now() < 5 * 60 * 1000) {
        // 尝试刷新 token
        try {
          await this.ensureValidToken(auth, context);
          return true;
        } catch {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * listApps method 列出已配置的应用.
   * @param context 请求上下文
   * @returns 应用列表
   */
  async listApps(context: RequestContext): Promise<
    Array<{
      appId: string;
      isDefault: boolean;
      hasToken: boolean;
      userInfo?: FeishuUserInfo;
    }>
  > {
    const apps: Array<{
      appId: string;
      isDefault: boolean;
      hasToken: boolean;
      userInfo?: FeishuUserInfo;
    }> = [];

    // 获取默认应用 ID
    const defaultAppId = await this.getDefaultAppId(context);

    // 获取所有认证信息
    const authKeys = await this.storage.list('feishu/auth/', context);
    for (const key of authKeys.keys) {
      const appId = key.replace('feishu/auth/', '');
      const auth = await this.getAuth(appId, context);

      apps.push({
        appId,
        isDefault: appId === defaultAppId,
        hasToken: !!auth,
        ...(auth?.userInfo ? { userInfo: auth.userInfo } : {}),
      });
    }

    return apps;
  }

  /**
   * setDefaultApp method 设置默认应用.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @returns 设置结果
   */
  async setDefaultApp(
    context: RequestContext,
    appId: string,
  ): Promise<{ success: boolean; appId: string }> {
    // 验证应用是否已认证
    const auth = await this.getAuth(appId, context);
    if (!auth) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${appId} 未认证，请先完成 OAuth 认证`,
      );
    }

    // 设置为默认应用
    await this.storage.set('feishu/config/default_app', appId, context);

    // 更新缓存
    this.setCache('feishu/config/default_app', appId);

    return { success: true, appId };
  }

  /**
   * getWikiNodes method 获取知识库节点.
   * @param context 请求上下文
   * @param wikiId 知识库 ID
   * @param parentNodeToken 父节点 token
   * @param appId 应用 ID
   * @returns 节点列表
   */
  async getWikiNodes(
    _context: RequestContext,
    wikiId: string,
    parentNodeToken?: string,
    appId?: string,
  ): Promise<FeishuWikiNode[]> {
    this.ensureProviders();

    const finalAppId = appId || (await this.getDefaultAppId(_context));
    if (!finalAppId) {
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');
    }

    const auth = await this.getAuth(finalAppId, _context);
    if (!auth) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );
    }

    const validAuth = await this.ensureValidToken(auth, _context);
    await this.rateLimiter!.throttle('wiki');

    return this.apiProvider!.getWikiNodes(
      validAuth.accessToken,
      wikiId,
      parentNodeToken,
    );
  }

  /**
   * getDocumentContent method 读取飞书文档文本内容.
   */
  async getDocumentContent(
    context: RequestContext,
    documentId: string,
    appId?: string,
  ): Promise<FeishuDocumentContent> {
    this.ensureProviders();

    const finalAppId = appId || (await this.getDefaultAppId(context));
    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(finalAppId, context);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, context);
    await this.rateLimiter!.throttle('block');
    return this.apiProvider!.getDocumentContent(
      validAuth.accessToken,
      documentId,
    );
  }

  /**
   * searchDocuments method 搜索文档.
   */
  async searchDocuments(
    context: RequestContext,
    query: string,
    count = 20,
    appId?: string,
  ): Promise<
    Array<{
      token: string;
      name: string;
      url: string;
      type: string;
      ownerName: string;
    }>
  > {
    this.ensureProviders();

    const finalAppId = appId || (await this.getDefaultAppId(context));
    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(finalAppId, context);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, context);
    await this.rateLimiter!.throttle('document');
    return this.apiProvider!.searchDocuments(
      validAuth.accessToken,
      query,
      count,
    );
  }

  /**
   * deleteDocumentFile method 删除飞书文档.
   */
  async deleteDocumentFile(
    context: RequestContext,
    documentId: string,
    appId?: string,
  ): Promise<void> {
    this.ensureProviders();

    const finalAppId = appId || (await this.getDefaultAppId(context));
    if (!finalAppId)
      throw new McpError(JsonRpcErrorCode.InvalidParams, '未配置应用 ID');

    const auth = await this.getAuth(finalAppId, context);
    if (!auth)
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        `应用 ${finalAppId} 未认证`,
      );

    const validAuth = await this.ensureValidToken(auth, context);
    await this.rateLimiter!.throttle('document');
    await this.apiProvider!.deleteDocument(validAuth.accessToken, documentId, 'docx');

    // 清除本地存储的文档元数据
    try {
      await this.storage.delete(`feishu/doc/${documentId}`, context);
    } catch {
      // 非关键错误，忽略
    }
  }

  /**
   * addApp method 添加/配置新的飞书应用（存储 appId + appSecret 到 Storage）.
   */
  async addApp(
    context: RequestContext,
    appId: string,
    appSecret: string,
  ): Promise<{ success: boolean; appId: string }> {
    if (!appId || !appSecret) {
      throw new McpError(
        JsonRpcErrorCode.InvalidParams,
        'appId 和 appSecret 均不能为空',
      );
    }

    // 存储应用配置（appSecret 以供 token 刷新时使用）
    const configKey = `feishu/config/app/${appId}`;
    await this.storage.set(configKey, { appSecret }, context);
    this.setCache(configKey, { appSecret });

    // 维护应用列表（若尚未添加）
    const appListKey = 'feishu/config/app_list';
    const existingApps =
      (await this.storage.get<string[]>(appListKey, context)) ?? [];
    if (!existingApps.includes(appId)) {
      existingApps.push(appId);
      await this.storage.set(appListKey, existingApps, context);
      this.setCache(appListKey, existingApps);
    }

    logger.info('飞书应用配置已保存', { ...context, appId });
    return { success: true, appId };
  }

  /**
   * batchUploadMarkdown method 批量上传 Markdown 文档.
   * @param config 批量上传配置
   * @param context 请求上下文
   * @returns 批量上传结果
   */
  async batchUploadMarkdown(
    config: {
      documents: Array<{
        filePath?: string;
        content?: string;
        targetType: 'drive' | 'wiki';
        targetId?: string;
        uploadImages?: boolean;
        uploadAttachments?: boolean;
        removeFrontMatter?: boolean;
      }>;
      concurrency?: number;
      uploadImages?: boolean;
      uploadAttachments?: boolean;
      removeFrontMatter?: boolean;
      appId?: string;
    },
    context: RequestContext,
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
      documentId?: string;
      url?: string;
      title?: string;
      error?: string;
    }>;
  }> {
    const concurrency = config.concurrency || 3;
    const results: Array<{
      documentId?: string;
      url?: string;
      title?: string;
      error?: string;
    }> = [];

    // 使用 Set 来管理并发 Promise，避免 lint 错误
    const runningTasks = new Set<Promise<void>>();

    for (const doc of config.documents) {
      // 等待直到有空闲的并发槽位
      while (runningTasks.size >= concurrency) {
        await Promise.race(runningTasks);
      }

      // 创建上传任务
      const task = this.uploadSingleDocument(doc, config, context)
        .then((result) => {
          results.push(result);
        })
        .finally(() => {
          runningTasks.delete(task);
        });

      runningTasks.add(task);
    }

    // 等待所有任务完成
    await Promise.all(runningTasks);

    const succeeded = results.filter((r) => r.documentId).length;
    const failed = results.length - succeeded;

    return {
      total: config.documents.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * uploadSingleDocument method 上传单个文档（批量上传的辅助方法）.
   */
  private async uploadSingleDocument(
    doc: {
      filePath?: string;
      content?: string;
      targetType: 'drive' | 'wiki';
      targetId?: string;
      uploadImages?: boolean;
      uploadAttachments?: boolean;
      removeFrontMatter?: boolean;
    },
    batchConfig: {
      uploadImages?: boolean;
      uploadAttachments?: boolean;
      removeFrontMatter?: boolean;
      appId?: string;
    },
    _context: RequestContext,
  ): Promise<{
    documentId?: string;
    url?: string;
    title?: string;
    error?: string;
  }> {
    try {
      // 读取文档内容
      let content: string;
      if (doc.content) {
        content = doc.content;
      } else if (doc.filePath) {
        const fs = await import('node:fs');
        content = fs.readFileSync(doc.filePath, 'utf-8');
      } else {
        throw new Error('必须提供 content 或 filePath');
      }

      // 构建文档对象
      const document: MarkdownDocument = {
        title: '', // 临时标题，会在处理时提取
        content,
        ...(doc.filePath ? { filePath: doc.filePath } : {}),
        ...(doc.filePath
          ? { workingDirectory: this.getDirectoryFromPath(doc.filePath) }
          : {}),
      };

      // 构建上传配置
      const uploadConfig: UploadConfig = {
        targetType: doc.targetType,
        uploadImages: doc.uploadImages ?? batchConfig.uploadImages ?? true,
        uploadAttachments:
          doc.uploadAttachments ?? batchConfig.uploadAttachments ?? true,
        removeFrontMatter:
          doc.removeFrontMatter ?? batchConfig.removeFrontMatter ?? true,
        ...(doc.targetId ? { targetId: doc.targetId } : {}),
        ...(batchConfig.appId ? { appId: batchConfig.appId } : {}),
      };

      // 上传文档
      const result = await this.uploadMarkdown(document, uploadConfig);

      return {
        ...(result.documentId ? { documentId: result.documentId } : {}),
        ...(result.url ? { url: result.url } : {}),
        ...(result.title ? { title: result.title } : {}),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private ensureProviders(): void {
    if (!this.apiProvider || !this.markdownProcessor || !this.rateLimiter) {
      throw new McpError(JsonRpcErrorCode.InternalError, '服务提供者未初始化');
    }
  }

  private async getDefaultAppId(ctx: RequestContext): Promise<string | null> {
    // 尝试从缓存获取（性能优化 T606）
    const cacheKey = 'feishu/config/default_app';
    const cached = this.getCached<string>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const value = await this.storage.get<string>(
      'feishu/config/default_app',
      ctx,
    );
    if (value) {
      this.setCache(cacheKey, value);
    }
    return value;
  }

  private async getAuth(
    appId: string,
    ctx: RequestContext,
  ): Promise<StoredFeishuAuth | null> {
    // 尝试从缓存获取（性能优化 T606）
    const cacheKey = `feishu/auth/${appId}`;
    const cached = this.getCached<StoredFeishuAuth>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const value = await this.storage.get<StoredFeishuAuth>(
      `feishu/auth/${appId}`,
      ctx,
    );
    if (value) {
      this.setCache(cacheKey, value);
    }
    return value;
  }

  private async storeAuth(
    appId: string,
    auth: FeishuAuth & { userInfo?: FeishuUserInfo },
    ctx: RequestContext,
  ): Promise<void> {
    const storedAuth: StoredFeishuAuth = {
      appId,
      appSecret: '',
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresAt: auth.expiresAt,
      userInfo: auth.userInfo,
    };
    await this.storage.set(`feishu/auth/${appId}`, storedAuth, ctx);
    // 更新缓存（性能优化 T606）
    this.setCache(`feishu/auth/${appId}`, storedAuth);

    // 维护应用列表
    const appListKey = 'feishu/config/app_list';
    const existingApps =
      (await this.storage.get<string[]>(appListKey, ctx)) ?? [];
    if (!existingApps.includes(appId)) {
      existingApps.push(appId);
      await this.storage.set(appListKey, existingApps, ctx);
      // 更新缓存
      this.setCache(appListKey, existingApps);
    }
  }

  private async getAppSecret(
    appId: string,
    ctx: RequestContext,
  ): Promise<string | null> {
    // 尝试从缓存获取（性能优化 T606）
    const cacheKey = `feishu/config/app/${appId}`;
    const cached = this.getCached<{ appSecret?: string }>(cacheKey);
    if (cached !== null) {
      return cached.appSecret || null;
    }

    const config = await this.storage.get<{ appSecret?: string }>(
      cacheKey,
      ctx,
    );
    if (config) {
      this.setCache(cacheKey, config);
      return config.appSecret || null;
    }

    // 如果存储中没有，回退到环境变量（用于默认应用）
    if (
      appId === FEISHU_CONFIG.DEFAULT_APP_ID &&
      FEISHU_CONFIG.DEFAULT_APP_SECRET
    ) {
      return FEISHU_CONFIG.DEFAULT_APP_SECRET;
    }

    return null;
  }

  private async ensureValidToken(
    auth: StoredFeishuAuth,
    ctx: RequestContext,
  ): Promise<StoredFeishuAuth> {
    if (auth.expiresAt - Date.now() < 5 * 60 * 1000) {
      logger.info('刷新访问令牌', ctx);
      const appSecret = await this.getAppSecret(auth.appId, ctx);
      if (!appSecret)
        throw new McpError(JsonRpcErrorCode.InternalError, '无法获取应用密钥');

      const newAuth = await this.apiProvider!.refreshToken(
        auth.refreshToken,
        auth.appId,
        appSecret,
      );
      const updatedAuth: StoredFeishuAuth = {
        ...auth,
        accessToken: newAuth.accessToken,
        refreshToken: newAuth.refreshToken,
        expiresAt: newAuth.expiresAt,
      };
      await this.storage.set(`feishu/auth/${auth.appId}`, updatedAuth, ctx);
      // 更新缓存（性能优化 T606）
      this.setCache(`feishu/auth/${auth.appId}`, updatedAuth);
      return updatedAuth;
    }
    return auth;
  }

  private async checkConflict(
    accessToken: string,
    documentId: string,
    ctx: RequestContext,
  ): Promise<boolean> {
    const storedMeta = await this.storage.get<{ lastRevisionId?: number; lastUploadedAt: number }>(
      `feishu/doc/${documentId}`,
      ctx,
    );
    if (!storedMeta) return false;
    const docMeta = await this.apiProvider!.getDocumentMeta(
      accessToken,
      documentId,
    );
    // 优先使用 revisionId 比对（更准确）；若旧数据无 revisionId 则回退到时间戳比对
    if (storedMeta.lastRevisionId !== undefined) {
      return docMeta.revisionId > storedMeta.lastRevisionId;
    }
    return docMeta.updatedAt > storedMeta.lastUploadedAt;
  }

  private async storeDocumentMeta(
    documentId: string,
    meta: Record<string, unknown>,
    ctx: RequestContext,
  ): Promise<void> {
    await this.storage.set(`feishu/doc/${documentId}`, meta, ctx);
  }

  private async updateDocumentMeta(
    documentId: string,
    updates: Record<string, unknown>,
    ctx: RequestContext,
  ): Promise<void> {
    const existing = await this.storage.get<Record<string, unknown>>(
      `feishu/doc/${documentId}`,
      ctx,
    );
    if (existing)
      await this.storage.set(
        `feishu/doc/${documentId}`,
        { ...existing, ...updates },
        ctx,
      );
  }

  private async patchDocumentMediaPlaceholders(
    accessToken: string,
    documentId: string,
    localFiles: LocalFileInfo[],
    config: UploadConfig,
    ctx: RequestContext,
  ): Promise<{
    result: FeishuDocumentMediaPatchResult;
    tempFiles: string[];
  }> {
    const apiProvider = this.apiProvider;
    if (!apiProvider) {
      throw new McpError(
        JsonRpcErrorCode.InternalError,
        '服务提供者未初始化',
      );
    }

    const { patches, failures, tempFiles } = await this.buildMediaPatches(
      localFiles,
      config,
    );
    if (patches.length === 0) {
      return {
        result: {
          uploadedFiles: [],
          mediaUploadFailures: failures,
        },
        tempFiles,
      };
    }

    try {
      const patchResult = await apiProvider.replaceDocumentPlaceholdersWithMedia(
        accessToken,
        documentId,
        patches,
      );

      return {
        result: {
          uploadedFiles: patchResult.uploadedFiles,
          mediaUploadFailures: [...failures, ...patchResult.mediaUploadFailures],
        },
        tempFiles,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : this.mediaPatchWarningMessage;
      logger.warning(this.mediaPatchWarningMessage, {
        ...ctx,
        documentId,
        patchCount: patches.length,
        error: message,
      });

      return {
        result: {
          uploadedFiles: [],
          mediaUploadFailures: [
            ...failures,
            ...patches.map((patch) => ({
              originalPath: patch.originalPath,
              fileName: patch.fileName,
              isImage: patch.type === 'image',
              error: message,
              status: 'upload_failed' as const,
            })),
          ],
        },
        tempFiles,
      };
    }
  }

  private async buildMediaPatches(
    localFiles: LocalFileInfo[],
    config: UploadConfig,
  ): Promise<{
    patches: FeishuDocumentMediaPatch[];
    failures: MediaUploadFailure[];
    tempFiles: string[];
  }> {
    const patches: FeishuDocumentMediaPatch[] = [];
    const failures: MediaUploadFailure[] = [];
    const tempFiles = new Set<string>();
    let accumulatedBytes = 0;
    const candidates = localFiles.filter((file) => {
      if (file.isImage && config.uploadImages === false) {
        return false;
      }
      if (!file.isImage && config.uploadAttachments === false) {
        return false;
      }
      return true;
    });

    const acceptedCandidates = candidates.slice(
      0,
      DOC_MEDIA_UPLOAD_LIMITS.maxMediaCount,
    );
    for (const skippedFile of candidates.slice(DOC_MEDIA_UPLOAD_LIMITS.maxMediaCount)) {
      failures.push({
        originalPath: skippedFile.originalPath,
        fileName: skippedFile.fileName,
        isImage: skippedFile.isImage,
        error: '媒体数量超过单篇文档上传上限',
        status: 'skipped_over_limit',
      });
    }

    const resolvedSources = await this.mapWithConcurrencyLimit(
      acceptedCandidates,
      DOC_MEDIA_UPLOAD_LIMITS.remoteDownloadConcurrency,
      async (file) => ({
        file,
        resolved: await this.resolveUploadMediaSource(file),
      }),
    );

    for (const { file, resolved } of resolvedSources) {
      if (!resolved.success) {
        failures.push({
          originalPath: file.originalPath,
          fileName: file.fileName,
          isImage: file.isImage,
          error: resolved.error,
          status: resolved.status,
        });
        continue;
      }

      if (resolved.tempFilePath) {
        tempFiles.add(resolved.tempFilePath);
      }

      const byteLength = resolved.byteLength;
      const singleFileLimit = file.isImage
        ? FILE_SIZE_LIMITS.image
        : FILE_SIZE_LIMITS.file;

      if (byteLength > singleFileLimit) {
        failures.push({
          originalPath: file.originalPath,
          fileName: file.fileName,
          isImage: file.isImage,
          error: '媒体文件超过单文件上传大小限制',
          status: 'skipped_too_large',
        });
        continue;
      }

      if (
        accumulatedBytes + byteLength > DOC_MEDIA_UPLOAD_LIMITS.maxTotalBytes
      ) {
        failures.push({
          originalPath: file.originalPath,
          fileName: file.fileName,
          isImage: file.isImage,
          error: '媒体总大小超过单篇文档上传限制',
          status: 'skipped_over_limit',
        });
        continue;
      }

      patches.push({
        originalPath: file.originalPath,
        resolvedPath: resolved.resolvedPath,
        placeholder: file.placeholder,
        type: file.isImage ? 'image' : 'file',
        fileName: file.fileName,
      });
      accumulatedBytes += byteLength;
    }

    return { patches, failures, tempFiles: [...tempFiles] };
  }

  private async resolveUploadMediaSource(
    file: LocalFileInfo,
  ): Promise<
    | {
        success: true;
        resolvedPath: string;
        byteLength: number;
        tempFilePath?: string;
      }
    | {
        success: false;
        status: MediaUploadFailureStatus;
        error: string;
      }
  > {
    if (file.sourceType === 'remote' && file.remoteUrl) {
      try {
        const { resolvedPath, shouldCleanup } = await this.downloadRemoteMediaToTemp(
          file.remoteUrl,
          file.fileName,
        );
        const fileStat = await stat(resolvedPath);

        return {
          success: true,
          resolvedPath,
          byteLength: fileStat.size,
          ...(shouldCleanup ? { tempFilePath: resolvedPath } : {}),
        };
      } catch (error) {
        return {
          success: false,
          status: 'upload_failed',
          error:
            error instanceof Error
              ? error.message
              : '下载远程媒体失败',
        };
      }
    }

    if (!existsSync(file.originalPath)) {
      return {
        success: false,
        status: 'file_missing',
        error: '本地媒体文件不存在',
      };
    }

    const fileStat = await stat(file.originalPath);
    return {
      success: true,
      resolvedPath: file.originalPath,
      byteLength: fileStat.size,
    };
  }

  private async downloadRemoteMediaToTemp(
    remoteUrl: string,
    fileName: string,
  ): Promise<{ resolvedPath: string; shouldCleanup: boolean }> {
    await mkdir(this.remoteMediaTempRoot, { recursive: true });
    await this.cleanupExpiredRemoteUploadTempArtifacts();
    const fileExtension = extname(fileName) || '.bin';
    const safeBaseName =
      basename(fileName, fileExtension).replace(/[^a-zA-Z0-9._-]/g, '_') ||
      'remote-file';
    const cacheKey = createHash('sha1').update(remoteUrl).digest('hex');
    const tempPath = join(
      this.remoteMediaTempRoot,
      `${cacheKey}-${safeBaseName}${fileExtension}`,
    );

    if (existsSync(tempPath)) {
      return {
        resolvedPath: tempPath,
        shouldCleanup: false,
      };
    }

    const response = await fetch(remoteUrl);
    if (!response.ok || !response.body) {
      throw new Error(`下载远程媒体失败: ${response.status} ${response.statusText}`);
    }

    const readable = Readable.fromWeb(
      response.body as unknown as import('node:stream/web').ReadableStream,
    );
    const writable = createWriteStream(tempPath);

    await new Promise<void>((resolve, reject) => {
      readable.on('error', reject);
      writable.on('error', reject);
      writable.on('finish', () => resolve());
      readable.pipe(writable);
    });

    return {
      resolvedPath: tempPath,
      shouldCleanup: true,
    };
  }

  private async cleanupRemoteUploadTempFiles(
    tempFiles: Iterable<string>,
    ctx: RequestContext,
  ): Promise<void> {
    const targets = [...new Set([...tempFiles].filter(Boolean))];
    if (targets.length === 0) {
      return;
    }

    await Promise.all(
      targets.map(async (tempFile) => {
        try {
          await rm(tempFile, { force: true });
        } catch (error) {
          logger.warning('清理远程上传临时文件失败', {
            ...ctx,
            tempFile,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }

  private async cleanupExpiredRemoteUploadTempArtifacts(): Promise<void> {
    try {
      if (!existsSync(this.remoteMediaTempRoot)) {
        return;
      }

      const entries = await readdir(this.remoteMediaTempRoot, {
        withFileTypes: true,
      });
      const now = Date.now();

      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isFile()) {
            return;
          }

          const filePath = join(this.remoteMediaTempRoot, entry.name);
          const fileStat = await stat(filePath);
          if (
            now - fileStat.mtimeMs >
            DOC_MEDIA_UPLOAD_LIMITS.tempFileTtlMs
          ) {
            await rm(filePath, { force: true });
          }
        }),
      );
    } catch (error) {
      const ctx = requestContextService.createRequestContext({
        operation: 'feishu.cleanupRemoteUploadTempArtifacts',
        tenantId: 'feishu-service',
      });
      logger.warning('清理远程上传过期临时文件失败', {
        ...ctx,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

  private getDirectoryFromPath(filePath: string): string {
    const lastSlash = Math.max(
      filePath.lastIndexOf('/'),
      filePath.lastIndexOf('\\'),
    );
    return lastSlash > 0 ? filePath.substring(0, lastSlash) : process.cwd();
  }
}
