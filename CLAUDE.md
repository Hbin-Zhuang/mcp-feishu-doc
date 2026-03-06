# 代理协议与架构规范

**版本：** 2.4.7
**目标项目：** mcp-feishu-doc
**最后更新：** 2024-10-15

本文档定义了为此代码库做出贡献的操作规则。请严格遵循。

> **文件同步说明**：`AGENTS.md` 被符号链接到 CLAUDE.md 和 `.clinerules/AGENTS.md` 以保持一致性。仅编辑根 `AGENTS.md` 文件。您无权编辑、触碰或以任何方式更改 `CLAUDE.md` 或 `.clinerules/AGENTS.md` 文件。

> **开发者注意事项**：永远不要假设任何事情。在进行更改时，始终审查相关文件、搜索文档等。始终优先阅读完整文件内容以理解完整上下文。在阅读当前内容之前，永远不要尝试编辑文件。

---

## I. 核心原则（不可协商）

1.  **逻辑抛出，处理器捕获**
    - 在 `ToolDefinition`/`ResourceDefinition` `logic` 函数中实现纯无状态逻辑。逻辑中不使用 `try...catch`。
    - 失败时抛出 `new McpError(...)` 并附带适当的 `JsonRpcErrorCode`。
    - 处理器（`createMcpToolHandler`、`resourceHandlerFactory`）创建 `RequestContext`，测量执行时间，格式化响应，并捕获错误。

2.  **全栈可观测性**
    - OpenTelemetry 已预配置。日志/错误自动关联到跟踪。`measureToolExecution` 记录持续时间、成功状态、负载大小、错误代码。
    - 无需手动检测。使用提供的工具和结构化日志记录。不要直接调用 console - 使用我们的 logger。

3.  **结构化、可跟踪的操作**
    - 逻辑接收 `appContext`（日志记录/跟踪）和 `sdkContext`（引导、采样、根操作）。
    - 通过调用堆栈传递相同的 `appContext`。在每个日志中使用带有 `appContext` 的全局 `logger`。

4.  **解耦存储**
    - 永远不要直接访问持久化后端。始终使用 DI 注入的 `StorageService`。
    - `StorageService` 提供内置验证、不透明游标分页和并行批处理操作。
    - 所有输入（租户 ID、密钥、前缀）在到达提供者之前都会经过验证。

5.  **本地 ↔ 边缘运行时对等**
    - 所有功能都适用于本地传输（`stdio`/`http`）和 Worker 包（`build:worker` + `wrangler`）。
    - 保护不可移植的依赖。优先使用运行时无关的抽象（Hono + `@hono/mcp`、Fetch API）。

6.  **使用引导获取缺失输入**
    - 对缺失的参数使用 `sdkContext.elicitInput()`。参见现有工具中的引导实现。

---

## II. 架构概述与目录结构

> **📁 仓库结构参考**：有关代码库的完整可视化树，请参阅 [docs/tree.md](docs/tree.md)。这将帮助您了解完整的目录布局以及放置代码的位置。
>
> **⚠️ 架构纪律**：始终尊重已建立的目录结构。新服务放在 `src/services/`，新工具放在 `src/mcp-server/tools/definitions/` 等。不要创建顶级目录或将代码放在非标准位置。

关注点分离直接映射到文件系统。始终将文件放在其指定位置。

