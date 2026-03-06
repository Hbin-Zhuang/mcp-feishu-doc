/**
 * @fileoverview 飞书服务常量定义.
 * 包含 API 配置、默认设置、错误消息和 Callout 类型映射.
 * @module src/services/feishu/constants
 */

import type { CalloutTypeMapping, FeishuConfig } from './types.js';

/**
 * FEISHU_CONFIG const 飞书 API 配置常量.
 */
export const FEISHU_CONFIG: FeishuConfig & {
  DEFAULT_APP_ID: string;
  DEFAULT_APP_SECRET: string;
  OAUTH_CALLBACK_URL: string;
  RATE_LIMIT_ENABLED: boolean;
  MAX_RETRIES: number;
  RETRY_DELAY_MS: number;
} = {
  // API 基础地址
  BASE_URL:
    process.env.FEISHU_API_BASE_URL || 'https://open.feishu.cn/open-apis',

  // OAuth 相关地址
  AUTHORIZE_URL: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
  TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
  REFRESH_TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',

  // API 权限范围（包含 offline_access 以支持 refresh_token）
  SCOPES:
    'contact:user.base:readonly docx:document wiki:wiki offline_access',

  // 文件上传相关（使用素材上传 API，导入后自动删除源文件）
  UPLOAD_URL: 'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all',

  // 文档创建相关
  DOC_CREATE_URL: 'https://open.feishu.cn/open-apis/docx/v1/documents',

  // 文件夹相关
  FOLDER_LIST_URL: 'https://open.feishu.cn/open-apis/drive/v1/files',

  // 用户信息
  USER_INFO_URL: 'https://open.feishu.cn/open-apis/authen/v1/user_info',

  // 默认配置（从环境变量读取）
  DEFAULT_APP_ID: process.env.FEISHU_DEFAULT_APP_ID || '',
  DEFAULT_APP_SECRET: process.env.FEISHU_DEFAULT_APP_SECRET || '',
  OAUTH_CALLBACK_URL:
    process.env.FEISHU_OAUTH_CALLBACK_URL ||
    'http://localhost:3010/oauth/feishu/callback',

  // 频率限制配置
  RATE_LIMIT_ENABLED: process.env.FEISHU_RATE_LIMIT_ENABLED !== 'false',
  MAX_RETRIES: parseInt(process.env.FEISHU_MAX_RETRIES || '3', 10),
  RETRY_DELAY_MS: parseInt(process.env.FEISHU_RETRY_DELAY_MS || '1000', 10),
};

/**
 * FEISHU_ERROR_MESSAGES const 飞书错误消息映射.
 */
export const FEISHU_ERROR_MESSAGES: Record<number, string> = {
  1061002: '参数错误，请检查文件格式和大小',
  1061005: '文件大小超出限制',
  1061006: '文件类型不支持',
  99991663: 'access_token 无效',
  99991664: 'access_token 已过期',
  99991665: 'refresh_token 无效',
  99991666: 'refresh_token 已过期',
  20005: 'token 无效',
};

/**
 * TOKEN_EXPIRED_CODES const Token 过期相关错误码.
 */
export const TOKEN_EXPIRED_CODES = [
  99991664, // access_token expired
  99991663, // access_token invalid
  99991665, // refresh_token expired
  99991666, // refresh_token invalid
  20005, // 另一种 token 无效错误码
  1, // 通用的无效 token 错误
];

/**
 * RATE_LIMITS const API 频率限制配置.
 */
export const RATE_LIMITS = {
  document: { perSecond: 2, perMinute: 90 },
  import: { perSecond: 1, perMinute: 90 },
  block: { perSecond: 2, perMinute: 150 },
  file: { perSecond: 2, perMinute: 60 },
};

/**
 * CALLOUT_TYPE_MAPPING const Obsidian Callout 类型到飞书样式的映射表.
 */
