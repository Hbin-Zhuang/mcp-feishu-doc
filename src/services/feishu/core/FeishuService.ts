/**
 * @fileoverview 飞书服务编排器.
 * 协调 API Provider、Markdown Processor 和 Rate Limiter 完成高层业务逻辑.
 * @module src/services/feishu/core/FeishuService
 */

import { inject, injectable } from 'tsyringe';
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
  FeishuFolder,
  FeishuUserInfo,
  FeishuWikiSpace,
  FeishuWikiNode,
  LocalFileInfo,
  MarkdownDocument,
  StoredFeishuAuth,
  UploadConfig,
  UploadedFile,
  UploadResult,
} from '../types.js';
import { FEISHU_CONFIG } from '../constants.js';

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
        processAttachments: config.uploadAttachments ?? true,
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

    const uploadedFiles = await this.uploadLocalFiles(
      validAuth.accessToken,
      processResult.localFiles,
      config,
    );

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
      },
      ctx,
    );

    logger.info('文档上传成功', ctx);
    return {
      success: true,
      documentId: feishuDoc.documentId,
      url: feishuDoc.url,
      title,
      uploadedFiles,
    };
  }

  /** updateDocument method 更新文档. */
  async updateDocument(
    documentId: string,
    document: MarkdownDocument,
    config: UploadConfig,
    force = false,
  ): Promise<UploadResult> {
    this.ensureProviders();
    const ctx = this.createContext('feishu.updateDocument');

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
            '检测到文档冲突：文档在上次上传后已被修改。使用 force=true 强制覆盖。',
          conflictDetected: true,
        };
      }
    }

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
        processAttachments: config.uploadAttachments ?? true,
        codeBlockFilterLanguages: config.codeBlockFilterLanguages ?? [],
      },
    );

    await this.rateLimiter!.throttle('document');
    const feishuDoc = await this.apiProvider!.updateDocument(
      validAuth.accessToken,
      documentId,
      processResult.content,
    );
    await this.updateDocumentMeta(
      documentId,
      { updatedAt: Date.now(), lastUploadedAt: Date.now() },
      ctx,
    );

    return {
      success: true,
      documentId: feishuDoc.documentId,
      url: feishuDoc.url,
      title: feishuDoc.title,
    };
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
    const storedMeta = await this.storage.get<{ lastUploadedAt: number }>(
      `feishu/doc/${documentId}`,
      ctx,
    );
    if (!storedMeta) return false;
    const docMeta = await this.apiProvider!.getDocumentMeta(
      accessToken,
      documentId,
    );
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

  private async uploadLocalFiles(
    accessToken: string,
    localFiles: LocalFileInfo[],
    config: UploadConfig,
  ): Promise<UploadedFile[]> {
    const uploadedFiles: UploadedFile[] = [];
    const ctx = this.createContext('feishu.uploadLocalFiles');

    for (const file of localFiles) {
      if (file.isImage && !config.uploadImages) continue;
      if (!file.isImage && !config.uploadAttachments) continue;

      try {
        await this.rateLimiter!.throttle('upload');
        const fileKey = await this.apiProvider!.uploadFile(
          accessToken,
          file.originalPath,
          file.isImage ? 'image' : 'file',
        );
        uploadedFiles.push({
          originalPath: file.originalPath,
          fileName: file.fileName,
          fileKey,
          isImage: file.isImage,
        });
      } catch (_error) {
        logger.warning(`文件上传失败: ${file.originalPath}`, ctx);
      }
    }
    return uploadedFiles;
  }

  private getDirectoryFromPath(filePath: string): string {
    const lastSlash = Math.max(
      filePath.lastIndexOf('/'),
      filePath.lastIndexOf('\\'),
    );
    return lastSlash > 0 ? filePath.substring(0, lastSlash) : process.cwd();
  }
}