| 目录                                        | 用途与指导                                                                                                                                                                                                                  |
| :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`src/mcp-server/tools/definitions/`**     | **MCP 工具定义。** 在此处添加新功能，文件名为 `[tool-name].tool.ts`。遵循 **工具开发工作流程**。                                                                                                                            |
| **`src/mcp-server/resources/definitions/`** | **MCP 资源定义。** 添加数据源或上下文，文件名为 `[resource-name].resource.ts`。遵循 **资源开发工作流程**。                                                                                                                  |
| **`src/mcp-server/tools/utils/`**           | **共享工具实用程序：** 核心工具基础设施（`ToolDefinition`、`toolHandlerFactory`）                                                                                                                                           |
| **`src/mcp-server/resources/utils/`**       | **共享资源实用程序，** 包括 `ResourceDefinition` 和资源处理器工厂。                                                                                                                                                         |
| **`src/mcp-server/tasks/`**                 | **Tasks API 基础设施（实验性）。** 包含 `TaskManager`、`TaskToolDefinition` 和来自 SDK 的类型重新导出。任务工具定义放在 `tools/definitions/` 中，后缀为 `.task-tool.ts`。                                                   |
| **`src/mcp-server/transports/`**            | **传输实现：**<br>- `http/`（Hono + `@hono/mcp` Streamable HTTP）<br>- `stdio/`（MCP 规范 stdio 传输）<br>- `auth/`（策略和辅助函数）。HTTP 模式可以强制执行 JWT 或 OAuth。Stdio 模式不应实现基于 HTTP 的身份验证。         |
| **`src/services/`**                         | **外部服务集成** 遵循一致的领域驱动模式：<br>- 每个服务域（例如，`llm/`、`speech/`）包含：`core/`（接口、编排器）、`providers/`（实现）、`types.ts` 和 `index.ts`<br>- 对所有服务依赖使用 DI。参见下面的 **服务开发模式**。 |
| **`src/storage/`**                          | **抽象和提供者实现**（内存、文件系统、supabase、surrealdb、cloudflare-r2、cloudflare-kv）。                                                                                                                                 |
| **`src/container/`**                        | **依赖注入（`tsyringe`）。** 服务注册和令牌。                                                                                                                                                                               |
| **`src/utils/`**                            | **全局实用程序。** 包括日志记录、性能、解析、网络、安全、格式化和遥测。注意：错误处理模块位于 `src/utils/internal/error-handler/`。                                                                                         |
| **`tests/`**                                | **单元/集成测试。** 镜像 `src/` 以便于导航，包括合规性套件。                                                                                                                                                                |

---

## III. 架构理念：实用的 SOLID

- **单一职责：** 将一起更改的代码分组。
- **开闭原则：** 优先通过抽象（接口、插件/中间件）进行扩展。
- **里氏替换：** 子类型必须可以替换而不会产生意外。
- **接口隔离：** 保持接口小而专注。
- **依赖倒置：** 依赖于抽象（DI 管理的服务）。

**补充原则：**

- **KISS：** 优先简单性。
- **YAGNI：** 不要构建您还不需要的东西。
- **组合优于继承：** 优先使用可组合的模块。

---

## IV. 工具和资源开发工作流程

**通用步骤（工具和资源）：**

1. **文件位置**
   - **工具：** `src/mcp-server/tools/definitions/[tool-name].tool.ts`（示例：`feishu-auth-url.tool.ts`）
   - **资源：** `src/mcp-server/resources/definitions/[resource-name].resource.ts`（模板：`echo.resource.ts`）

2. **定义 ToolDefinition 或 ResourceDefinition**
   - 导出类型为 `ToolDefinition<InputSchema, OutputSchema>` 或 `ResourceDefinition<ParamsSchema, OutputSchema>` 的单个 `const`，包含：
     - `name`、`title`（可选）、`description`：清晰的面向 LLM 的描述
     - **工具：** `inputSchema`/`outputSchema` 作为 `z.object()`。**所有字段都需要 `.describe()`**。
     - **资源：** `paramsSchema`/`outputSchema`、`uriTemplate`、`mimeType`（可选）、`examples`（可选）、`list()`（可选）
     - `logic`：纯业务逻辑函数。不使用 `try/catch`。失败时抛出 `McpError`。
       - **工具：** `async (input, appContext, sdkContext) => { ... }`
       - **资源：** `(uri, params, context) => { ... }`（可以是 `async`）
     - `annotations`（可选）：UI 提示（`readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`）
     - `responseFormatter`（可选）：将结果映射到 `ContentBlock[]`。默认：JSON 字符串。

3. **应用授权**
   - 使用 `withToolAuth` 或 `withResourceAuth` 包装 `logic`：
     ```ts
     import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
     logic: withToolAuth(['tool:echo:read'], yourLogic),
     ```

