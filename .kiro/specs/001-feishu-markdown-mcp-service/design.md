# Implementation Plan: 飞书 Markdown MCP 服务

**Branch**: `001-feishu-markdown-mcp-service` | **Date**: 2025-01-15 | **Spec**: [requirements.md](./requirements.md)

## Summary

将 feishushare Obsidian 插件的核心功能提取并重构为独立的 MCP 服务，使其能够被任何支持 MCP 的 AI 客户端调用。核心技术方案：使用 TypeScript + MCP SDK，遵循项目现有的 DI 架构，通过 ToolDefinition 模式暴露飞书文档操作能力，支持 Markdown 转换、文件上传、OAuth 认证等功能。

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node.js >= 20.0.0  
**Primary Dependencies**:

- @modelcontextprotocol/sdk ^1.24.3 (MCP 协议)
- hono ^4.10.8 (HTTP 传输)
- zod ^4.1.13 (Schema 验证)
- tsyringe ^4.10.0 (依赖注入)
- axios ^1.13.2 (HTTP 客户端)

**Storage**: 项目现有 StorageService (支持多种后端：in-memory, filesystem, supabase, surrealdb)  
**Testing**: Vitest 4.0.15, 目标覆盖率 80%  
**Target Platform**: Node.js 服务器, Cloudflare Workers (可选)  
**Project Type**: MCP Server (支持 stdio 和 HTTP 传输)  
**Performance Goals**:

- 单文档上传 < 5 秒
- 批量 10 文档 < 60 秒
- API 调用重试成功率 > 80%

**Constraints**:

- 必须遵循 AGENTS.md 架构规范
- 必须使用飞书官方 API
- OAuth 回调需要 HTTP 传输模式
- 频率限制：文档 API 90次/分钟

**Scale/Scope**:

- 单用户场景为主
- 支持多应用配置
- 预期并发文档上传 < 5 个

## Steering Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Project Architecture Compliance (from AGENTS.md)

- [x] **逻辑抛出，处理器捕获**: ToolDefinition logic 抛出 McpError，handler 捕获
- [x] **全栈可观测性**: 使用项目现有的 OpenTelemetry 集成
- [x] **结构化、可跟踪的操作**: 使用 appContext 和 sdkContext
- [x] **解耦存储**: 使用 DI 注入的 StorageService
- [x] **本地 ↔ 边缘运行时对等**: 支持 stdio 和 HTTP 传输
- [x] **使用引导获取缺失输入**: 使用 sdkContext.elicitInput()

### Code Style Compliance

- [x] **JSDoc**: 所有导出函数需要 @fileoverview 和 @module
- [x] **验证**: 使用 Zod schema，所有字段需要 .describe()
- [x] **日志记录**: 使用 logger 和 RequestContext
- [x] **错误处理**: Logic 抛出 McpError，handler 捕获
- [x] **密钥管理**: 仅在 src/config/index.ts 中
- [x] **遥测**: 自动初始化，无需手动跨度

**Status**: ✅ 全部通过，无违规项

## Project Structure

### Documentation (this feature)

```text
.kiro/specs/001-feishu-markdown-mcp-service/
├── requirements.md      # 功能规范
├── clarifications.md    # 澄清记录
├── design.md            # 本文件 - 实现计划
├── research.md          # Phase 0 - 技术决策
├── data-model.md        # Phase 1 - 数据模型
├── quickstart.md        # Phase 1 - 验证场景
├── contracts/           # Phase 1 - API 契约
│   ├── feishu-api.yaml  # 飞书 API 接口定义
│   └── mcp-tools.yaml   # MCP 工具接口定义
└── tasks.md             # Tasks workflow 输出
```

### Source Code

