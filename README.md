<div align="center">
  <h1>mcp-ts-template</h1>
  <p><b>用于构建模型上下文协议（MCP）服务器的生产级 TypeScript 模板。提供声明式工具/资源、强大的错误处理、依赖注入、简易身份验证、可选的 OpenTelemetry，以及对本地和边缘（Cloudflare Workers）运行时的优先支持。</b>
  <div>6 个工具 • 1 个资源 • 1 个提示</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-2.6.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![MCP Spec](https://img.shields.io/badge/MCP%20Spec-2025--06--18-8A2BE2.svg?style=flat-square)](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/changelog.mdx) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.24.3-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Status](https://img.shields.io/badge/Status-Stable-brightgreen.svg?style=flat-square)](https://github.com/cyanheads/mcp-ts-template/issues) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.2.21-blueviolet.svg?style=flat-square)](https://bun.sh/) [![Code Coverage](https://img.shields.io/badge/Coverage-76.12%25-brightgreen.svg?style=flat-square)](./coverage/index.html)

</div>

---

## ✨ 特性

- **声明式工具和资源**：在单个自包含文件中定义功能。框架处理注册和执行。
- **引导支持**：工具可以在执行期间交互式地提示用户输入缺失的参数，简化用户工作流程。
- **强大的错误处理**：统一的 `McpError` 系统确保整个服务器的一致、结构化错误响应。
- **可插拔身份验证**：通过零配置支持 `none`、`jwt` 或 `oauth` 模式来保护您的服务器。
- **抽象化存储**：在不更改业务逻辑的情况下交换存储后端（`in-memory`、`filesystem`、`Supabase`、`SurrealDB`、`Cloudflare D1/KV/R2`）。具有安全的不透明游标分页、并行批处理操作和全面的验证功能。
- **图数据库操作**：可选的图服务，用于关系管理、图遍历和路径查找算法（SurrealDB 提供者）。
- **全栈可观测性**：通过结构化日志记录（Pino）和可选的自动检测 OpenTelemetry 获取深度洞察，用于跟踪和指标。
- **依赖注入**：使用 `tsyringe` 构建，实现清晰、解耦和可测试的架构。
- **服务集成**：用于外部 API 的可插拔服务，包括 LLM 提供者（OpenRouter）、文本转语音（ElevenLabs）和图操作（SurrealDB）。
- **丰富的内置工具套件**：用于解析（PDF、YAML、CSV、frontmatter）、格式化（差异、表格、树、markdown）、调度、安全等的辅助工具。
- **边缘就绪**：编写一次代码，即可在本地机器或 Cloudflare Workers 边缘无缝运行。

## 🏗️ 架构

此模板遵循模块化、领域驱动的架构，具有清晰的关注点分离：

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

## 🛠️ 包含的功能

此模板包含可工作的示例，帮助您快速开始。

### 工具

| 工具                                | 描述                                                              |
| :---------------------------------- | :----------------------------------------------------------------------- |
| **`template_echo_message`**         | 回显消息，支持可选的格式化和重复。           |
| **`template_cat_fact`**             | 从外部 API 获取随机猫咪趣事。                          |
| **`template_madlibs_elicitation`**  | 通过询问单词来完成故事，演示引导功能。        |
| **`template_code_review_sampling`** | 使用 LLM 服务执行模拟代码审查。                 |
| **`template_image_test`**           | 返回一个测试图像作为 base64 编码的数据 URI。                       |
| **`template_async_countdown`**      | 使用异步倒计时器演示 MCP Tasks API（实验性）。 |

### 资源

| 资源   | URI                | 描述                                   |
| :--------- | :----------------- | :-------------------------------------------- |
| **`echo`** | `echo://{message}` | 一个简单的资源，回显消息。 |

### 提示

| 提示            | 描述                                                      |
| :---------------- | :--------------------------------------------------------------- |
| **`code-review`** | 用于指导 LLM 执行代码审查的结构化提示。 |

## 🚀 快速开始

### MCP 客户端设置/配置

将以下内容添加到您的 MCP 客户端配置文件（例如，`cline_mcp_settings.json`）。

```json
{
  "mcpServers": {
    "mcp-ts-template": {
      "type": "stdio",
      "command": "npx",
      "args": ["mcp-ts-template@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "STORAGE_PROVIDER_TYPE": "filesystem",
        "STORAGE_FILESYSTEM_PATH": "/path/to/your/storage"
      }
    }
  }
}
```

### 前置要求

- [Node.js v20.0.0](https://nodejs.org/) 或更高版本。

### 安装

1.  **克隆仓库：**

```sh
git clone https://github.com/cyanheads/mcp-ts-template.git
```

2.  **进入目录：**

```sh
cd mcp-ts-template
```

3.  **安装依赖：**

```sh
npm install
```

## ⚙️ 配置

所有配置都在 `src/config/index.ts` 中集中管理并在启动时验证。`.env` 文件中的关键环境变量包括：

| 变量                    | 描述                                                                                                             | 默认值     |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :---------- |
| `MCP_TRANSPORT_TYPE`        | 要使用的传输方式：`stdio` 或 `http`。                                                                                | `http`      |
| `MCP_HTTP_PORT`             | HTTP 服务器的端口。                                                                                           | `3010`      |
| `MCP_HTTP_HOST`             | HTTP 服务器的主机名。                                                                                       | `127.0.0.1` |
| `MCP_AUTH_MODE`             | 身份验证模式：`none`、`jwt` 或 `oauth`。                                                                         | `none`      |
| `MCP_AUTH_SECRET_KEY`       | **`jwt` 身份验证模式必需。** 32+ 字符的密钥。                                                               | `(none)`    |
| `OAUTH_ISSUER_URL`          | **`oauth` 身份验证模式必需。** OIDC 提供者的 URL。                                                           | `(none)`    |
| `STORAGE_PROVIDER_TYPE`     | 存储后端：`in-memory`、`filesystem`、`supabase`、`surrealdb`、`cloudflare-d1`、`cloudflare-kv`、`cloudflare-r2`。 | `in-memory` |
| `STORAGE_FILESYSTEM_PATH`   | **`filesystem` 存储必需。** 存储目录的路径。                                                   | `(none)`    |
| `SUPABASE_URL`              | **`supabase` 存储必需。** 您的 Supabase 项目 URL。                                                         | `(none)`    |
| `SUPABASE_SERVICE_ROLE_KEY` | **`supabase` 存储必需。** 您的 Supabase 服务角色密钥。                                                    | `(none)`    |
| `SURREALDB_URL`             | **`surrealdb` 存储必需。** SurrealDB 端点（例如，`wss://cloud.surrealdb.com/rpc`）。                       | `(none)`    |
| `SURREALDB_NAMESPACE`       | **`surrealdb` 存储必需。** SurrealDB 命名空间。                                                              | `(none)`    |
| `SURREALDB_DATABASE`        | **`surrealdb` 存储必需。** SurrealDB 数据库名称。                                                          | `(none)`    |
| `SURREALDB_USERNAME`        | **`surrealdb` 存储可选。** 用于身份验证的数据库用户名。                                             | `(none)`    |
| `SURREALDB_PASSWORD`        | **`surrealdb` 存储可选。** 用于身份验证的数据库密码。                                             | `(none)`    |
| `OTEL_ENABLED`              | 设置为 `true` 以启用 OpenTelemetry。                                                                                  | `false`     |
| `LOG_LEVEL`                 | 日志记录的最低级别（`debug`、`info`、`warn`、`error`）。                                                       | `info`      |
| `OPENROUTER_API_KEY`        | OpenRouter LLM 服务的 API 密钥。                                                                                     | `(none)`    |

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
  npm run rebuild

  # 运行构建的服务器
  npm run start:http
  # 或
  npm run start:stdio
  ```

- **运行检查和测试**：
  ```sh
  npm run typecheck  # 类型检查
  npm run lint       # 代码检查
  npm run test       # 运行测试套件
  ```

### Cloudflare Workers

1.  **构建 Worker 包**：

```sh
npm run build
```

2.  **使用 Wrangler 本地运行**：

```sh
npm run deploy:dev
```

3.  **部署到 Cloudflare**：

```sh
bun deploy:prod
```

> **注意**：`wrangler.toml` 文件已预配置以启用 `nodejs_compat` 以获得最佳结果。

## 📂 项目结构

| 目录                              | 用途和内容                                                                   | 指南                                |
| :------------------------------------- | :----------------------------------------------------------------------------------- | :----------------------------------- |
| `src/mcp-server/tools/definitions`     | 您的工具定义（`*.tool.ts`）。这是您添加新功能的地方。         | [📖 MCP 指南](src/mcp-server/)      |
| `src/mcp-server/resources/definitions` | 您的资源定义（`*.resource.ts`）。这是您添加新数据源的地方。 | [📖 MCP 指南](src/mcp-server/)      |
| `src/mcp-server/transports`            | HTTP 和 STDIO 传输的实现，包括身份验证中间件。            | [📖 MCP 指南](src/mcp-server/)      |
| `src/storage`                          | `StorageService` 抽象和所有存储提供者实现。           | [💾 存储指南](src/storage/)     |
| `src/services`                         | 与外部服务的集成（例如，默认的 OpenRouter LLM 提供者）。     | [🔌 服务指南](src/services/)   |
| `src/container`                        | 依赖注入容器注册和令牌。                             | [📦 容器指南](src/container/) |
| `src/utils`                            | 用于日志记录、错误处理、性能、安全和遥测的核心工具。    |                                      |
| `src/config`                           | 使用 Zod 进行环境变量解析和验证。                                |                                      |
| `tests/`                               | 单元和集成测试，镜像 `src/` 目录结构。                |                                      |

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
- **[docs/tree.md](docs/tree.md)** - 完整的可视化目录结构
- **[docs/publishing-mcp-server-registry.md](docs/publishing-mcp-server-registry.md)** - MCP 注册表发布指南

## 🧑‍💻 代理开发指南

有关在使用此模板与 AI 代理时的严格规则集，请参阅 **`AGENTS.md`**。关键原则包括：

- **逻辑抛出，处理器捕获**：永远不要在工具/资源 `logic` 中使用 `try/catch`。而是抛出 `McpError`。
- **使用引导获取缺失输入**：如果工具需要用户输入但未提供，请使用 `SdkContext` 中的 `elicitInput` 函数向用户询问。
- **传递上下文**：始终通过调用堆栈传递 `RequestContext` 对象。
- **使用桶导出**：仅在 `index.ts` 桶文件中注册新工具和资源。

## ❓ 常见问题

- **这同时支持 STDIO 和 Streamable HTTP 吗？**
  - 是的。两种传输都是一等公民。使用 `bun run dev:stdio` 或 `bun run dev:http`。
- **我可以将其部署到边缘吗？**
  - 是的。模板专为 Cloudflare Workers 设计。运行 `bun run build:worker` 并使用 Wrangler 部署。
- **我必须使用 OpenTelemetry 吗？**
  - 不，默认情况下它是禁用的。通过在 `.env` 文件中设置 `OTEL_ENABLED=true` 来启用它。
- **如何将我的服务器发布到 MCP 注册表？**
  - 按照 `docs/publishing-mcp-server-registry.md` 中的分步指南操作。

## 🤝 贡献

欢迎提交问题和拉取请求！如果您计划贡献，请在提交 PR 之前运行本地检查和测试。

```sh
bun run devcheck
bun test
```

## 📜 许可证

本项目根据 Apache 2.0 许可证授权。有关详细信息，请参阅 [LICENSE](./LICENSE) 文件。

---

<div align="center">
  <p>
    <a href="https://github.com/sponsors/cyanheads">赞助此项目</a> •
    <a href="https://www.buymeacoffee.com/cyanheads">请我喝咖啡</a>
  </p>
</div>