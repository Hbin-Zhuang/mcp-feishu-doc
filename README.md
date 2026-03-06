<div align="center">
  <h1>mcp-feishu-doc</h1>
  <p><b>飞书（Lark）云文档与知识库管理的 MCP 服务器。支持 OAuth 授权、Markdown 上传/更新/删除、文档搜索、多应用配置，以及本地和边缘（Cloudflare Workers）运行。</b>
  <div>15 个飞书工具</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-2.6.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![MCP Spec](https://img.shields.io/badge/MCP%20Spec-2025--06--18-8A2BE2.svg?style=flat-square)](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/changelog.mdx) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.24.3-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Status](https://img.shields.io/badge/Status-Stable-brightgreen.svg?style=flat-square)](https://github.com/Hbin-Zhuang/mcp-feishu-doc/issues) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-10.19.0-orange.svg?style=flat-square)](https://pnpm.io/) [![Code Coverage](https://img.shields.io/badge/Coverage-76.12%25-brightgreen.svg?style=flat-square)](./coverage/index.html)

</div>

---

## ✨ 特性

- **飞书云文档集成**：OAuth 2.0 认证、Markdown 上传/更新/删除、批量上传、文档搜索。
- **知识库管理**：列出知识库空间、文件夹、知识库节点。
- **多应用配置**：支持多个飞书应用、设置默认应用。
- **抽象化存储**：支持 `in-memory`、`filesystem`、Supabase、SurrealDB 等后端。
- **强大的错误处理**：统一的 `McpError` 系统确保一致的错误响应。
- **全栈可观测性**：结构化日志（Pino）和可选的 OpenTelemetry。
- **边缘就绪**：支持本地或 Cloudflare Workers 运行。

## 🏗️ 架构

本项目遵循模块化、领域驱动的架构，具有清晰的关注点分离：

```
┌─────────────────────────────────────────────────────────┐
│              MCP 客户端（Claude Code、ChatGPT 等）        │
└────────────────────┬────────────────────────────────────┘
                     │ JSON-RPC 2.0
                     ▼
┌─────────────────────────────────────────────────────────┐
│           MCP 服务器（工具、资源）                        │
│           📖 [MCP 服务器指南](src/mcp-server/)          │
└────────────────────┬────────────────────────────────────┘
                     │ 依赖注入
                     ▼
┌─────────────────────────────────────────────────────────┐
│          依赖注入容器                                     │
│              📦 [容器指南](src/container/)              │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
 ┌──────────┐   ┌──────────┐   ┌──────────┐
 │ 服务     │   │ 存储     │   │ 工具     │
 │ 🔌 [→]   │   │ 💾 [→]   │   │ 🛠️ [→]   │
 └──────────┘   └──────────┘   └──────────┘

[→]: src/services/    [→]: src/storage/    [→]: src/utils/
```

**核心模块：**

- **[MCP 服务器](src/mcp-server/)** - 工具、资源、提示和传输层实现
- **[容器](src/container/)** - 使用 tsyringe 进行依赖注入设置，实现清晰的架构
- **[服务](src/services/)** - 外部服务集成（LLM、语音、图），具有可插拔的提供者
- **[存储](src/storage/)** - 抽象化的持久层，支持多个后端
- **[工具](src/utils/)** - 横切关注点（日志记录、安全、解析、遥测）

> 💡 **提示**：每个模块都有自己的综合 README，包含架构图、使用示例和最佳实践。点击上面的链接深入了解！

## 🛠️ 功能概览

### 飞书工具

| 工具                     | 描述                         |
| :----------------------- | :--------------------------- |
| **`feishu_auth_url`**    | 生成飞书 OAuth 2.0 授权链接。 |
| **`feishu_auth_callback`** | 处理飞书 OAuth 授权回调。   |
| **`feishu_upload_markdown`** | 上传 Markdown 文档到飞书云文档。 |
| **`feishu_update_document`** | 更新已存在的飞书文档（支持冲突检测）。 |
| **`feishu_batch_upload_markdown`** | 批量上传多个 Markdown 文档。 |
| **`feishu_get_document`** | 读取飞书文档内容。          |
| **`feishu_delete_document`** | 删除飞书文档。            |
| **`feishu_search_documents`** | 搜索飞书文档。           |
| **`feishu_list_folders`** | 列出飞书云空间文件夹。      |
| **`feishu_list_wikis`** | 列出飞书知识库空间。        |
| **`feishu_list_wiki_nodes`** | 列出知识库节点。       |
| **`feishu_get_user_info`** | 获取当前飞书用户信息。   |
| **`feishu_set_default_app`** | 设置默认飞书应用。      |
| **`feishu_list_apps`** | 列出已配置的飞书应用。      |
| **`feishu_add_app`** | 添加飞书应用配置。          |

## 🚀 快速开始

### MCP 客户端设置/配置

将以下内容添加到您的 MCP 客户端配置文件（例如，`cline_mcp_settings.json`）。

```json
{
  "mcpServers": {
    "mcp-feishu-doc": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-feishu-doc@latest"],
      "env": {
        "FEISHU_DEFAULT_APP_ID": "cli_xxx",
        "FEISHU_DEFAULT_APP_SECRET": "xxx",
        "FEISHU_OAUTH_CALLBACK_URL": "http://localhost:3010/oauth/feishu/callback",
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "LOGS_DIR": "~/.mcp-feishu-doc/logs",
        "STORAGE_PROVIDER_TYPE": "filesystem",
        "STORAGE_FILESYSTEM_PATH": "~/.mcp-feishu-doc/storage"
      }
    }
  }
}
```

### 前置要求

- [Node.js](https://nodejs.org/) v20.0.0 或更高版本
- [pnpm](https://pnpm.io/) v10.0.0 或更高版本

### 安装

1.  **克隆仓库：**

```sh
git clone https://github.com/Hbin-Zhuang/mcp-feishu-doc.git
```

2.  **进入目录：**

```sh
cd mcp-feishu-doc
```

3.  **安装依赖：**

```sh
pnpm install
```

## ⚙️ 配置

所有配置都在 `src/config/index.ts` 中集中管理并在启动时验证。`.env` 文件中的关键环境变量包括：

| 变量                        | 描述                                                                                                              | 默认值      |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------- | :---------- |
| `MCP_TRANSPORT_TYPE`        | 要使用的传输方式：`stdio` 或 `http`。                                                                             | `http`      |
| `MCP_HTTP_PORT`             | HTTP 服务器的端口。                                                                                               | `3010`      |
| `MCP_HTTP_HOST`             | HTTP 服务器的主机名。                                                                                             | `127.0.0.1` |
| `MCP_AUTH_MODE`             | 身份验证模式：`none`、`jwt` 或 `oauth`。                                                                          | `none`      |
| `MCP_AUTH_SECRET_KEY`       | **`jwt` 身份验证模式必需。** 32+ 字符的密钥。                                                                     | `(none)`    |
| `OAUTH_ISSUER_URL`          | **`oauth` 身份验证模式必需。** OIDC 提供者的 URL。                                                                | `(none)`    |
| `STORAGE_PROVIDER_TYPE`     | 存储后端：`in-memory`、`filesystem`、`supabase`、`surrealdb`、`cloudflare-d1`、`cloudflare-kv`、`cloudflare-r2`。 | `in-memory` |
| `STORAGE_FILESYSTEM_PATH`   | **`filesystem` 存储必需。** 存储目录的路径。                                                                      | `(none)`    |
| `FEISHU_DEFAULT_APP_ID`     | 飞书应用 ID（可选，也可通过 OAuth 流程配置）。                                                                    | `(none)`    |
| `FEISHU_DEFAULT_APP_SECRET` | 飞书应用密钥（可选）。                                                                                            | `(none)`    |
| `FEISHU_OAUTH_CALLBACK_URL` | 飞书 OAuth 回调地址。                                                                                             | `(none)`    |
| `SUPABASE_URL`              | **`supabase` 存储必需。** 您的 Supabase 项目 URL。                                                                | `(none)`    |
| `SUPABASE_SERVICE_ROLE_KEY` | **`supabase` 存储必需。** 您的 Supabase 服务角色密钥。                                                            | `(none)`    |
| `SURREALDB_URL`             | **`surrealdb` 存储必需。** SurrealDB 端点（例如，`wss://cloud.surrealdb.com/rpc`）。                              | `(none)`    |
| `SURREALDB_NAMESPACE`       | **`surrealdb` 存储必需。** SurrealDB 命名空间。                                                                   | `(none)`    |
| `SURREALDB_DATABASE`        | **`surrealdb` 存储必需。** SurrealDB 数据库名称。                                                                 | `(none)`    |
| `SURREALDB_USERNAME`        | **`surrealdb` 存储可选。** 用于身份验证的数据库用户名。                                                           | `(none)`    |
| `SURREALDB_PASSWORD`        | **`surrealdb` 存储可选。** 用于身份验证的数据库密码。                                                             | `(none)`    |
| `OTEL_ENABLED`              | 设置为 `true` 以启用 OpenTelemetry。                                                                              | `false`     |
| `LOG_LEVEL`                 | 日志记录的最低级别（`debug`、`info`、`warn`、`error`）。                                                          | `info`      |
| `OPENROUTER_API_KEY`        | OpenRouter LLM 服务的 API 密钥。                                                                                  | `(none)`    |

### 身份验证和授权

- **模式**：`none`（默认）、`jwt`（需要 `MCP_AUTH_SECRET_KEY`）或 `oauth`（需要 `OAUTH_ISSUER_URL` 和 `OAUTH_AUDIENCE`）。
- **强制执行**：使用 `withToolAuth([...])` 或 `withResourceAuth([...])` 包装您的工具/资源 `logic` 函数以强制执行范围检查。当身份验证模式为 `none` 时，为方便开发人员，范围检查会被绕过。

### 存储

- **服务**：DI 管理的 `StorageService` 为持久化提供一致的 API。**永远不要从工具逻辑直接访问 `fs` 或其他存储 SDK。**
- **提供者**：默认是 `in-memory`。仅 Node 的提供者包括 `filesystem`。边缘兼容的提供者包括 `supabase`、`surrealdb`、`cloudflare-kv` 和 `cloudflare-r2`。
- **SurrealDB 设置**：使用 `surrealdb` 提供者时，在首次使用前使用 `docs/surrealdb-schema.surql` 初始化数据库架构。
- **多租户**：`StorageService` 需要 `context.tenantId`。启用身份验证时，这会自动从 JWT 中的 `tid` 声明传播。
- **高级功能**：
  - **安全分页**：带有租户 ID 绑定的不透明游标可防止跨租户攻击
  - **批处理操作**：`getMany()`、`setMany()`、`deleteMany()` 的并行执行
  - **TTL 支持**：所有提供者的生存时间，具有适当的过期处理
  - **全面验证**：租户 ID、密钥和选项的集中输入验证

### 可观测性

- **结构化日志记录**：Pino 已开箱即用集成。所有日志都是 JSON 格式，并包含 `RequestContext`。
- **OpenTelemetry**：默认禁用。通过设置 `OTEL_ENABLED=true` 并配置 OTLP 端点来启用。每次工具调用都会自动捕获跟踪、指标（持续时间、负载大小）和错误。

## ▶️ 运行服务器

### 本地开发

- **构建并运行生产版本**：

  ```sh
  # 一次性构建
  pnpm run rebuild

  # 运行构建的服务器
  pnpm run start:http
  # 或
  pnpm run start:stdio
  ```

- **运行检查和测试**：
  ```sh
  pnpm run typecheck  # 类型检查
  pnpm run lint       # 代码检查
  pnpm run test       # 运行测试套件
  ```

### Cloudflare Workers

1.  **构建 Worker 包**：

```sh
pnpm run build
```

2.  **使用 Wrangler 本地运行**：

```sh
pnpm run deploy:dev
```

3.  **部署到 Cloudflare**：

```sh
pnpm run deploy:prod
```

> **注意**：`wrangler.toml` 文件已预配置以启用 `nodejs_compat` 以获得最佳结果。

## 📂 项目结构

| 目录                                   | 用途和内容                                                  | 指南                           |
| :------------------------------------- | :---------------------------------------------------------- | :----------------------------- |
| `src/mcp-server/tools/definitions`     | 您的工具定义（`*.tool.ts`）。这是您添加新功能的地方。       | [📖 MCP 指南](src/mcp-server/) |
| `src/mcp-server/resources/definitions` | 您的资源定义（`*.resource.ts`）。这是您添加新数据源的地方。 | [📖 MCP 指南](src/mcp-server/) |
| `src/mcp-server/transports`            | HTTP 和 STDIO 传输的实现，包括身份验证中间件。              | [📖 MCP 指南](src/mcp-server/) |
| `src/storage`                          | `StorageService` 抽象和所有存储提供者实现。                 | [💾 存储指南](src/storage/)    |
| `src/services`                         | 与外部服务的集成（例如，默认的 OpenRouter LLM 提供者）。    | [🔌 服务指南](src/services/)   |
| `src/container`                        | 依赖注入容器注册和令牌。                                    | [📦 容器指南](src/container/)  |
| `src/utils`                            | 用于日志记录、错误处理、性能、安全和遥测的核心工具。        |                                |
| `src/config`                           | 使用 Zod 进行环境变量解析和验证。                           |                                |
| `tests/`                               | 单元和集成测试，镜像 `src/` 目录结构。                      |                                |

## 📚 文档

每个主要模块都包含综合文档，包括架构图、使用示例和最佳实践：

### 核心模块

- **[MCP 服务器指南](src/mcp-server/)** - 构建 MCP 工具和资源的完整指南
  - 使用声明式定义创建工具
  - 使用 URI 模板进行资源开发
  - 身份验证和授权
  - 传输层（HTTP/stdio）配置
  - SDK 上下文和客户端交互
  - 响应格式化和错误处理

- **[容器指南](src/container/)** - 使用 tsyringe 进行依赖注入
  - 理解 DI 令牌和注册
  - 服务生命周期（单例、瞬态、实例）
  - 构造函数注入模式
  - 使用模拟依赖进行测试
  - 向容器添加新服务

- **[服务指南](src/services/)** - 外部服务集成模式
  - LLM 提供者集成（OpenRouter）
  - 语音服务（使用 ElevenLabs、Whisper 的 TTS/STT）
  - 图数据库操作（SurrealDB）
  - 创建自定义服务提供者
  - 健康检查和错误处理

- **[存储指南](src/storage/)** - 抽象化的持久层
  - 存储提供者实现
  - 多租户和租户隔离
  - 基于游标的安全分页
  - 批处理操作和 TTL 支持
  - 特定于提供者的设置指南

### 其他资源

- **[AGENTS.md](AGENTS.md)** - AI 代理的严格开发规则
- **[CHANGELOG.md](CHANGELOG.md)** - 版本历史和重大变更
- **[docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)** - 开发指南

## 🧑‍💻 代理开发指南

有关使用 AI 代理开发本项目的规则，请参阅 **`AGENTS.md`**。关键原则包括：

- **逻辑抛出，处理器捕获**：永远不要在工具/资源 `logic` 中使用 `try/catch`。而是抛出 `McpError`。
- **使用引导获取缺失输入**：如果工具需要用户输入但未提供，请使用 `SdkContext` 中的 `elicitInput` 函数向用户询问。
- **传递上下文**：始终通过调用堆栈传递 `RequestContext` 对象。
- **使用桶导出**：仅在 `index.ts` 桶文件中注册新工具和资源。

## ❓ 常见问题

- **这同时支持 STDIO 和 Streamable HTTP 吗？**
  - 是的。两种传输都是一等公民。使用 `pnpm run dev:stdio` 或 `pnpm run dev:http`。
- **我可以将其部署到边缘吗？**
  - 是的。本项目支持 Cloudflare Workers。运行 `pnpm run build` 后使用 `pnpm run deploy:dev` 或 `pnpm run deploy:prod` 部署。
- **我必须使用 OpenTelemetry 吗？**
  - 不，默认情况下它是禁用的。通过在 `.env` 文件中设置 `OTEL_ENABLED=true` 来启用它。

## 🤝 贡献

欢迎提交问题和拉取请求！如果您计划贡献，请在提交 PR 之前运行本地检查和测试。

```sh
pnpm run typecheck && pnpm run lint
pnpm run test
```

## 📜 许可证

本项目根据 Apache 2.0 许可证授权。有关详细信息，请参阅 [LICENSE](./LICENSE) 文件。

---

<div align="center">
  <p>
    <a href="https://github.com/Hbin-Zhuang/mcp-feishu-doc">项目仓库</a>
  </p>
</div>