```text
src/
├── mcp-server/
│   └── tools/
│       └── definitions/
│           ├── feishu-auth-url.tool.ts          # OAuth 授权 URL
│           ├── feishu-auth-callback.tool.ts     # OAuth 回调处理
│           ├── feishu-upload-markdown.tool.ts   # 上传 Markdown
│           ├── feishu-update-document.tool.ts   # 更新文档
│           ├── feishu-batch-upload.tool.ts      # 批量上传
│           ├── feishu-list-folders.tool.ts      # 列出文件夹
│           ├── feishu-list-wikis.tool.ts        # 列出知识库
│           ├── feishu-get-user-info.tool.ts     # 获取用户信息
│           ├── feishu-set-default-app.tool.ts   # 设置默认应用
│           └── feishu-list-apps.tool.ts         # 列出应用
├── services/
│   └── feishu/
│       ├── core/
│       │   ├── IFeishuProvider.ts               # 飞书服务接口
│       │   └── FeishuService.ts                 # 飞书服务编排器
│       ├── providers/
│       │   ├── feishu-api.provider.ts           # 飞书 API 提供者
│       │   ├── markdown-processor.provider.ts   # Markdown 处理器
│       │   └── rate-limiter.provider.ts         # 频率限制器
│       ├── types.ts                             # 类型定义
│       └── index.ts                             # 导出
├── container/
│   ├── tokens.ts                                # 添加 Feishu 相关 token
│   └── registrations/
│       └── feishu.ts                            # Feishu 服务注册
└── config/
    └── index.ts                                 # 添加飞书配置项

tests/
├── unit/
│   ├── services/feishu/                         # 服务单元测试
│   └── mcp-server/tools/feishu/                 # 工具单元测试
└── integration/
    └── feishu/                                  # 集成测试
```

## Phase 0: Research

### Research Topics

1. **飞书 API 集成模式**
   - 研究飞书开放平台 API 文档
   - 确定需要的 API 端点和权限
   - 评估 API 限制和最佳实践

2. **Markdown 到飞书文档转换**
   - 研究飞书文档块（Block）结构
   - 确定 Markdown 语法映射规则
   - 评估 feishushare 的转换逻辑可复用性

3. **OAuth 2.0 集成**
   - 研究飞书 OAuth 2.0 流程
   - 确定 token 存储和刷新策略
   - 评估与项目现有认证系统的集成

4. **文件上传策略**
   - 研究飞书文件上传 API
   - 确定文件类型支持和大小限制
   - 评估批量上传优化方案

5. **频率限制实现**
   - 研究飞书 API 频率限制规则
   - 评估 feishushare 的 RateLimitController
   - 确定重试和回退策略

详细研究结果将记录在 [research.md](./research.md)

## Phase 1: Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client (AI)                        │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol
┌────────────────────────┴────────────────────────────────────┐
│                   MCP Server (stdio/HTTP)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Tool Definitions Layer                   │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │  │
│  │  │ Auth Tools │  │ Upload     │  │ Management │     │  │
│  │  │            │  │ Tools      │  │ Tools      │     │  │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘     │  │
│  └────────┼───────────────┼───────────────┼────────────┘  │
│           │               │               │                │
│  ┌────────┴───────────────┴───────────────┴────────────┐  │
│  │            Feishu Service (DI Container)            │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │  │ Feishu API   │  │ Markdown     │  │ Rate     │  │  │
│  │  │ Provider     │  │ Processor    │  │ Limiter  │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  │  │
│  └─────────┼──────────────────┼───────────────┼────────┘  │
│            │                  │               │            │
│  ┌─────────┴──────────────────┴───────────────┴────────┐  │
│  │              Storage Service (DI)                    │  │
│  │  - OAuth Tokens (encrypted)                          │  │
│  │  - Document Metadata (lastUploadedAt)                │  │
│  │  - App Configurations                                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────┴────────────────────────────────────┐
│                   Feishu Open Platform API                  │
│  - OAuth 2.0                                                │
│  - Document API                                             │
│  - Drive API                                                │
│  - Wiki API                                                 │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Feishu Service Layer

**FeishuService** (编排器)

- 协调 API Provider、Markdown Processor 和 Rate Limiter
- 管理多应用配置
- 处理 token 刷新和重试逻辑

**FeishuApiProvider** (API 提供者)

- 封装所有飞书 API 调用
- 实现 OAuth 2.0 流程
- 处理文件上传和文档操作
- 从 feishushare 的 FeishuApiService 提取核心逻辑

**MarkdownProcessor** (Markdown 处理器)

- 将 Markdown 转换为飞书文档块结构
- 处理本地文件引用（图片、附件）
- 支持扩展语法（Callout、高亮等）
- 从 feishushare 的 MarkdownProcessor 提取并适配

**RateLimiter** (频率限制器)

- 控制 API 调用频率
- 实现智能节流和回退
- 从 feishushare 的 RateLimitController 提取

#### 2. MCP Tool Definitions

