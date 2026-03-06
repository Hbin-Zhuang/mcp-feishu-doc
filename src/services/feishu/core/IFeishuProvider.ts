/**
 * @fileoverview 飞书服务提供者接口定义.
 * 定义飞书 API 调用、Markdown 处理、频率限制等核心能力的契约.
 * @module src/services/feishu/core/IFeishuProvider
 */

import type { RequestContext } from '@/utils/internal/requestContext.js';
import type {
  FeishuAuth,
  FeishuDocument,
  FeishuFolder,
  FeishuUserInfo,
  FeishuWikiSpace,
  FeishuWikiNode,
  MarkdownDocument,
  MarkdownProcessResult,
  UploadConfig,
  UploadResult,
} from '../types.js';

/**
 * IFeishuApiProvider interface 飞书 API 提供者接口.
 * 封装所有飞书开放平台 API 调用.
 */
export interface IFeishuApiProvider {
  /**
   * 提供者名称.
   */
  readonly name: string;

  /**
   * generateAuthUrl method 生成 OAuth 授权 URL.
   * @param appId 应用 ID
   * @param redirectUri 回调地址
   * @returns 授权 URL 和 state 参数
   */
  generateAuthUrl(
    appId: string,
    redirectUri: string,
  ): { authUrl: string; state: string };

  /**
   * exchangeCodeForToken method 使用授权码换取访问令牌.
   * @param code 授权码
   * @param appId 应用 ID
   * @param appSecret 应用密钥
   * @param redirectUri 回调地址
   * @returns 认证信息
   */
  exchangeCodeForToken(
    code: string,
    appId: string,
    appSecret: string,
    redirectUri: string,
  ): Promise<FeishuAuth>;

  /**
   * refreshToken method 刷新访问令牌.
   * @param refreshToken 刷新令牌
   * @param appId 应用 ID
   * @param appSecret 应用密钥
   * @returns 新的认证信息
   */
  refreshToken(
    refreshToken: string,
    appId: string,
    appSecret: string,
  ): Promise<FeishuAuth>;

  /**
   * getUserInfo method 获取用户信息.
   * @param accessToken 访问令牌
   * @returns 用户信息
   */
  getUserInfo(accessToken: string): Promise<FeishuUserInfo>;

  /**
   * createDocument method 创建飞书文档.
   * @param accessToken 访问令牌
   * @param title 文档标题
   * @param content Markdown 内容
   * @param targetType 目标类型 (drive/wiki)
   * @param targetId 目标 ID (文件夹 ID 或知识库 ID)
   * @param parentNodeToken 父节点 token (可选，用于创建子文档)
   * @returns 创建的文档信息
   */
  createDocument(
    accessToken: string,
    title: string,
    content: string,
    targetType: 'drive' | 'wiki',
    targetId?: string,
    parentNodeToken?: string,
  ): Promise<FeishuDocument>;

  /**
   * updateDocument method 更新飞书文档（删除旧文档并在原位置重建）.
   * @param accessToken 访问令牌
   * @param documentId 旧文档 ID
   * @param content Markdown 内容
   * @param title 文档标题
   * @param targetType 目标类型 (drive/wiki)
   * @param targetId 目标 ID
   * @param parentNodeToken 父节点 token
   * @returns 新文档信息
   */
  updateDocument(
    accessToken: string,
    documentId: string,
    content: string,
    title: string,
    targetType?: 'drive' | 'wiki',
    targetId?: string,
    parentNodeToken?: string,
  ): Promise<FeishuDocument>;

  /**
   * getDocumentMeta method 获取文档元数据（含 revision_id）.
   * @param accessToken 访问令牌
   * @param documentId 文档 ID
   * @returns 文档元数据（包含 revisionId 用于冲突检测）
   */
  getDocumentMeta(
    accessToken: string,
    documentId: string,
  ): Promise<{ documentId: string; updatedAt: number; revisionId: number }>;

  /**
   * deleteDocument method 删除云空间文档.
   * @param accessToken 访问令牌
   * @param fileToken 文档 token
   * @param fileType 文件类型
   */
  deleteDocument(
    accessToken: string,
    fileToken: string,
    fileType?: 'docx' | 'file',
  ): Promise<void>;

  /**
   * getDocumentContent method 获取文档文本内容（通过 Block API）.
   * @param accessToken 访问令牌
   * @param documentId 文档 ID
   * @returns 文档标题和内容
   */
  getDocumentContent(
    accessToken: string,
    documentId: string,
  ): Promise<{ title: string; content: string; revisionId: number }>;

