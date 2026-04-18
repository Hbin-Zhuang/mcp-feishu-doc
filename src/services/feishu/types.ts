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
 * FeishuDocumentReadBlockType type 文档读取块类型.
 */
export type FeishuDocumentReadBlockType = 'text' | 'image' | 'file';

/**
 * FeishuDocumentAssetType type 文档媒体资产类型.
 */
export type FeishuDocumentAssetType = 'image' | 'file';

/**
 * FeishuDocumentAssetDeliveryMode type 文档媒体资产返回方式.
 */
export type FeishuDocumentAssetDeliveryMode =
  | 'inline_base64'
  | 'local_file_only';

/**
 * FeishuDocumentAssetStatus type 文档媒体资产处理状态.
 */
export type FeishuDocumentAssetStatus =
  | 'downloaded'
  | 'skipped_too_large'
  | 'skipped_over_limit';

/**
 * MediaUploadFailureStatus type 媒体上传失败状态.
 */
export type MediaUploadFailureStatus =
  | 'upload_failed'
  | 'file_missing'
  | 'skipped_too_large'
  | 'skipped_over_limit';

/**
 * LocalFileSourceType type 本地文件来源类型.
 */
export type LocalFileSourceType = 'local' | 'remote';

/**
 * FeishuDocumentMediaPatchType type 上传后需要回填到正文中的媒体类型.
 */
export type FeishuDocumentMediaPatchType = 'image' | 'file';

/**
 * FeishuDocumentReadBlock interface 文档读取后的顺序块.
 */
export interface FeishuDocumentReadBlock {
  /** Block ID */
  blockId: string;
  /** 块类型 */
  type: FeishuDocumentReadBlockType;
  /** 文本内容（仅 text 块） */
  text?: string;
  /** 媒体 file token（仅 image/file 块） */
  fileToken?: string;
  /** 在文本流中的占位文案 */
  placeholderText?: string;
}

/**
 * FeishuDocumentAsset interface 文档中解析出的媒体资产.
 */
export interface FeishuDocumentAsset {
  /** 飞书 file token */
  fileToken: string;
  /** 资产类型 */
  type: FeishuDocumentAssetType;
  /** 文件名 */
  fileName: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件字节数 */
  byteLength: number;
  /** 本地临时文件路径（Node 环境下可用） */
  localPath?: string;
  /** 图片 base64 数据（不含 data URI 前缀） */
  base64Data?: string;
  /** 附件文本预览 */
  previewText?: string;
  /** 媒体返回方式 */
  deliveryMode?: FeishuDocumentAssetDeliveryMode;
  /** 媒体处理状态 */
  status?: FeishuDocumentAssetStatus;
  /** 状态原因 */
  reason?: string;
}

/**
 * FeishuDocumentMediaPatch interface 上传后用于回填正文的本地媒体映射.
 */
export interface FeishuDocumentMediaPatch {
  /** 本地原始路径 */
  originalPath: string;
  /** 真实上传路径（远程资源下载后会指向临时文件） */
  resolvedPath?: string;
  /** 占位符文本 */
  placeholder: string;
  /** 媒体类型 */
  type: FeishuDocumentMediaPatchType;
  /** 文件名 */
  fileName: string;
}

/**
 * FeishuDocumentMediaPatchResult interface 文档媒体回填结果.
 */
export interface FeishuDocumentMediaPatchResult {
  /** 成功上传并回填的媒体 */
  uploadedFiles: UploadedFile[];
  /** 媒体处理失败详情 */
  mediaUploadFailures: MediaUploadFailure[];
}

/**
 * FeishuDocumentContent interface 飞书文档读取结果.
 */
export interface FeishuDocumentContent {
  /** 文档标题 */
  title: string;
  /** 近似 Markdown 的文本内容，包含图片/附件占位锚点 */
  content: string;
  /** 文档当前修订号 */
  revisionId: number;
  /** 按文档顺序排列的块 */
  blocks: FeishuDocumentReadBlock[];
  /** 文档中的媒体资产 */
  assets: FeishuDocumentAsset[];
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
  /** 文件来源类型 */
  sourceType?: LocalFileSourceType;
  /** 远程资源 URL（仅 remote 类型） */
  remoteUrl?: string;
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
  /** 是否下载远程图片并转存到飞书 */
  downloadRemoteImages?: boolean;
  /** 是否下载远程附件并转存到飞书 */
  downloadRemoteAttachments?: boolean;
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
  /** 媒体上传失败列表 */
  mediaUploadFailures?: MediaUploadFailure[];
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

/**
 * MediaUploadFailure interface 媒体上传失败详情.
 */
export interface MediaUploadFailure {
  /** 原始路径 */
  originalPath: string;
  /** 文件名 */
  fileName: string;
  /** 是否为图片 */
  isImage: boolean;
  /** 失败原因 */
  error: string;
  /** 失败状态 */
  status?: MediaUploadFailureStatus;
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
