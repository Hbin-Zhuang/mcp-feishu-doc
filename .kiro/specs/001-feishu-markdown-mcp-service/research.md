# Research: 飞书 Markdown MCP 服务

**Feature**: 001-feishu-markdown-mcp-service
**Date**: 2025-01-15
**Status**: Complete

## Phase 0 Research Summary

本文档记录了飞书 Markdown MCP 服务的技术调研结果，包括飞书 API 分析、feishushare 代码评估和技术决策。

---

## 1. 飞书开放平台 API 研究

### 1.1 OAuth 2.0 认证流程

**授权端点**:

- 授权 URL: `https://open.feishu.cn/open-apis/authen/v1/authorize`
- Token URL: `https://open.feishu.cn/open-apis/authen/v1/oidc/access_token`
- 刷新 Token URL: `https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token`

**认证流程**:

1. 生成授权 URL（包含 client_id, redirect_uri, scope, state）
2. 用户在浏览器中完成授权
3. 回调接收 authorization code
4. 交换 code 获取 access_token 和 refresh_token
5. access_token 过期后使用 refresh_token 刷新

**所需权限范围**:

```
docx:document:readonly  # 读取文档
docx:document          # 创建和编辑文档
drive:drive:readonly   # 读取云空间
drive:drive            # 管理云空间文件
wiki:wiki:readonly     # 读取知识库
wiki:wiki              # 管理知识库
```

### 1.2 文档 API

**创建文档** (Import Task API):

- Endpoint: `POST /drive/v1/import_tasks`
- 流程: 上传文件 → 创建导入任务 → 轮询任务状态 → 获取文档 ID
- 支持格式: Markdown (.md)
- 频率限制: 90次/分钟

**更新文档** (Block API):

- Endpoint: `PATCH /docx/v1/documents/{document_id}/blocks/{block_id}`
- 支持操作: 替换块内容、插入块、删除块
- 频率限制: 150次/分钟

**获取文档**:

- Endpoint: `GET /docx/v1/documents/{document_id}`
- 返回: 文档元数据（标题、创建时间、更新时间等）

### 1.3 文件上传 API

**素材上传** (Media Upload):

- Endpoint: `POST /drive/v1/medias/upload_all`
- 用途: 上传图片、附件到飞书
- 格式: multipart/form-data
- 返回: file_token（用于文档中引用）
- 大小限制: 单文件最大 20MB

**文件类型支持**:

- 图片: jpg, jpeg, png, gif, bmp, svg, webp
- 文档: pdf, docx, xlsx, pptx
- 其他: txt, md, zip

### 1.4 云空间和知识库 API

**云空间**:

- 列出文件夹: `GET /drive/v1/files`
- 移动文件: `POST /drive/v1/files/{file_token}/move`

**知识库**:

- 列出空间: `GET /wiki/v2/spaces`
- 列出节点: `GET /wiki/v2/spaces/{space_id}/nodes`
- 移动文档到知识库: `POST /wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki`

### 1.5 API 限制和最佳实践

**频率限制**:
| API 类型 | 限制 | 建议策略 |
|---------|------|---------|
| 文档 API | 90次/分钟 | 每秒最多 2 次调用 |
| 导入 API | 90次/分钟 | 每秒最多 1 次调用 |
| 块 API | 150次/分钟 | 每秒最多 2 次调用 |

**最佳实践**:

1. 使用滑动窗口算法控制频率
2. 实现指数退避重试机制
3. 批量操作时控制并发数（建议 3 个）
4. Token 过期自动刷新
5. 错误处理和日志记录

---

## 2. feishushare 代码可复用性评估

### 2.1 MarkdownProcessor 分析

**核心功能** (可复用 90%):

- ✅ Markdown 语法转换（标题、列表、代码块、表格等）
- ✅ 本地文件引用识别（图片、附件）
- ✅ Front Matter 解析和处理
- ✅ Callout 语法转换
- ✅ 占位符机制（用于文件替换）

**需要移除的 Obsidian 依赖**:

- ❌ `App` - Obsidian 应用实例
- ❌ `TFile` - Obsidian 文件对象
- ❌ `normalizePath` - Obsidian 路径规范化

**适配方案**:

```typescript
// 原代码
import { App, TFile, normalizePath } from 'obsidian';
const file = this.app.vault.getFileByPath(path);

// 适配后
import * as fs from 'fs/promises';
import * as path from 'path';
const content = await fs.readFile(path.resolve(basePath, filePath), 'utf-8');
```

### 2.2 FeishuApiService 分析

**核心功能** (可复用 85%):

- ✅ OAuth 2.0 认证流程
- ✅ Token 刷新和过期检测
- ✅ 文件上传（multipart/form-data）
- ✅ 文档创建和更新
- ✅ 云空间和知识库操作
- ✅ 错误处理和重试逻辑

**需要移除的 Obsidian 依赖**:

- ❌ `Notice` - Obsidian 通知组件
- ❌ `requestUrl` - Obsidian HTTP 客户端

**适配方案**:

```typescript
// 原代码
import { Notice, requestUrl } from 'obsidian';
new Notice('上传成功');
const response = await requestUrl({ url, method, headers, body });

// 适配后
import axios from 'axios';
import { logger } from '@/utils/index.js';
logger.info('上传成功');
const response = await axios({ url, method, headers, data: body });
```

### 2.3 RateLimitController 分析

**核心功能** (可复用 100%):

- ✅ 滑动窗口算法
- ✅ 智能节流控制
- ✅ 不同 API 类型的限制配置
- ✅ 无 Obsidian 依赖

**直接复用**:

```typescript
class RateLimitController {
  private lastCallTime: number = 0;
  private callCount: number = 0;
  private resetTime: number = 0;

  async throttle(apiType: 'document' | 'import' | 'block'): Promise<void> {
    // 完整逻辑可直接复用
  }
}
```

### 2.4 ImageProcessingService 分析

**核心功能** (可复用 70%):

- ✅ 图片下载（网络图片）
- ✅ 图片上传到飞书
- ✅ 图片块处理逻辑
- ⚠️ 本地图片读取（需适配）

**适配方案**:

```typescript
// 原代码
const arrayBuffer = await this.app.vault.adapter.readBinary(path);

// 适配后
const buffer = await fs.readFile(path);
const arrayBuffer = buffer.buffer;
```

---

## 3. 技术决策记录

### Decision 1: HTTP 客户端选择

**选择**: axios

**理由**:

- 项目已有依赖
- 支持 Node.js 和浏览器环境
- 完善的错误处理和拦截器
- 支持 multipart/form-data

**替代方案**:

- fetch API: 需要额外的 polyfill
- node-fetch: 仅支持 Node.js

### Decision 2: 文件系统访问

**选择**: Node.js fs/promises API

**理由**:

- 标准库，无额外依赖
- 支持 async/await
- 与 Obsidian API 功能对等

**适配要点**:

- 使用 `fs.readFile` 替代 `vault.read`
- 使用 `path.resolve` 处理路径
- 使用 `fs.stat` 检查文件存在性

### Decision 3: 路径处理

**选择**: Node.js path 模块

**理由**:

- 跨平台路径处理
- 自动处理路径分隔符
- 支持相对路径和绝对路径

**关键方法**:

- `path.resolve()` - 解析绝对路径
- `path.dirname()` - 获取目录名
- `path.basename()` - 获取文件名
- `path.extname()` - 获取扩展名

### Decision 4: Token 存储

**选择**: 项目现有 StorageService

**理由**:

- 统一的存储抽象
- 支持多种后端（in-memory, filesystem, supabase, surrealdb）
- 内置加密支持
- 符合项目架构规范

**存储结构**:

```typescript
Key: `feishu:auth:{appId}`
Value: {
  appId: string
  appSecret: string (encrypted)
  accessToken: string (encrypted)
  refreshToken: string (encrypted)
  expiresAt: number
  userInfo: {...}
}
```

### Decision 5: Markdown 转换策略

**选择**: 保留 feishushare 的转换逻辑

**理由**:

- 已经过充分测试
- 支持飞书文档块结构
- 处理了各种边界情况
- 仅需移除 Obsidian 依赖

**转换规则**:

- 标准 Markdown → 飞书文档块
- 本地文件 → 占位符 → 上传后替换
- Callout → 飞书高亮块
- Front Matter → 可选移除或保留

### Decision 6: 频率控制实现

**选择**: 复用 feishushare 的 RateLimitController

**理由**:

- 已实现滑动窗口算法
- 支持不同 API 类型的限制
- 无外部依赖
- 经过实际使用验证

**配置**:

```typescript
const limits = {
  document: { perSecond: 2, perMinute: 90 },
  import: { perSecond: 1, perMinute: 90 },
  block: { perSecond: 2, perMinute: 150 },
};
```

---

## 4. 实现优先级

### MVP 功能 (Phase 1-4)

**P0 - 核心功能**:

1. OAuth 认证流程
2. Markdown 文档上传
3. 本地文件上传（图片、附件）
4. 云空间支持

**P1 - 重要功能**: 5. 知识库支持 6. 文档更新（基础版本）7. 频率控制 8. 错误处理和重试

### 后续版本 (Phase 5-7)

**P2 - 增强功能**: 9. 批量上传 10. 文档更新冲突检测 11. 多应用配置管理

**P3 - 可选功能**: 12. Callout 语法支持 13. 代码块过滤 14. 扩展 Markdown 语法

---

## 5. 风险和挑战

### 5.1 技术风险

**R1: 飞书 API 稳定性**

- 风险: API 变更或不稳定
- 缓解: 使用稳定版本 API，实现版本兼容层

**R2: 文件路径解析**

- 风险: 不同操作系统路径格式差异
- 缓解: 使用 Node.js path 模块，统一路径处理

**R3: Token 刷新并发**

- 风险: 多个请求同时刷新 token
- 缓解: 使用 Promise 锁机制，防止并发刷新

### 5.2 性能风险

**R4: 大文件处理**

- 风险: 内存占用过高
- 缓解: 流式处理，分块上传

**R5: 频率限制触发**

- 风险: 批量操作触发限制
- 缓解: 智能频率控制，自动节流

---

## 6. 测试策略

### 6.1 单元测试

**覆盖目标**: > 80%

**测试重点**:

- MarkdownProcessor: 各种 Markdown 语法转换
- FeishuApiProvider: API 调用（使用 mock）
- RateLimiter: 频率控制逻辑
- Token 刷新机制

### 6.2 集成测试

**测试场景**:

- OAuth 完整流程
- 文档上传和更新
- 文件上传
- 错误处理和重试

### 6.3 端到端测试

**验证点**:

- 使用真实飞书应用
- 完整的文档创建流程
- 文件上传和替换
- 权限设置

---

## 7. 参考资料

### 官方文档

- [飞书开放平台](https://open.feishu.cn/document/)
- [OAuth 2.0 文档](https://open.feishu.cn/document/common-capabilities/sso/api/oauth)
- [文档 API](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document)
- [云空间 API](https://open.feishu.cn/document/server-docs/docs/drive-v1/file)
- [知识库 API](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space)

### 代码参考

- feishushare 项目: `feishushare/` 目录
- MCP SDK: `@modelcontextprotocol/sdk`
- 项目架构规范: `AGENTS.md`

---

**Research Complete** | **Ready for Implementation**