  /**
   * searchDocuments method 搜索云空间文档.
   * @param accessToken 访问令牌
   * @param query 搜索关键词
   * @param count 最多返回数量
   * @returns 文档列表
   */
  searchDocuments(
    accessToken: string,
    query: string,
    count?: number,
  ): Promise<
    Array<{
      token: string;
      name: string;
      url: string;
      type: string;
      ownerName: string;
    }>
  >;

  /**
   * uploadFile method 上传文件到飞书.
   * @param accessToken 访问令牌
   * @param filePath 文件路径
   * @param fileType 文件类型
   * @returns 文件 key
   */
  uploadFile(
    accessToken: string,
    filePath: string,
    fileType: 'image' | 'file',
  ): Promise<string>;

  /**
   * uploadFileBuffer method 上传文件 Buffer 到飞书.
   * @param accessToken 访问令牌
   * @param buffer 文件内容
   * @param fileName 文件名
   * @param fileType 文件类型
   * @returns 文件 key
   */
  uploadFileBuffer(
    accessToken: string,
    buffer: Buffer,
    fileName: string,
    fileType: 'image' | 'file',
  ): Promise<string>;

  /**
   * listFolders method 列出云空间文件夹.
   * @param accessToken 访问令牌
   * @param parentId 父文件夹 ID
   * @returns 文件夹列表
   */
  listFolders(accessToken: string, parentId?: string): Promise<FeishuFolder[]>;

  /**
   * listWikis method 列出知识库空间.
   * @param accessToken 访问令牌
   * @returns 知识库列表
   */
  listWikis(accessToken: string): Promise<FeishuWikiSpace[]>;

  /**
   * getWikiNodes method 获取知识库节点.
   * @param accessToken 访问令牌
   * @param wikiId 知识库 ID
   * @param parentNodeToken 父节点 token
   * @returns 节点列表
   */
  getWikiNodes(
    accessToken: string,
    wikiId: string,
    parentNodeToken?: string,
  ): Promise<FeishuWikiNode[]>;

  /**
   * healthCheck method 健康检查.
   * @returns 是否健康
   */
  healthCheck(): Promise<boolean>;
}

/**
 * IMarkdownProcessor interface Markdown 处理器接口.
 * 将 Markdown 转换为飞书文档格式.
 */
export interface IMarkdownProcessor {
  /**
   * 处理器名称.
   */
  readonly name: string;

  /**
   * process method 处理 Markdown 内容.
   * @param content Markdown 内容
   * @param baseDirectory 基准目录（用于解析相对路径）
   * @param config 处理配置
   * @returns 处理结果
   */
  process(
    content: string,
    baseDirectory: string,
    config?: ProcessConfig,
  ): MarkdownProcessResult;

  /**
   * healthCheck method 健康检查.
   * @returns 是否健康
   */
  healthCheck(): Promise<boolean>;
}

/**
 * ProcessConfig interface Markdown 处理配置.
 */
export interface ProcessConfig {
  /** 是否移除 Front Matter */
  removeFrontMatter?: boolean;
  /** 是否处理本地图片 */
  processImages?: boolean;
  /** 是否处理本地附件 */
  processAttachments?: boolean;
  /** 代码块过滤语言列表 */
  codeBlockFilterLanguages?: string[];
}

/**
 * IRateLimiter interface 频率限制器接口.
 * 控制 API 调用频率，避免触发飞书限制.
 */
export interface IRateLimiter {
  /**
   * 限制器名称.
   */
  readonly name: string;

  /**
   * throttle method 节流控制.
   * @param apiType API 类型
   * @returns Promise，在可以调用时 resolve
   */
  throttle(
    apiType: 'document' | 'import' | 'block' | 'upload' | 'wiki',
  ): Promise<void>;

  /**
   * reset method 重置限制器状态.
   */
  reset(): void;

  /**
   * healthCheck method 健康检查.
   * @returns 是否健康
   */
  healthCheck(): boolean;
}

/**
 * IFeishuService interface 飞书服务编排器接口.
 * 协调各个提供者完成高层业务逻辑.
 */
export interface IFeishuService {
  /**
   * uploadMarkdown method 上传 Markdown 文档.
   * @param document Markdown 文档
   * @param config 上传配置
   * @returns 上传结果
   */
  uploadMarkdown(
    document: MarkdownDocument,
    config: UploadConfig,
  ): Promise<UploadResult>;

  /**
   * updateDocument method 更新文档.
   * @param documentId 文档 ID
   * @param document Markdown 文档
   * @param config 上传配置
   * @param force 是否强制覆盖
   * @returns 上传结果
   */
  updateDocument(
    documentId: string,
    document: MarkdownDocument,
    config: UploadConfig,
    force?: boolean,
  ): Promise<UploadResult>;