所有工具遵循项目 ToolDefinition 模式：

**认证工具**:

- `feishu_auth_url`: 生成 OAuth 授权 URL
- `feishu_auth_callback`: 处理 OAuth 回调（HTTP 模式）

**文档操作工具**:

- `feishu_upload_markdown`: 上传单个 Markdown 文档
- `feishu_update_document`: 更新已存在的文档（含冲突检测）
- `feishu_batch_upload_markdown`: 批量上传多个文档

**管理工具**:

- `feishu_list_folders`: 列出云空间文件夹
- `feishu_list_wikis`: 列出知识库空间
- `feishu_get_user_info`: 获取当前用户信息
- `feishu_set_default_app`: 设置默认应用
- `feishu_list_apps`: 列出已配置的应用

每个工具包含：

- `inputSchema`: Zod schema with `.describe()`
- `outputSchema`: Zod schema
- `logic`: 纯业务逻辑，抛出 McpError
- `annotations`: UI 提示（readOnly/idempotent）
- `responseFormatter`: 格式化输出

#### 3. Data Storage

使用项目现有的 StorageService，存储结构：

**OAuth Tokens** (加密存储):

```typescript
Key: `feishu:auth:{appId}`;
Value: {
  appId: string;
  appSecret: string(encrypted);
  accessToken: string(encrypted);
  refreshToken: string(encrypted);
  expiresAt: number;
  userInfo: {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string;
  }
}
```

**Document Metadata**:

```typescript
Key: `feishu:doc:{documentId}`;
Value: {
  documentId: string;
  url: string;
  title: string;
  appId: string;
  createdAt: number;
  updatedAt: number;
  lastUploadedAt: number; // 用于冲突检测
}
```

**App Configuration**:

```typescript
Key: `feishu:config:default_app`
Value: string (appId)

Key: `feishu:config:apps`
Value: string[] (appId list)
```

### Key Technical Decisions

#### Decision 1: OAuth 回调处理

**Decision**: 使用 HTTP 传输模式的 `/oauth/callback` 端点接收回调

**Rationale**:

- 符合标准 OAuth 2.0 流程
- 利用项目现有的 HTTP 传输基础设施
- 避免依赖外部回调服务器

**Implementation**:

- 在 HTTP 传输中添加 `/oauth/callback` 路由
- 路由处理器调用 `feishu_auth_callback` 工具逻辑
- stdio 模式下提示用户切换到 HTTP 模式完成授权

**Alternatives Considered**:

- 外部回调服务器：增加部署复杂度
- 手动授权码输入：用户体验差
- 设备授权流程：飞书 API 支持未确认

#### Decision 2: 文件路径解析

**Decision**: 文件路径自动推断，内容需提供工作目录

**Rationale**:

- 平衡自动化和灵活性
- 符合用户直觉（文件路径自动解析相对路径）
- 支持两种常见使用场景

**Implementation**:

- `feishu_upload_markdown` 接受 `filePath` 或 `content + workingDirectory`
- 文件路径模式：使用 `path.dirname(filePath)` 作为基准
- 内容模式：使用用户提供的 `workingDirectory`
- 绝对路径直接使用，不受基准目录影响

**Alternatives Considered**:

- 仅支持绝对路径：不符合 Markdown 常见用法
- 总是要求工作目录：增加用户负担

#### Decision 3: 多应用配置管理

**Decision**: 支持多应用配置，按 App ID 隔离存储

**Rationale**:

- 支持用户使用多个飞书应用（个人、团队等）
- 数据隔离，避免混淆
- 灵活性高，满足不同场景需求

**Implementation**:

- 所有工具接受可选的 `appId` 参数
- 未指定时使用默认应用（从 `feishu:config:default_app` 读取）
- Token 和配置按 `appId` 分别存储
- 提供 `feishu_set_default_app` 和 `feishu_list_apps` 管理工具

**Alternatives Considered**:

- 单应用模式：实现简单但功能受限
- 多租户模式：过于复杂，不符合使用场景

#### Decision 4: 文档更新冲突检测

**Decision**: 时间戳检测冲突，支持强制覆盖

**Rationale**:

- 避免意外覆盖他人修改
- 提供安全的默认行为
- 保留强制覆盖选项以应对特殊情况

**Implementation**:

- 本地存储 `lastUploadedAt` 时间戳
- 更新前获取飞书文档的 `updatedAt`
- 如果 `updatedAt > lastUploadedAt`，返回冲突错误
- 提供 `force` 参数允许强制覆盖
- 更新成功后更新 `lastUploadedAt`

**Alternatives Considered**:

- 完全覆盖模式：可能导致数据丢失
- 不支持更新：功能受限

#### Decision 5: 批量操作和频率控制

**Decision**: 提供批量上传工具，自动频率控制和错误隔离

**Rationale**:

- 提升用户体验，避免手动管理多次调用
- 自动处理频率限制，避免触发 API 限制
- 错误隔离确保部分失败不影响整体

**Implementation**:

- `feishu_batch_upload_markdown` 接受文档列表
- 内部使用 RateLimiter 控制调用频率
- 支持并发控制参数（默认 3 个并发）
- 单个文档失败不影响其他文档
- 返回详细的成功/失败列表

**Alternatives Considered**:

- 不支持批量：用户体验差
- 用户自己控制频率：容易触发限制

### Markdown 转换规则

详细的 Markdown 语法到飞书文档块的映射规则将记录在 [data-model.md](./data-model.md) 中。

核心转换规则：

- 标题 → Heading Block
- 段落 → Text Block
- 列表 → Bullet/Ordered List Block
- 代码块 → Code Block
- 引用 → Quote Block
- 表格 → Table Block
- 图片 → Image Block (需上传)
- Callout → Callout Block (飞书样式)
- 任务列表 → Todo Block

### Error Handling Strategy

遵循项目架构规范：

**Tool Logic Layer**:

- 抛出 `McpError` with appropriate `JsonRpcErrorCode`
- 不使用 try/catch
- 错误信息清晰，包含原因和建议

**Handler Layer**:

- 捕获所有错误
- 格式化错误响应
- 记录错误日志（不包含敏感信息）

**常见错误场景**:

- `InvalidParams` (-32602): 参数验证失败
- `InternalError` (-32603): API 调用失败、网络错误
- `MethodNotFound` (-32601): 文档不存在
- Custom codes: 认证失败、权限不足、冲突检测

**重试策略**:

- 网络错误：最多重试 3 次，指数退避
- Token 过期：自动刷新后重试 1 次
- 频率限制：等待后重试

### Security Considerations

**Token 安全**:

- OAuth tokens 加密存储
- 不在日志中记录 tokens 和密钥
- 支持 HTTPS 传输

**输入验证**:

- 所有输入通过 Zod schema 验证
- 文件路径验证，防止路径遍历
- 文件大小限制检查

**权限控制**:

- 验证飞书 API 返回的权限错误
- 提供清晰的权限不足提示

### Testing Strategy

**Unit Tests** (目标覆盖率 80%):

- MarkdownProcessor: 测试各种 Markdown 语法转换
- FeishuApiProvider: Mock 飞书 API，测试请求构建和响应处理
- RateLimiter: 测试频率控制逻辑
- Tool Definitions: 测试输入验证和逻辑流程

**Integration Tests**:

- OAuth 流程端到端测试（使用测试应用）
- 文档上传和更新流程测试
- 批量操作测试
- 错误处理和重试测试

**Property-Based Tests** (如适用):

- Markdown 转换的可逆性
- 频率限制的正确性
- 批量操作的错误隔离

**Test Fixtures**:

- 示例 Markdown 文件（各种语法）
- Mock 飞书 API 响应
- 测试用的 OAuth tokens

### Performance Optimization

**Markdown 处理**:

- 预编译正则表达式
- 流式处理大文件
- 缓存转换结果（如适用）

**API 调用**:

- 批量操作使用并发控制
- 智能频率限制，避免不必要的等待
- 连接池复用

**存储访问**:

- 批量读写操作
- 缓存常用配置（默认应用等）

## Migration from feishushare

### Code Extraction Strategy

**Phase 1: 提取核心逻辑**

1. **MarkdownProcessor** (`feishushare/src/markdown-processor.ts`)
   - 移除 Obsidian 依赖（App, TFile, normalizePath）
   - 替换为 Node.js 标准 API（fs, path）
   - 保留核心转换逻辑

2. **FeishuApiService** (`feishushare/src/feishu-api.ts`)
   - 提取 API 调用逻辑
   - 移除 Obsidian Notice 和 UI 相关代码
   - 使用 axios 替代 requestUrl

