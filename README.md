<div align="center">
  <h1>mcp-feishu-doc</h1>
  <p><b>面向飞书云文档与知识库工作流的 MCP Server。</b></p>
  <p>支持 OAuth、多应用配置、Markdown 上传/读取/更新/删除、知识库定位、本地图片与附件处理，以及本地与 Cloudflare Workers 运行。</p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-2.6.7-blue.svg?style=flat-square)](./CHANGELOG.md)
[![MCP Spec](https://img.shields.io/badge/MCP%20Spec-2025--06--18-8A2BE2.svg?style=flat-square)](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/changelog.mdx)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.24.3-green.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.19.0-orange.svg?style=flat-square)](https://pnpm.io/)

</div>

---

## 3 分钟接入

如果你只是想在 MCP Client 里直接用已经发布到 npm 的版本，优先看这一节，不需要先 clone 仓库。

当前 npm 包名：

- `@hibson/mcp-feishu-doc`
- 当前仓库版本：`2.6.7`

### 先准备飞书应用

在配置 MCP Client 之前，先去 [飞书开放平台](https://open.feishu.cn) 创建一个自建应用。第一次接入最核心的是下面 4 个点：

1. 创建一个自建应用，拿到 `App ID` 和 `App Secret`
2. 在「安全设置」里添加重定向 URL：`http://localhost:3010/oauth/feishu/callback`
3. 在「权限管理」里开通最小权限集合
4. 如果你要操作知识库，再去目标 Wiki 里「添加文档应用」

建议开通的权限：

| 权限 | Scope | 作用 |
| :-- | :-- | :-- |
| 获取用户基本信息 | `contact:user.base:readonly` | 用于识别当前授权用户 |
| 读写飞书文档 | `docx:document` | 创建、读取、更新 Docx 文档 |
| 云空间 | `drive:drive` | Markdown 导入、媒体上传、文件夹列表 |
| 读写知识库 | `wiki:wiki` | 列知识库、移动到 Wiki、创建 Wiki 节点 |
| 离线访问 | `offline_access` | 获取 `refresh_token`，避免频繁重新授权 |

补充说明：

- 回调地址必须和 `FEISHU_OAUTH_CALLBACK_URL` 完全一致，路径必须是 `/oauth/feishu/callback`。
- 如果目标是知识库，除了开放平台里的 API 权限外，还需要在目标 Wiki 中手动「添加文档应用」，否则常见表现是 `feishu_list_wikis` 空列表、上传到 Wiki 时报 403。
- 某些租户里权限需要经过应用发布或管理员审批后才会真正生效。

### 再把 MCP 配到客户端

下面这段 `mcp.json` 可以直接复制。填上你自己的 `appId` / `appSecret` 后就能用。

适用于支持 `mcpServers` 配置的 MCP Client。

```json
{
  "mcpServers": {
    "mcp-feishu-doc": {
      "command": "npx",
      "args": ["-y", "@hibson/mcp-feishu-doc@latest"],
      "env": {
        "FEISHU_DEFAULT_APP_ID": "cli_your_app_id",
        "FEISHU_DEFAULT_APP_SECRET": "your_app_secret",
        "FEISHU_OAUTH_CALLBACK_URL": "http://localhost:3010/oauth/feishu/callback",
        "MCP_TRANSPORT_TYPE": "stdio",
        "LOGS_DIR": "~/.mcp-feishu-doc/logs",
        "STORAGE_PROVIDER_TYPE": "filesystem",
        "STORAGE_FILESYSTEM_PATH": "~/.mcp-feishu-doc/storage"
      }
    }
  }
}
```

建议：

- `STORAGE_PROVIDER_TYPE` 使用 `filesystem`，这样 OAuth 凭证、默认应用信息、文档元数据都能持久化。
- `STORAGE_FILESYSTEM_PATH` 和 `LOGS_DIR` 建议放到独立目录，便于排查授权、上传、读取问题。
- `FEISHU_OAUTH_CALLBACK_URL` 默认可以直接使用 `http://localhost:3010/oauth/feishu/callback`。
- 在 `stdio` 模式下，只要配置了 `FEISHU_OAUTH_CALLBACK_URL`，服务会自动拉起本地 OAuth 回调地址。

### 首次使用流程

1. 在飞书开放平台创建自建应用，并完成回调地址和权限配置。
2. 把上面的 `mcp.json` 配到你的 MCP Client。
3. 回填 `FEISHU_DEFAULT_APP_ID` 和 `FEISHU_DEFAULT_APP_SECRET`。
4. 启动客户端后先调用 `feishu_auth_url` 获取授权链接。
5. 浏览器完成授权回调后，再调用 `feishu_get_user_info` 或 `feishu_list_wikis` 验证是否可用。
6. 开始使用 `feishu_upload_markdown`、`feishu_get_document`、`feishu_update_document`。

### 最常用的几个工具

- `feishu_auth_url`：生成授权链接
- `feishu_upload_markdown`：上传 Markdown 到云文档或知识库
- `feishu_get_document`：读取文档正文、块结构和图片/附件资源
- `feishu_update_document`：更新已有文档，支持冲突检测
- `feishu_list_wikis` / `feishu_list_wiki_nodes`：定位知识库空间和节点

---

## 项目定位

`mcp-feishu-doc` 不是对飞书 OpenAPI 的简单直出，而是围绕“文档工作流”做的一层高阶封装。

它重点解决这三件事：

- 把本地 Markdown 稳定上传到飞书云文档或知识库，而不是只暴露底层导入接口。
- 读取文档时返回更适合 AI 消费的结构化结果，而不是只拿一段纯文本。
- 让文档在上传后还能持续维护，包括位置记忆、冲突检测、更新重建和多应用管理。

---

## 核心亮点

- 文档上传工作流完整：支持 `filePath` 或 `content`，支持上传到 `drive` 或 `wiki`，支持 `targetId` 和 `parentNodeToken`。
- Markdown 处理更强：支持 Front Matter、callout、wiki link、代码块过滤、任务列表、高亮、删除线等语法转换。
- 图片与附件能力完整：支持本地图片/附件上传，支持远程图片/附件下载转存，支持读取时回传媒体资源。
- 文档读取更适合 Agent：返回 `content + blocks + assets + revisionId`，保留图片/附件在正文中的顺序。
- 更新链路可落地：支持冲突检测、`force` 覆盖、原位置重建、修订号追踪。
- 本地调试友好：支持 `stdio`、`http`、MCP Inspector、本地 `mcp.json` 配置。
- 工程化完整：支持 DI、存储抽象、结构化日志、OpenTelemetry、单测和集成测试。

---

## 当前功能

### 文档工作流

- 上传 Markdown 到飞书文档或知识库
- 批量上传多个 Markdown 文档
- 读取飞书文档内容
- 更新已有飞书文档
- 删除飞书文档
- 搜索飞书文档

### 媒体能力

- 上传本地图片到文档
- 上传本地附件到文档
- 支持远程图片下载后转存
- 支持远程附件下载后转存
- 读取时返回图片和附件资源
- 读取时提供图片内联 / 本地文件两种交付方式

### 飞书管理能力

- OAuth 授权与回调处理
- 获取当前用户信息
- 多应用配置与默认应用切换
- 列出知识库空间
- 列出云空间文件夹
- 列出知识库节点

---

## 工具列表

当前共内置 15 个工具：

| 工具名 | 说明 |
| :-- | :-- |
| `feishu_auth_url` | 生成飞书 OAuth 2.0 授权链接 |
| `feishu_auth_callback` | 处理飞书 OAuth 授权回调 |
| `feishu_upload_markdown` | 上传 Markdown 文档到飞书云文档或知识库 |
| `feishu_update_document` | 更新已有飞书文档，支持冲突检测 |
| `feishu_batch_upload_markdown` | 批量上传多个 Markdown 文档 |
| `feishu_get_document` | 读取文档内容，返回文本、块结构和媒体资源 |
| `feishu_delete_document` | 删除飞书文档 |
| `feishu_search_documents` | 搜索飞书文档 |
| `feishu_list_folders` | 列出飞书云空间文件夹 |
| `feishu_list_wikis` | 列出飞书知识库空间 |
| `feishu_list_wiki_nodes` | 列出知识库节点 |
| `feishu_get_user_info` | 获取当前飞书用户信息 |
| `feishu_set_default_app` | 设置默认飞书应用 |
| `feishu_list_apps` | 列出已配置的飞书应用 |
| `feishu_add_app` | 添加新的飞书应用配置 |

工具注册入口见 [src/mcp-server/tools/definitions/index.ts](/Users/hibson/Documents/mcp-feishu-doc/src/mcp-server/tools/definitions/index.ts:1)。

---

## 典型使用场景

- 把本地 `README.md`、方案文档、周报、分享稿直接上传到飞书知识库
- 读取飞书文档后再做总结、改写、翻译或生成更新版本
- 将本地带图片的 Markdown 文档同步到飞书
- 在 AI Agent 中实现“生成文档 -> 上传 -> 读取 -> 更新”的闭环工作流
- 使用多个飞书应用账号切换不同环境或不同租户

---

## 快速开始

这一节主要面向本地开发、调试和二次开发。如果你只是要在客户端里直接用，请优先看前面的“3 分钟接入”。

### 前置要求

- [Node.js](https://nodejs.org/) `>= 20`
- [pnpm](https://pnpm.io/) `>= 10`

### 安装

```bash
git clone https://github.com/Hbin-Zhuang/mcp-feishu-doc.git
cd mcp-feishu-doc
pnpm install
```

### 配置环境变量

复制示例配置：

```bash
cp .env.example .env
```

最少需要确认这些字段：

- `MCP_TRANSPORT_TYPE`
- `MCP_HTTP_PORT`
- `STORAGE_PROVIDER_TYPE`
- `STORAGE_FILESYSTEM_PATH`
- `FEISHU_DEFAULT_APP_ID`
- `FEISHU_DEFAULT_APP_SECRET`
- `FEISHU_OAUTH_CALLBACK_URL`

推荐本地调试配置：

```env
MCP_TRANSPORT_TYPE=stdio
MCP_LOG_LEVEL=debug
STORAGE_PROVIDER_TYPE="filesystem"
STORAGE_FILESYSTEM_PATH="./.storage"
FEISHU_OAUTH_CALLBACK_URL=http://localhost:3010/oauth/feishu/callback
```

如果你要用 OAuth 网页回调，建议再起一个 `http` 模式实例，或者直接使用 `dev:http`。

---

## 本地快速调试

### 方式一：最快上手，用构建产物 + MCP Inspector

适合检查工具入参、快速点调、验证上传和读取。

```bash
pnpm run build
pnpm run inspector
```

说明：

- `pnpm run inspector` 会基于 `dist/index.js` 启动服务。
- 这也是为什么运行 Inspector 前要先执行一次 `pnpm run build`。
- 如果你刚改了源码但没重新 build，Inspector 里看到的还是旧逻辑。

### 方式二：源码热更新调试，适合本地开发

STDIO 模式：

```bash
pnpm run dev:stdio
```

HTTP 模式：

```bash
pnpm run dev:http
```

说明：

- `dev:stdio` 适合 MCP Client 或本地 SDK 客户端直接拉起。
- `dev:http` 适合调 OAuth 回调、HTTP 接入或浏览器调试。
- 两个命令都基于 `tsx watch src/index.ts`，改代码会自动重启。

### 方式三：本地 MCP Client 直接接入

仓库根目录自带一个示例配置文件 [mcp.json](/Users/hibson/Documents/mcp-feishu-doc/mcp.json:1)。

默认示例展示的是“直接使用 npm 已发布版本”的方式。如果你要在本地开发仓库源码，可以参考下面两个版本。

已发布版本：

```json
{
  "mcpServers": {
    "mcp-feishu-doc": {
      "command": "npx",
      "args": ["-y", "@hibson/mcp-feishu-doc@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "FEISHU_DEFAULT_APP_ID": "cli_your_app_id",
        "FEISHU_DEFAULT_APP_SECRET": "your_app_secret",
        "FEISHU_OAUTH_CALLBACK_URL": "http://localhost:3010/oauth/feishu/callback",
        "LOGS_DIR": "~/.mcp-feishu-doc/logs",
        "STORAGE_PROVIDER_TYPE": "filesystem",
        "STORAGE_FILESYSTEM_PATH": "~/.mcp-feishu-doc/storage"
      }
    }
  }
}
```

本地构建产物版本：

```json
{
  "mcpServers": {
    "mcp-feishu-doc-local": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "debug",
        "FEISHU_DEFAULT_APP_ID": "cli_your_app_id",
        "FEISHU_DEFAULT_APP_SECRET": "your_app_secret",
        "FEISHU_OAUTH_CALLBACK_URL": "http://localhost:3010/oauth/feishu/callback",
        "STORAGE_PROVIDER_TYPE": "filesystem",
        "STORAGE_FILESYSTEM_PATH": "./.storage"
      }
    }
  }
}
```

本地源码直连版本：

```json
{
  "mcpServers": {
    "mcp-feishu-doc-local-dev": {
      "command": "pnpm",
      "args": ["exec", "tsx", "src/index.ts"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "debug",
        "FEISHU_DEFAULT_APP_ID": "cli_your_app_id",
        "FEISHU_DEFAULT_APP_SECRET": "your_app_secret",
        "FEISHU_OAUTH_CALLBACK_URL": "http://localhost:3010/oauth/feishu/callback",
        "STORAGE_PROVIDER_TYPE": "filesystem",
        "STORAGE_FILESYSTEM_PATH": "./.storage"
      }
    }
  }
}
```

不同方式适用场景：

- `npx @hibson/mcp-feishu-doc@latest`：给最终用户接入，最省事。
- `node ./dist/index.js`：适合验证你当前仓库 build 出来的产物。
- `pnpm exec tsx src/index.ts`：适合本地开发调试，改完源码立即生效。

---

## 常用调试命令

```bash
pnpm run build                 # 构建 dist
pnpm run dev:stdio             # 源码热更新，STDIO
pnpm run dev:http              # 源码热更新，HTTP
pnpm run start:stdio           # 运行构建产物，STDIO
pnpm run start:http            # 运行构建产物，HTTP
pnpm run inspector             # 启动 MCP Inspector（依赖 dist）
pnpm run typecheck             # TypeScript 类型检查
pnpm run lint                  # ESLint 检查
pnpm run test                  # 单元测试
pnpm run test:integration:feishu # 飞书集成测试
```

---

## 推荐调试路径

### 调试工具入参与返回值

推荐：

```bash
pnpm run build
pnpm run inspector
```

### 调试 OAuth 或 HTTP 接口

推荐：

```bash
pnpm run dev:http
```

然后访问：

- `http://localhost:3010/oauth/feishu/auth`
- `http://localhost:3010/oauth/feishu/callback`

### 调试本地 MCP Client 接入

推荐：

- 使用 `mcp.json`
- 或把 `mcpServers` 配置复制到你的客户端配置文件

### 调试源码逻辑

推荐：

```bash
pnpm run dev:stdio
```

然后让本地 MCP Client 使用：

```json
"command": "pnpm",
"args": ["exec", "tsx", "src/index.ts"]
```

---

## 配置说明

所有配置在 [src/config/index.ts](/Users/hibson/Documents/mcp-feishu-doc/src/config/index.ts:1) 中统一解析并做 Zod 校验。

常用环境变量如下：

| 变量 | 说明 | 默认值 |
| :-- | :-- | :-- |
| `MCP_TRANSPORT_TYPE` | 传输方式，`stdio` 或 `http` | `stdio` |
| `MCP_HTTP_HOST` | HTTP 服务主机 | `127.0.0.1` |
| `MCP_HTTP_PORT` | HTTP 服务端口 | `3010` |
| `MCP_LOG_LEVEL` | 日志级别 | `debug` |
| `STORAGE_PROVIDER_TYPE` | 存储后端，推荐本地用 `filesystem` | `filesystem` |
| `STORAGE_FILESYSTEM_PATH` | 本地文件存储路径 | `./.storage` |
| `FEISHU_DEFAULT_APP_ID` | 默认飞书应用 ID | 无 |
| `FEISHU_DEFAULT_APP_SECRET` | 默认飞书应用密钥 | 无 |
| `FEISHU_OAUTH_CALLBACK_URL` | 飞书 OAuth 回调地址 | 无 |
| `OTEL_ENABLED` | 是否启用 OpenTelemetry | `false` |

> 注意：本地调试时推荐使用 `filesystem` 存储，否则 OAuth 凭证、文档元数据和默认应用信息不会持久保存。

---

## 当前上传 / 读取 / 更新能力

### 上传

- 支持 `filePath` 和 `content`
- 支持 `drive` / `wiki`
- 支持 `targetId` 和 `parentNodeToken`
- 支持 Markdown 预处理
- 支持本地图片与附件上传
- 支持远程图片与附件转存

### 读取

- 返回 `title`
- 返回近似 Markdown 的 `content`
- 返回保序的 `blocks`
- 返回 `assets`
- 返回 `revisionId`

### 更新

- 支持内容或文件路径更新
- 支持冲突检测
- 支持 `force` 强制覆盖
- 支持原位置重建
- 支持修订号追踪

---

## 架构概览

核心调用链如下：

```text
MCP Tool Definition
  -> FeishuService
    -> FeishuApiProvider
    -> MarkdownProcessorProvider
    -> StorageService
```

对应目录：

- `src/mcp-server/tools/definitions`：工具定义
- `src/services/feishu`：飞书服务编排与 API 调用
- `src/storage`：持久化与多后端抽象
- `src/container`：依赖注入
- `src/utils`：日志、性能、解析、遥测等横切能力

---

## 项目结构

| 目录 | 用途 |
| :-- | :-- |
| `src/mcp-server/tools/definitions` | MCP 工具定义 |
| `src/mcp-server/transports` | `stdio` / `http` 传输实现 |
| `src/services/feishu` | 飞书文档与知识库核心逻辑 |
| `src/storage` | 存储抽象和 Provider 实现 |
| `src/container` | 依赖注入配置 |
| `src/utils` | 日志、性能、解析、遥测 |
| `tests` | 单元测试与集成测试 |
| `docs` | 设计、开发与技术分享文档 |

---

## 测试与质量检查

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:integration:feishu
```

---

## 部署

### 本地运行构建产物

```bash
pnpm run build
pnpm run start:stdio
```

或：

```bash
pnpm run build
pnpm run start:http
```

### Cloudflare Workers

```bash
pnpm run deploy:dev
pnpm run deploy:prod
```

---

## 相关文档

- [AGENTS.md](/Users/hibson/Documents/mcp-feishu-doc/AGENTS.md)
- [docs/DEVELOPMENT_GUIDE.md](/Users/hibson/Documents/mcp-feishu-doc/docs/DEVELOPMENT_GUIDE.md)
- [src/mcp-server/README.md](/Users/hibson/Documents/mcp-feishu-doc/src/mcp-server/README.md)
- [src/storage/README.md](/Users/hibson/Documents/mcp-feishu-doc/src/storage/README.md)

---

## 许可证

本项目基于 Apache 2.0 许可证发布，详见 [LICENSE](/Users/hibson/Documents/mcp-feishu-doc/LICENSE)。