4. **通过桶导出注册**
   - **工具：** 添加到 `src/mcp-server/tools/definitions/index.ts` → `allToolDefinitions`
   - **资源：** 添加到 `src/mcp-server/resources/definitions/index.ts` → `allResourceDefinitions`

**资源特定说明：**

- 资源使用 `uriTemplate`（例如，`echo://{message}`）、`paramsSchema` 和可选的 `list()` 进行发现
- 逻辑签名：`(uri: URL, params, context) => result`（可以是 `async`）
- 参见 `echo.resource.ts` 和章节 IV.A 获取完整示例

**资源分页：** 返回大型列表的资源必须按照 [MCP 规范 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/utils/pagination) 实现分页。使用来自 `@/utils/index.js` 的 `extractCursor(meta)`、`paginateArray(...)`。存储提供者：使用来自 `@/storage/core/storageValidation.js` 的 `encodeCursor`/`decodeCursor` 用于租户绑定的游标。游标是不透明的；无效游标 → `JsonRpcErrorCode.InvalidParams` (-32602)。仅当存在更多结果时才包含 `nextCursor`。

---

## IV.A. 快速开始：创建您的第一个工具

- [ ] **1. 研究示例：** [feishu-auth-url.tool.ts](src/mcp-server/tools/definitions/feishu-auth-url.tool.ts) — 理解：元数据 → 模式 → 逻辑 → 导出
- [ ] **2. 创建文件：** `src/mcp-server/tools/definitions/[your-tool-name].tool.ts`（kebab-case）
- [ ] **3. 定义元数据：** `TOOL_NAME`（snake_case）、`TOOL_TITLE`、`TOOL_DESCRIPTION`（面向 LLM）、`TOOL_ANNOTATIONS`（readOnly/idempotent 提示）
- [ ] **4. 创建模式：** `InputSchema`/`OutputSchema` 作为 `z.object()` — **关键：** 所有字段都需要 `.describe()`
- [ ] **5. 实现逻辑：** 纯函数 `async (input, appContext, sdkContext) => result` — 不使用 try/catch，失败时抛出 `McpError`
- [ ] **6. （可选）响应格式化器：** `(result) => ContentBlock[]`
- [ ] **7. 应用身份验证：** 使用 `withToolAuth(['tool:name:read'], yourLogic)` 包装
- [ ] **8. 导出 ToolDefinition：** 组合元数据、模式、逻辑、格式化器
- [ ] **9. 注册：** 添加到 [index.ts](src/mcp-server/tools/definitions/index.ts) 中的 `allToolDefinitions`
- [ ] **10. 质量检查：** `pnpm run typecheck && pnpm run lint`
- [ ] **11. 测试：** `pnpm run dev:stdio` 或 `pnpm run dev:http`，使用 MCP 客户端验证

参见章节 IV 获取完整工作流程，章节 XIV 获取全面检查清单。

---

## IV.B. 快速开始：创建任务工具（实验性）

任务工具使用 MCP Tasks API 启用长时间运行的异步操作。它们遵循"立即调用，稍后获取"模式，客户端可以轮询状态并在完成后检索结果。

> **注意：** Tasks API 是实验性的（SDK 1.24+），可能会在没有通知的情况下更改。

- [ ] **1. 研究示例：** 参考 `src/mcp-server/tasks/` 中的 TaskToolDefinition 实现
- [ ] **2. 创建文件：** `src/mcp-server/tools/definitions/[name].task-tool.ts`（注意：`.task-tool.ts` 后缀）
- [ ] **3. 定义模式：** `InputSchema` 和可选的 `OutputSchema`
- [ ] **4. 实现任务处理器：**
  ```typescript
  taskHandlers: {
    createTask: async (args, extra) => {
      const task = await extra.taskStore.createTask({ ttl: 120000, pollInterval: 1000 });
      startBackgroundWork(task.taskId, args, extra.taskStore);
      return { task };
    },
    getTask: async (_args, extra) => {
      return await extra.taskStore.getTask(extra.taskId);
    },
    getTaskResult: async (_args, extra) => {
      return await extra.taskStore.getTaskResult(extra.taskId) as CallToolResult;
    }
  }
  ```