3. **RateLimitController** (内嵌在 feishu-api.ts)
   - 提取为独立的 RateLimiter 类
   - 保持频率控制逻辑不变

4. **ImageProcessingService** (内嵌在 feishu-api.ts)
   - 提取图片处理逻辑
   - 适配 Node.js 文件系统 API

**Phase 2: 适配 MCP 架构**

1. 创建 ToolDefinition 包装器
2. 集成 DI 容器
3. 使用 StorageService 替代本地存储
4. 添加 OpenTelemetry 集成

**Phase 3: 功能增强**

1. 添加多应用配置支持
2. 实现冲突检测机制
3. 添加批量操作功能
4. 完善错误处理和重试

### Compatibility Matrix

| feishushare 功能  | MCP 服务支持 | 实现方式      |
| ----------------- | ------------ | ------------- |
| OAuth 认证        | ✅           | HTTP 传输模式 |
| Markdown 转换     | ✅           | 提取并适配    |
| 本地文件上传      | ✅           | 提取并适配    |
| 图片处理          | ✅           | 提取并适配    |
| 云空间上传        | ✅           | MCP 工具      |
| 知识库上传        | ✅           | MCP 工具      |
| Front Matter 处理 | ✅           | 配置选项      |
| Callout 转换      | ✅           | 保留逻辑      |
| 代码块过滤        | ✅           | 配置选项      |
| 批量处理          | ✅           | 新增功能      |
| UI 通知           | ❌           | MCP 响应替代  |
| 文件选择器        | ❌           | 参数传递替代  |
| 设置界面          | ❌           | 配置文件替代  |

## Configuration Management

### Environment Variables

添加到 `src/config/index.ts`:

```typescript
// Feishu Configuration
FEISHU_DEFAULT_APP_ID: z.string().optional();
FEISHU_DEFAULT_APP_SECRET: z.string().optional();
FEISHU_OAUTH_CALLBACK_URL: z.string().url().optional();
FEISHU_API_BASE_URL: z.string().url().default('https://open.feishu.cn');
FEISHU_RATE_LIMIT_ENABLED: z.boolean().default(true);
FEISHU_MAX_RETRIES: z.number().int().min(0).max(10).default(3);
FEISHU_RETRY_DELAY_MS: z.number().int().min(100).max(10000).default(1000);
```

### Runtime Configuration

通过 MCP 工具动态配置：

- `feishu_set_default_app`: 设置默认应用
- 应用凭证通过 OAuth 流程获取并存储

### Configuration Priority

1. 环境变量（启动时配置）
2. 存储的配置（运行时配置）
3. 默认值

## Deployment Considerations

### Local Development

```bash
# stdio 模式
MCP_TRANSPORT_TYPE=stdio npm run dev

# HTTP 模式（OAuth 需要）
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3000 npm run dev
```

### Production Deployment

**Node.js Server**:

- 使用 HTTP 传输模式
- 配置 HTTPS 证书
- 设置环境变量

**Cloudflare Workers** (可选):

- 使用 HTTP 传输模式
- 配置 OAuth 回调 URL
- 使用 Cloudflare KV 存储

## Dependencies

### New Dependencies

需要添加的依赖（如果项目中没有）：

```json
{
  "dependencies": {
    "form-data": "^4.0.0", // 文件上传
    "mime-types": "^2.1.35" // 文件类型检测
  }
}
```

### Existing Dependencies (Reuse)

- `axios`: HTTP 客户端（已有）
- `zod`: Schema 验证（已有）
- `tsyringe`: 依赖注入（已有）
- `pino`: 日志记录（已有）
- `@modelcontextprotocol/sdk`: MCP 协议（已有）

## Monitoring and Observability

### Metrics

使用项目现有的 OpenTelemetry 集成：

**Tool Execution Metrics**:

- `feishu.tool.duration`: 工具执行时间
- `feishu.tool.success`: 成功次数
- `feishu.tool.error`: 错误次数

**API Call Metrics**:

- `feishu.api.calls`: API 调用次数
- `feishu.api.duration`: API 响应时间
- `feishu.api.errors`: API 错误次数
- `feishu.api.rate_limit`: 频率限制触发次数

**Upload Metrics**:

- `feishu.upload.documents`: 上传文档数
- `feishu.upload.files`: 上传文件数
- `feishu.upload.bytes`: 上传字节数