  /**
   * getAuthUrl method 获取授权 URL.
   * @param appId 应用 ID
   * @param redirectUri 回调地址
   * @returns 授权 URL 和 state
   */
  getAuthUrl(
    appId?: string,
    redirectUri?: string,
  ): Promise<{ authUrl: string; state: string }>;

  /**
   * handleAuthCallback method 处理授权回调.
   * @param code 授权码
   * @param state state 参数
   * @param appId 应用 ID
   * @returns 认证结果
   */
  handleAuthCallback(
    code: string,
    state: string,
    appId?: string,
  ): Promise<{
    success: boolean;
    userInfo?: FeishuUserInfo;
    expiresAt?: number;
  }>;

  /**
   * listFolders method 列出文件夹.
   * @param context 请求上下文
   * @param parentId 父文件夹 ID
   * @param appId 应用 ID
   * @returns 文件夹列表
   */
  listFolders(
    context: RequestContext,
    parentId?: string,
    appId?: string,
  ): Promise<FeishuFolder[]>;

  /**
   * listWikis method 列出知识库.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @returns 知识库列表
   */
  listWikis(
    context: RequestContext,
    appId?: string,
  ): Promise<FeishuWikiSpace[]>;

  /**
   * getUserInfo method 获取用户信息.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @returns 用户信息
   */
  getUserInfo(context: RequestContext, appId?: string): Promise<FeishuUserInfo>;

  /**
   * getUserInfo method 获取用户信息（重载）.
   * @param appId 应用 ID
   * @returns 用户信息
   */
  getUserInfo(appId?: string): Promise<FeishuUserInfo>;

  /**
   * hasValidAuth method 检查是否有有效的认证.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @returns 是否有有效认证
   */
  hasValidAuth(context: RequestContext, appId?: string): Promise<boolean>;

  /**
   * listApps method 列出已配置的应用.
   * @param context 请求上下文
   * @returns 应用列表
   */
  listApps(context: RequestContext): Promise<
    Array<{
      appId: string;
      isDefault: boolean;
      hasToken: boolean;
      userInfo?: FeishuUserInfo;
    }>
  >;

  /**
   * setDefaultApp method 设置默认应用.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @returns 设置结果
   */
  setDefaultApp(
    context: RequestContext,
    appId: string,
  ): Promise<{ success: boolean; appId: string }>;

  /**
   * getWikiNodes method 获取知识库节点.
   * @param context 请求上下文
   * @param wikiId 知识库 ID
   * @param parentNodeToken 父节点 token
   * @param appId 应用 ID
   * @returns 节点列表
   */
  getWikiNodes(
    context: RequestContext,
    wikiId: string,
    parentNodeToken?: string,
    appId?: string,
  ): Promise<FeishuWikiNode[]>;

  /**
   * getDocumentContent method 读取飞书文档文本内容.
   * @param context 请求上下文
   * @param documentId 文档 ID
   * @param appId 应用 ID
   * @returns 文档标题和 Markdown 内容
   */
  getDocumentContent(
    context: RequestContext,
    documentId: string,
    appId?: string,
  ): Promise<{ title: string; content: string; revisionId: number }>;

  /**
   * searchDocuments method 搜索文档.
   * @param context 请求上下文
   * @param query 搜索关键词
   * @param count 最多返回数量
   * @param appId 应用 ID
   * @returns 文档列表
   */
  searchDocuments(
    context: RequestContext,
    query: string,
    count?: number,
    appId?: string,
  ): Promise<
    Array<{
      token: string;
      name: string;
      url: string;
      type: string;
      ownerName: string;
    }>
  >;

  /**
   * deleteDocumentFile method 删除飞书文档.
   * @param context 请求上下文
   * @param documentId 文档 ID
   * @param appId 应用 ID
   */
  deleteDocumentFile(
    context: RequestContext,
    documentId: string,
    appId?: string,
  ): Promise<void>;

  /**
   * addApp method 添加/配置新的飞书应用.
   * @param context 请求上下文
   * @param appId 应用 ID
   * @param appSecret 应用密钥
   * @returns 配置结果
   */
  addApp(
    context: RequestContext,
    appId: string,
    appSecret: string,
  ): Promise<{ success: boolean; appId: string }>;

  /**
   * batchUploadMarkdown method 批量上传 Markdown 文档.
   * @param config 批量上传配置
   * @param context 请求上下文
   * @returns 批量上传结果
   */
  batchUploadMarkdown(
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
  }>;
}
