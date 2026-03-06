/**
 * @fileoverview 飞书服务类型定义.
 * 定义飞书 MCP 服务所需的所有类型.
 * @module src/services/feishu/types
 */

// ============================================================================
// 基础类型
// ============================================================================

/**
 * TargetType type 目标类型：云空间或知识库.
 */
export type TargetType = 'drive' | 'wiki';

/**
 * TitleSource type 文档标题来源.
 */
export type TitleSource = 'filename' | 'frontmatter';

/**
 * FrontMatterHandling type Front Matter 处理方式.
 */
export type FrontMatterHandling = 'remove' | 'keep-as-code';

/**
 * LinkSharePermission type 链接分享权限类型.
 */
export type LinkSharePermission =
  | 'tenant_readable'
  | 'tenant_editable'
  | 'anyone_readable'
  | 'anyone_editable';

// ============================================================================
// 认证相关类型
// ============================================================================

/**
 * FeishuAuth interface 飞书认证信息.
 */
export interface FeishuAuth {
  /** 应用 ID */
  appId: string;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 过期时间戳（毫秒） */
  expiresAt: number;
  /** 用户信息 */
  userInfo?: FeishuUserInfo;
}

/**
 * FeishuUserInfo interface 飞书用户信息.
 */
export interface FeishuUserInfo {
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  name: string;
  /** 邮箱 */
  email?: string;
  /** 头像 URL */
  avatarUrl?: string;
}

/**
 * FeishuAppConfig interface 飞书应用配置.
 */
export interface FeishuAppConfig {
  /** 应用 ID */
  appId: string;
  /** 应用密钥（加密存储） */
  appSecret: string;
  /** OAuth 回调地址 */
  callbackUrl: string;
  /** 是否为默认应用 */
  isDefault?: boolean;
}

// ============================================================================
// 文档相关类型
// ============================================================================

/**
 * MarkdownDocument interface Markdown 文档.
 */
export interface MarkdownDocument {
  /** 文档标题 */
  title: string;
  /** Markdown 内容 */
  content: string;
  /** 文件路径（可选，用于解析相对路径） */
  filePath?: string;
  /** 工作目录（可选，用于解析相对路径） */
  workingDirectory?: string;
}

/**
 * FeishuDocument interface 飞书文档.
 */
export interface FeishuDocument {
  /** 文档 ID */
  documentId: string;
  /** 文档 URL */
  url: string;
  /** 文档标题 */
  title: string;
  /** 创建时间戳 */
  createdAt?: number;
  /** 更新时间戳 */
  updatedAt?: number;
}

/**
 * LocalFileInfo interface 本地文件信息.
 */
export interface LocalFileInfo {
  /** 原始路径 */
  originalPath: string;
  /** 文件名 */
  fileName: string;
  /** 占位符 */
  placeholder: string;
  /** 是否为图片 */
  isImage: boolean;
  /** 是否为子文档 */
  isSubDocument?: boolean;
  /** 替代文本 */
  altText?: string;
}

/**
 * CalloutInfo interface Callout 块信息.
 */
export interface CalloutInfo {
  /** 占位符 */
  placeholder: string;
  /** Callout 类型 */
  type: string;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 是否可折叠 */
  foldable: boolean;
  /** 背景色（1-15） */
  backgroundColor?: number;
  /** 边框色（1-7） */
  borderColor?: number;
  /** 文字颜色（1-7） */
  textColor?: number;
  /** 表情图标 ID */
  emojiId?: string;
}

/**
 * FrontMatterData interface Front Matter 数据.
 */
export interface FrontMatterData {
  /** 标题 */
  title?: string;
  /** 其他字段 */
  [key: string]: unknown;
}

/**
 * MarkdownProcessResult interface Markdown 处理结果.
 */
export interface MarkdownProcessResult {
  /** 处理后的内容 */
  content: string;
  /** 本地文件列表 */
  localFiles: LocalFileInfo[];
  /** Callout 块列表 */
  calloutBlocks?: CalloutInfo[];
  /** Front Matter 数据 */
  frontMatter: FrontMatterData | null;
  /** 提取的标题 */
  extractedTitle: string | null;
}

// ============================================================================
// 云空间和知识库类型
// ============================================================================

/**
 * FeishuFolder interface 飞书文件夹.
 */
export interface FeishuFolder {
  /** 文件夹 token */
  token: string;
  /** 文件夹名称 */
  name: string;
  /** 父文件夹 token */
  parentToken?: string;
  /** 创建时间 */
  createdAt?: string;
  /** 修改时间 */
  modifiedAt?: string;
}

/**
 * FeishuWikiSpace interface 飞书知识库空间.
 */
export interface FeishuWikiSpace {
  /** 空间 ID */
  spaceId: string;
  /** 空间名称 */
  name: string;
  /** 空间描述 */
  description?: string;
  /** 空间类型 */
  spaceType?: string;
  /** 可见性 */
  visibility?: string;
}

/**
 * FeishuWikiNode interface 飞书知识库节点.
 */
export interface FeishuWikiNode {
  /** 空间 ID */
  spaceId: string;
  /** 节点 token */
  nodeToken: string;
  /** 对象 token */
  objToken: string;
  /** 对象类型 */
  objType: string;
  /** 父节点 token */
  parentNodeToken?: string;
  /** 标题 */
  title: string;
  /** 是否有子节点 */
  hasChild: boolean;
}

// ============================================================================
// 上传配置和结果类型
// ============================================================================

/**
 * UploadConfig interface 上传配置.
 */