- [ ] **5. 设置执行模式：** `execution: { taskSupport: 'required' }` 或 `'optional'`
- [ ] **6. 导出为 `TaskToolDefinition`：** 从 `@/mcp-server/tasks/index.js` 导入
- [ ] **7. 注册：** 添加到 [index.ts](src/mcp-server/tools/definitions/index.ts) 中的 `allToolDefinitions`

**关键概念：**

- `RequestTaskStore` 提供 `createTask`、`getTask`、`storeTaskResult`、`getTaskResult`、`updateTaskStatus`
- 后台工作通过 `taskStore.updateTaskStatus(taskId, 'working', 'message...')` 更新状态
- 终端状态：`completed`、`failed`、`cancelled` — 使用 `storeTaskResult` 完成
- 任务工具由 `isTaskToolDefinition()` 自动检测，并通过 `server.experimental.tasks.registerToolTask()` 注册

---

## V. 服务开发模式

> **所有服务：** `src/services/[service-name]/` 包含 `core/`（接口）、`providers/`（实现）、`types.ts`、`index.ts`。参见 [docs/tree.md](docs/tree.md)。

**模式：** 单提供者（例如，LLM）→ 直接 DI `@inject(LlmProvider)`。多提供者（例如，Speech）→ 创建编排器进行路由/聚合。

**提供者要求：** 实现 `I<Service>Provider`、`@injectable()`、`healthCheck()`，失败时抛出 `McpError`，命名为 `<name>.provider.ts`（kebab-case）。

**添加服务：** 目录结构 → 接口 → 提供者 → 类型 → 桶导出 → DI 令牌（`tokens.ts`）→ 注册（`registrations/core.ts`）

---

## VI. 核心服务与实用程序

#### DI 管理的服务（`src/container/tokens.ts` 中的令牌）

| 服务             | 令牌                    | 用法                                                                    | 说明                    |
| ---------------- | ----------------------- | ----------------------------------------------------------------------- | ----------------------- |
| `ILlmProvider`   | `LlmProvider`           | `@inject(LlmProvider) private llmProvider: ILlmProvider`                |                         |
| `IGraphProvider` | `GraphProvider`         | `@inject(GraphProvider) private graphProvider: IGraphProvider`          | 仅在使用图功能时        |
| `StorageService` | `StorageService`        | `@inject(StorageService) private storage: StorageService`               | 需要 `context.tenantId` |
| `RateLimiter`    | `RateLimiterService`    | `@inject(RateLimiterService) private rateLimiter: RateLimiter`          |                         |
| `Logger`         | `Logger`                | `@inject(Logger) private logger: typeof logger`                         | 基于 Pino 的单例        |
| 应用配置         | `AppConfig`             | `@inject(AppConfig) private config: typeof configModule`                |                         |
| Supabase 客户端  | `SupabaseAdminClient`   | `@inject(SupabaseAdminClient) private client: SupabaseClient<Database>` | 仅在需要时              |
| SurrealDB 客户端 | `SurrealdbClient`       | `@inject(SurrealdbClient) private client: Surreal`                      | 仅在需要时              |
| 传输管理器       | `TransportManagerToken` | `@inject(TransportManagerToken) private tm: TransportManager`           |                         |

**图服务：** 通过 SurrealDB 进行图操作（关系、遍历、路径查找）。注入 `IGraphProvider`。操作：`relate()`、`unrelate()`、`traverse()`、`shortestPath()`、`get{Outgoing|Incoming}Edges()`、`pathExists()`。

**存储：** `STORAGE_PROVIDER_TYPE` = `in-memory` | `filesystem` | `supabase` | `surrealdb` | `cloudflare-r2/kv`。使用 DI 注入的 `StorageService`。功能：输入验证、并行批处理操作（`getMany/setMany/deleteMany`）、安全的租户绑定分页、TTL 支持。参见 [存储文档](src/storage/README.md)。SurrealDB：通过 `docs/surrealdb-schema.surql` 初始化架构。

#### 直接导入的实用程序（`src/utils/`）