### Logging

使用项目的 logger，记录：

- OAuth 流程关键步骤
- API 调用（不含敏感信息）
- 错误和警告
- 性能指标

### Tracing

自动跟踪：

- Tool 执行链路
- API 调用链路
- 文件处理流程

## Implementation Phases

### Phase 0: 准备和研究 (1-2 days)

- [ ] 研究飞书 API 文档
- [ ] 评估 feishushare 代码可复用性
- [ ] 创建 research.md
- [ ] 设置测试飞书应用

### Phase 1: 核心服务层 (3-4 days)

- [ ] 提取并适配 MarkdownProcessor
- [ ] 提取并适配 FeishuApiProvider
- [ ] 提取并适配 RateLimiter
- [ ] 实现 FeishuService 编排器
- [ ] 配置 DI 容器注册
- [ ] 编写单元测试

### Phase 2: OAuth 认证 (2-3 days)

- [ ] 实现 feishu_auth_url 工具
- [ ] 实现 feishu_auth_callback 工具
- [ ] 添加 HTTP 传输路由
- [ ] 实现 token 存储和刷新
- [ ] 编写认证流程测试

### Phase 3: 文档操作工具 (3-4 days)

- [ ] 实现 feishu_upload_markdown 工具
- [ ] 实现 feishu_update_document 工具
- [ ] 实现冲突检测机制
- [ ] 实现文件上传逻辑
- [ ] 编写文档操作测试

### Phase 4: 管理工具 (2-3 days)

- [ ] 实现 feishu_list_folders 工具
- [ ] 实现 feishu_list_wikis 工具
- [ ] 实现 feishu_get_user_info 工具
- [ ] 实现 feishu_set_default_app 工具
- [ ] 实现 feishu_list_apps 工具
- [ ] 编写管理工具测试

### Phase 5: 批量操作 (2-3 days)

- [ ] 实现 feishu_batch_upload_markdown 工具
- [ ] 实现并发控制
- [ ] 实现错误隔离
- [ ] 编写批量操作测试

### Phase 6: 集成和优化 (2-3 days)

- [ ] 端到端集成测试
- [ ] 性能优化
- [ ] 错误处理完善
- [ ] 文档编写
- [ ] 代码审查

**总计**: 15-22 天

## Risk Assessment

### High Risk

**R1: 飞书 API 变更**

- **Impact**: 功能失效
- **Mitigation**:
  - 使用稳定版本 API
  - 监控 API 变更通知
  - 实现版本兼容层

**R2: OAuth 流程复杂性**

- **Impact**: 认证失败率高
- **Mitigation**:
  - 详细的错误提示
  - 完善的测试覆盖
  - 提供故障排查文档

### Medium Risk

**R3: Markdown 转换准确性**

- **Impact**: 格式丢失或错误
- **Mitigation**:
  - 复用 feishushare 验证过的逻辑
  - 全面的转换测试
  - 提供转换预览功能（后续）

**R4: 频率限制触发**

- **Impact**: 用户体验下降
- **Mitigation**:
  - 智能频率控制
  - 清晰的限制提示
  - 自动重试机制

### Low Risk

**R5: 存储后端兼容性**

- **Impact**: 部分存储后端不可用
- **Mitigation**:
  - 使用项目标准 StorageService
  - 测试多种存储后端

## Success Metrics

### Functional Metrics

- [ ] 所有 10 个 MCP 工具正常工作
- [ ] OAuth 认证成功率 > 95%
- [ ] Markdown 转换准确率 > 95%
- [ ] 单元测试覆盖率 > 80%

### Performance Metrics

- [ ] 单文档上传 < 5 秒
- [ ] 批量 10 文档 < 60 秒
- [ ] API 重试成功率 > 80%
- [ ] 频率限制触发率 < 5%

### Quality Metrics

- [ ] 无 critical 级别 bug
- [ ] 代码通过 lint 和 typecheck
- [ ] 所有测试通过
- [ ] 文档完整

## Next Steps

完成设计后：

1. **运行 Tasks 工作流** - 生成详细的任务列表
2. **创建 data-model.md** - 详细的数据模型定义
3. **创建 contracts/** - API 契约定义
4. **创建 quickstart.md** - 验证场景
5. **开始实现** - 按照实现阶段执行

---

**Design Complete** | **Ready for Tasks Workflow**