export interface UploadConfig {
  /** 应用 ID（可选，使用默认应用） */
  appId?: string;
  /** 目标类型 */
  targetType: TargetType;
  /** 目标 ID（文件夹 ID 或知识库空间 ID） */
  targetId?: string;
  /** 知识库父节点 token（仅 wiki 类型） */
  parentNodeToken?: string;
  /** 是否上传图片 */
  uploadImages?: boolean;
  /** 是否上传附件 */
  uploadAttachments?: boolean;
  /** 是否移除 Front Matter */
  removeFrontMatter?: boolean;
  /** 代码块过滤语言列表 */
  codeBlockFilterLanguages?: string[];
  /** 是否启用链接分享 */
  enableLinkShare?: boolean;
  /** 链接分享权限 */
  linkSharePermission?: LinkSharePermission;
}

/**
 * UploadResult interface 上传结果.
 */
export interface UploadResult {
  /** 是否成功 */
  success: boolean;
  /** 文档 ID */
  documentId?: string;
  /** 文档 URL */
  url?: string;
  /** 文档标题 */
  title?: string;
  /** 上传的文件列表 */
  uploadedFiles?: UploadedFile[];
  /** 错误信息 */
  error?: string;
  /** 是否检测到冲突 */
  conflictDetected?: boolean;
}

/**
 * UploadedFile interface 已上传的文件.
 */
export interface UploadedFile {
  /** 原始路径 */
  originalPath: string;
  /** 文件名 */
  fileName: string;
  /** 飞书文件 key */
  fileKey: string;
  /** 是否为图片 */
  isImage: boolean;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/**
 * FeishuOAuthResponse interface 飞书 OAuth 响应.
 */
export interface FeishuOAuthResponse {
  /** 响应码 */
  code: number;
  /** 错误消息 */
  msg?: string;
  /** v1 API 格式数据 */
  data?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
  /** v2 API 格式 - 访问令牌 */
  access_token?: string;
  /** v2 API 格式 - 刷新令牌 */
  refresh_token?: string;
  /** v2 API 格式 - 过期时间 */
  expires_in?: number;
  /** v2 API 格式 - 令牌类型 */
  token_type?: string;
  /** v2 API 错误 */
  error?: string;
  /** v2 API 错误描述 */
  error_description?: string;
}

/**
 * FeishuApiResponse interface 飞书 API 通用响应.
 */
export interface FeishuApiResponse<T = unknown> {
  /** 响应码 */
  code: number;
  /** 错误消息 */
  msg?: string;
  /** 响应数据 */
  data?: T;
}

/**
 * FeishuFileUploadResponse interface 飞书文件上传响应.
 */
export interface FeishuFileUploadResponse {
  /** 响应码 */
  code: number;
  /** 错误消息 */
  msg: string;
  /** 响应数据 */
  data: {
    /** 文件 token */
    file_token: string;
  };
}

/**
 * FeishuDocCreateResponse interface 飞书文档创建响应.
 */
export interface FeishuDocCreateResponse {
  /** 响应码 */
  code: number;
  /** 错误消息 */
  msg: string;
  /** 响应数据 */
  data: {
    document: {
      document_id: string;
      revision_id: number;
      title: string;
    };
  };
}

// ============================================================================
// 存储相关类型
// ============================================================================

/**
 * StoredFeishuAuth interface 存储的飞书认证信息.
 */
export interface StoredFeishuAuth {
  /** 应用 ID */
  appId: string;
  /** 应用密钥（加密） */
  appSecret: string;
  /** 访问令牌（加密） */
  accessToken: string;
  /** 刷新令牌（加密） */
  refreshToken: string;
  /** 过期时间戳 */
  expiresAt: number;
  /** 用户信息 */
  userInfo?: FeishuUserInfo | undefined;
}

/**
 * StoredDocumentMeta interface 存储的文档元数据.
 */
export interface StoredDocumentMeta {
  /** 文档 ID */
  documentId: string;
  /** 文档 URL */
  url: string;
  /** 文档标题 */
  title: string;
  /** 应用 ID */
  appId: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 最后上传时间戳（用于冲突检测） */
  lastUploadedAt: number;
  /** 上传时的文档修订版本号（用于冲突检测，替代 lastUploadedAt） */
  lastRevisionId?: number;
  /** 目标类型（drive 或 wiki），用于文档更新时重新定位 */
  targetType?: 'drive' | 'wiki';
  /** 目标 ID（文件夹 token 或知识库空间 ID） */
  targetId?: string;
  /** 知识库父节点 token */
  parentNodeToken?: string;
}

// ============================================================================
// 常量类型
// ============================================================================

/**
 * CalloutTypeMapping interface Callout 类型映射.
 */
export interface CalloutTypeMapping {
  /** 表情符号 */
  emoji: string;
  /** 颜色 */
  color: string;
  /** 标题 */
  title: string;
}

/**
 * FeishuConfig interface 飞书配置常量.
 */
export interface FeishuConfig {
  /** API 基础地址 */
  BASE_URL: string;
  /** OAuth 授权地址 */
  AUTHORIZE_URL: string;
  /** Token 获取地址 */
  TOKEN_URL: string;
  /** Token 刷新地址 */
  REFRESH_TOKEN_URL: string;
  /** API 权限范围 */
  SCOPES: string;
  /** 文件上传地址 */
  UPLOAD_URL: string;
  /** 文档创建地址 */
  DOC_CREATE_URL: string;
  /** 文件夹列表地址 */
  FOLDER_LIST_URL: string;
  /** 用户信息地址 */
  USER_INFO_URL: string;
}