- 从 `@/utils/index.js` 导入：`logger`、`requestContextService`、`sanitization`、`fetchWithTimeout`、`measureToolExecution`、`pdfParser`、`frontmatterParser`、`markdown()`、`diffFormatter`、`tableFormatter`、`treeFormatter`
- `ErrorHandler.tryCatch`（用于服务/设置代码，不用于工具/资源逻辑）

**响应格式化器：** 简单：`[{ type: 'text', text: lines.join('\n') }]`。复杂：`markdown()` 辅助函数、`diffFormatter`、`tableFormatter`、`treeFormatter`（参见飞书工具实现）

#### 实用程序模块（`src/utils/`）

| 模块          | 主要导出                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `parsing/`    | `csvParser`、`yamlParser`、`xmlParser`、`jsonParser`、`pdfParser`、`frontmatterParser`（处理 LLM `<think>` 块） |
| `formatting/` | `MarkdownBuilder`、`markdown()` 辅助函数、`diffFormatter`、`tableFormatter`、`treeFormatter`                    |
| `security/`   | `sanitization`、`rateLimiter`、`idGenerator`                                                                    |
| `network/`    | `fetchWithTimeout`                                                                                              |
| `scheduling/` | `scheduler`（node-cron 包装器）                                                                                 |
| `internal/`   | `logger`、`requestContextService`、`ErrorHandler`、`performance`                                                |
| `telemetry/`  | OpenTelemetry 检测                                                                                              |

---

## VII. 身份验证与授权

**HTTP：** `MCP_AUTH_MODE` = `none` | `jwt` | `oauth`。JWT：本地密钥（`MCP_AUTH_SECRET_KEY`），如果缺失则开发模式绕过。OAuth：JWKS 验证（`OAUTH_ISSUER_URL`、`OAUTH_AUDIENCE`，可选 `OAUTH_JWKS_URI`）。声明：`clientId`（cid/client_id）、`scopes`（scp/scope）、`sub`、`tenantId`（tid → context.tenantId）。使用 `withToolAuth`/`withResourceAuth` 包装逻辑（如果禁用身份验证，则允许默认值）。

**STDIO：** 无 HTTP 身份验证。主机处理授权。

**端点：** `/healthz`、`GET /mcp` 不受保护。启用身份验证时，`POST`/`OPTIONS /mcp` 受保护。CORS：`MCP_ALLOWED_ORIGINS` 或 `*`。

---

## VIII. 传输与服务器生命周期

**`createMcpServerInstance`**（`server.ts`）：初始化上下文，创建具有功能（日志记录、listChanged、引导、采样、提示、根）的服务器，通过 DI 注册。**`TransportManager`**（`transports/manager.ts`）：解析工厂，实例化传输，处理生命周期。**Worker**（`worker.ts`）：Cloudflare 适配器，`serverless` 标志。

---

## IX. 代码风格、验证和安全

**JSDoc：** 需要 `@fileoverview`、`@module`。**验证：** Zod 模式，所有字段都需要 `.describe()`。**日志记录：** 包含 `RequestContext`，使用 `logger.{debug|info|notice|warning|error|crit|emerg}`。**错误：** 逻辑抛出 `McpError`，处理器捕获。`ErrorHandler.tryCatch` 仅用于服务。**密钥：** 仅在 `src/config/index.ts` 中。**速率限制：** DI 注入的 `RateLimiter`。**遥测：** 自动初始化，无手动跨度。

---

## IX.A. Git 提交消息

**关键：** 创建 git 提交时，永远不要在提交消息中使用 heredoc 语法（`cat <<'EOF'`）或命令替换（`$(...)`）。仅使用纯字符串。

**正确：**

```bash
git commit -m "feat(auth): add JWT validation middleware

- Implemented token verification with exp claim validation
- Added support for RS256 and HS256 algorithms
- Includes comprehensive error handling"
```

**错误 - 永远不要这样做：**

```bash
# ❌ 错误 - 不要使用 cat/heredoc/命令替换
git commit -m "$(cat <<'EOF'
feat(auth): add JWT validation
EOF
)"
```