export const CALLOUT_TYPE_MAPPING: Record<string, CalloutTypeMapping> = {
  // 信息类
  note: { emoji: '📝', color: 'blue', title: '笔记' },
  info: { emoji: 'ℹ️', color: 'blue', title: '信息' },
  tip: { emoji: '💡', color: 'green', title: '提示' },
  hint: { emoji: '💡', color: 'green', title: '提示' },

  // 警告类
  warning: { emoji: '⚠️', color: 'yellow', title: '警告' },
  caution: { emoji: '⚠️', color: 'yellow', title: '注意' },
  attention: { emoji: '⚠️', color: 'yellow', title: '注意' },

  // 错误类
  error: { emoji: '❌', color: 'red', title: '错误' },
  danger: { emoji: '⛔', color: 'red', title: '危险' },
  failure: { emoji: '❌', color: 'red', title: '失败' },
  fail: { emoji: '❌', color: 'red', title: '失败' },
  missing: { emoji: '❓', color: 'red', title: '缺失' },

  // 成功类
  success: { emoji: '✅', color: 'green', title: '成功' },
  check: { emoji: '✅', color: 'green', title: '检查' },
  done: { emoji: '✅', color: 'green', title: '完成' },

  // 问题类
  question: { emoji: '❓', color: 'purple', title: '问题' },
  help: { emoji: '❓', color: 'purple', title: '帮助' },
  faq: { emoji: '❓', color: 'purple', title: '常见问题' },

  // 引用类
  quote: { emoji: '💬', color: 'gray', title: '引用' },
  cite: { emoji: '📖', color: 'gray', title: '引用' },

  // 抽象类
  abstract: { emoji: '📄', color: 'cyan', title: '摘要' },
  summary: { emoji: '📄', color: 'cyan', title: '总结' },
  tldr: { emoji: '📄', color: 'cyan', title: 'TL;DR' },

  // 示例类
  example: { emoji: '📋', color: 'purple', title: '示例' },

  // 任务类
  todo: { emoji: '☑️', color: 'blue', title: '待办' },

  // 默认类型
  default: { emoji: '📌', color: 'blue', title: '提示' },
};

/**
 * CALLOUT_COLOR_MAP const Callout 颜色到飞书颜色值的映射.
 */
export const CALLOUT_COLOR_MAP: Record<
  string,
  { background: number; border: number; text: number }
> = {
  blue: { background: 2, border: 2, text: 2 },
  green: { background: 4, border: 4, text: 4 },
  yellow: { background: 6, border: 6, text: 6 },
  red: { background: 1, border: 1, text: 1 },
  purple: { background: 5, border: 5, text: 5 },
  gray: { background: 7, border: 7, text: 7 },
  cyan: { background: 3, border: 3, text: 3 },
};

/**
 * DEFAULT_UPLOAD_CONFIG const 默认上传配置.
 */
export const DEFAULT_UPLOAD_CONFIG = {
  targetType: 'wiki' as const,
  uploadImages: true,
  uploadAttachments: true,
  removeFrontMatter: true,
  enableLinkShare: true,
  linkSharePermission: 'anyone_readable' as const,
};

/**
 * FILE_SIZE_LIMITS const 文件大小限制（字节）.
 */
export const FILE_SIZE_LIMITS = {
  image: 20 * 1024 * 1024, // 20MB
  file: 100 * 1024 * 1024, // 100MB
  markdown: 10 * 1024 * 1024, // 10MB
};

/**
 * DOC_IMAGE_EMBED_LIMITS const 文档内联图片限制（避免 payload 过大）.
 */
export const DOC_IMAGE_EMBED_LIMITS = {
  /** 最多内联图片数量 */
  maxImages: 15,
  /** 单张图片最大字节（2.5MB），超出用占位符 */
  maxSingleImageBytes: 2.5 * 1024 * 1024,
  /** 所有内联图片总字节上限（10MB），超出用占位符 */
  maxTotalBytes: 10 * 1024 * 1024,
};

/**
 * SUPPORTED_IMAGE_EXTENSIONS const 支持的图片扩展名.
 */
export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
];

/**
 * SUPPORTED_FILE_EXTENSIONS const 支持的附件扩展名.
 */
export const SUPPORTED_FILE_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.zip',
  '.rar',
  '.7z',
];
