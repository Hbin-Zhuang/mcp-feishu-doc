/**
 * @fileoverview 飞书服务模块导出.
 * @module src/services/feishu
 */

// 核心接口
export type {
  IFeishuApiProvider,
  IFeishuService,
  IMarkdownProcessor,
  IRateLimiter,
  ProcessConfig,
} from './core/IFeishuProvider.js';

// 服务实现
export { FeishuService } from './core/FeishuService.js';

// 提供者实现
export { MarkdownProcessorProvider } from './providers/markdown-processor.provider.js';
export { FeishuApiProvider } from './providers/feishu-api.provider.js';
export {
  FeishuRateLimiter,
  type FeishuApiType,
} from './providers/rate-limiter.provider.js';

// 类型定义
export type {
  CalloutInfo,
  FeishuApiResponse,
  FeishuAppConfig,
  FeishuAuth,
  FeishuConfig,
  FeishuDocCreateResponse,
  FeishuDocument,
  FeishuFileUploadResponse,
  FeishuFolder,
  FeishuOAuthResponse,
  FeishuUserInfo,
  FeishuWikiNode,
  FeishuWikiSpace,
  FrontMatterData,
  FrontMatterHandling,
  LinkSharePermission,
  LocalFileInfo,
  MarkdownDocument,
  MarkdownProcessResult,
  StoredDocumentMeta,
  StoredFeishuAuth,
  TargetType,
  TitleSource,
  UploadConfig,
  UploadedFile,
  UploadResult,
} from './types.js';

// 常量
export {
  CALLOUT_COLOR_MAP,
  CALLOUT_TYPE_MAPPING,
  DEFAULT_UPLOAD_CONFIG,
  FEISHU_CONFIG,
  FEISHU_ERROR_MESSAGES,
  FILE_SIZE_LIMITS,
  RATE_LIMITS,
  SUPPORTED_FILE_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  TOKEN_EXPIRED_CODES,
} from './constants.js';