**Conventional Commits 格式：** 使用 [Conventional Commits](https://www.conventionalcommits.org/) 标准：

- `feat(scope): description` - 新功能
- `fix(scope): description` - 错误修复
- `refactor(scope): description` - 代码重构
- `chore(scope): description` - 维护任务（依赖、配置等）
- `docs(scope): description` - 文档更新
- `test(scope): description` - 测试添加或更新
- `build(scope): description` - 构建系统或依赖更改

**原子提交：** 将相关更改分组在一起。使用 `filesToStage` 参数精确控制每个提交中包含的文件。

---

## X. 检查与工作流程命令

| 命令                         | 用途                     |
| ---------------------------- | ------------------------ |
| `pnpm run rebuild`           | 清理并重建（依赖更改后） |
| `pnpm run typecheck`         | TypeScript 类型检查      |
| `pnpm run lint`              | ESLint 代码检查          |
| `pnpm run test`              | 单元/集成测试            |
| `pnpm run dev:stdio/http`    | 开发模式                 |
| `pnpm run start:stdio/http`  | 生产模式（构建后）       |
| `pnpm run build`             | 生产构建                 |

---

## XI. 配置与环境

所有配置通过 `src/config/index.ts` 中的 Zod 进行验证。从 `package.json` 派生 `serviceName`/`version`。

| 类别         | 关键变量                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| **传输**     | `MCP_TRANSPORT_TYPE`（`stdio`\|`http`）、`MCP_HTTP_PORT/HOST/PATH`                                               |
| **身份验证** | `MCP_AUTH_MODE`（`none`\|`jwt`\|`oauth`）、`MCP_AUTH_SECRET_KEY`、`OAUTH_*`                                      |
| **存储**     | `STORAGE_PROVIDER_TYPE`（`in-memory`\|`filesystem`\|`supabase`\|`surrealdb`\|`cloudflare-r2/kv`）、`SURREALDB_*` |
| **LLM**      | `OPENROUTER_API_KEY`、`OPENROUTER_APP_URL/NAME`、`LLM_DEFAULT_*`                                                 |
| **遥测**     | `OTEL_ENABLED`、`OTEL_SERVICE_NAME/VERSION`、`OTEL_EXPORTER_OTLP_*`                                              |

---

## XII. 本地与边缘目标

**本地对等：** stdio/HTTP 传输工作方式相同。**Worker：** `build:worker` + `wrangler dev --local` 必须成功。**wrangler.toml：** `compatibility_date` ≥ `2025-09-01`、`nodejs_compat`。

---

## XIII. 多租户与存储上下文

**`StorageService` 需要 `context.tenantId`**（如果缺失则抛出）。**验证：** 最多 128 个字符，仅字母数字/连字符/下划线/点，开始/结束为字母数字，无路径遍历（`../`），无连续点。

**带身份验证的 HTTP：** `tenantId` 从 JWT `'tid'` 声明自动提取 → 通过 `requestContextService.withAuthInfo(authInfo)` 传播。上下文包括：`{ requestId, timestamp, tenantId, auth: { sub, clientId, scopes, token, tenantId } }`。

**STDIO：** 通过 `requestContextService.createRequestContext({ operation, tenantId })` 显式设置租户。

---

## XIV. 快速检查清单

- [ ] 在 `*.tool.ts`/`*.resource.ts` 中实现纯逻辑（不使用 `try...catch`，抛出 `McpError`）
- [ ] 使用 `withToolAuth`/`withResourceAuth` 应用身份验证
- [ ] 使用带有 `appContext` 的 `logger`，使用 `StorageService`（DI）进行持久化
- [ ] 使用 `sdkContext.elicitInput()`/`createMessage()` 进行客户端交互
- [ ] 在 `index.ts` 桶中注册
- [ ] 添加/更新测试（`pnpm run test`）
- [ ] **运行 `pnpm run typecheck && pnpm run lint`**（类型检查、代码检查）
- [ ] 本地传输冒烟测试（`pnpm run dev:stdio`/`dev:http`）
- [ ] 构建并验证（`pnpm run build`）

请严格遵循本文档。
