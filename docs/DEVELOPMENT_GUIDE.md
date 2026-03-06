# mcp-feishu-doc 开发指南

本文档提供 mcp-feishu-doc 项目开发的核心规范和示例。

## 目录结构

```
src/
├── config/                 # 配置管理
├── container/              # 依赖注入容器
├── mcp-server/
│   ├── server.ts           # MCP 服务器实例
│   ├── tools/              # 工具定义
│   │   ├── definitions/    # 工具实现文件
│   │   ├── tool-registration.ts
│   │   └── utils/          # 工具工厂和类型
│   ├── resources/          # 资源定义
│   └── transports/         # 传输层 (stdio/http)
├── storage/                # 存储抽象层
├── types-global/           # 全局类型定义
└── utils/                  # 工具函数
```

## 核心开发模式

### 1. 创建新工具

在 `src/mcp-server/tools/definitions/` 目录下创建 `[tool-name].tool.ts` 文件：

```typescript
/**
 * @fileoverview 工具描述
 * @module src/mcp-server/tools/definitions/my-tool.tool
 */
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type {
  SdkContext,
  ToolAnnotations,
  ToolDefinition,
} from '@/mcp-server/tools/utils/index.js';
import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';
import { type RequestContext, logger } from '@/utils/index.js';

// ============================================================================
// 元数据定义
// ============================================================================

/** 工具名称 (snake_case，必须唯一) */
const TOOL_NAME = 'my_tool_name';

/** 人类可读的标题 */
const TOOL_TITLE = 'My Tool Title';

/** LLM 可见的描述 (1-2 句话) */
const TOOL_DESCRIPTION = '工具功能的简短描述。';

/** UI/行为提示 */
const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,      // 是否只读
  idempotentHint: true,    // 是否幂等
  openWorldHint: false,    // 是否访问外部系统
};

// ============================================================================
// Schema 定义 (所有字段必须有 .describe())
// ============================================================================

const InputSchema = z.object({
  param1: z.string().describe('参数1的描述'),
  param2: z.number().optional().describe('可选参数2的描述'),
}).describe('工具输入参数');

const OutputSchema = z.object({
  result: z.string().describe('结果字段描述'),
  timestamp: z.string().datetime().describe('时间戳'),
}).describe('工具输出结构');

type MyToolInput = z.infer<typeof InputSchema>;
type MyToolOutput = z.infer<typeof OutputSchema>;

// ============================================================================
// 业务逻辑 (纯函数，不使用 try/catch，失败时抛出 McpError)
// ============================================================================

async function myToolLogic(
  input: MyToolInput,
  appContext: RequestContext,
  _sdkContext: SdkContext,
): Promise<MyToolOutput> {
  logger.debug('Processing my tool logic.', {
    ...appContext,
    toolInput: input,
  });

  // 业务逻辑实现
  // 失败时抛出 McpError：
  // throw new McpError(JsonRpcErrorCode.ValidationError, '错误信息', { requestId: appContext.requestId });

  return {
    result: `处理结果: ${input.param1}`,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// 响应格式化 (可选)
// ============================================================================

function responseFormatter(result: MyToolOutput): ContentBlock[] {
  return [{ type: 'text', text: `结果: ${result.result}` }];
}

// ============================================================================
// 导出工具定义
// ============================================================================

export const myTool: ToolDefinition<typeof InputSchema, typeof OutputSchema> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(['tool:my_tool:read'], myToolLogic),
  responseFormatter,
};
```

### 2. 注册工具

在 `src/mcp-server/tools/definitions/index.ts` 中添加：

```typescript
import { myTool } from './my-tool.tool.js';

export const allToolDefinitions = [
  // ... 其他工具
  myTool,
];
```

### 3. 创建新资源

在 `src/mcp-server/resources/definitions/` 目录下创建 `[resource-name].resource.ts`：

```typescript
import { z } from 'zod';
import { type RequestContext, logger } from '@/utils/index.js';
import { withResourceAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
import { type ResourceDefinition } from '@/mcp-server/resources/utils/resourceDefinition.js';

const ParamsSchema = z.object({
  id: z.string().describe('资源 ID'),
}).describe('资源参数');

const OutputSchema = z.object({
  data: z.string().describe('资源数据'),
}).describe('资源输出');

function myResourceLogic(
  uri: URL,
  params: z.infer<typeof ParamsSchema>,
  context: RequestContext,
) {
  logger.debug('Processing resource', { ...context, uri: uri.href });
  return { data: `Resource data for ${params.id}` };
}

export const myResource: ResourceDefinition<typeof ParamsSchema, typeof OutputSchema> = {
  name: 'my-resource',
  title: 'My Resource',
  description: '资源描述',
  uriTemplate: 'myresource://{id}',
  paramsSchema: ParamsSchema,
  outputSchema: OutputSchema,
  mimeType: 'application/json',
  logic: withResourceAuth(['resource:my:read'], myResourceLogic),
};
```

## 核心原则

### 1. 逻辑抛出，处理器捕获

- 工具/资源的 `logic` 函数中**不使用 try/catch**
- 失败时抛出 `McpError`
- 处理器 (handler) 负责捕获和格式化错误

### 2. 结构化日志

```typescript
logger.debug('操作描述', {
  ...appContext,  // 包含 requestId, timestamp 等
  customField: value,
});
```

### 3. Schema 验证

- 所有 Zod schema 字段必须有 `.describe()`
- 输入输出都需要定义 schema

### 4. 授权包装

使用 `withToolAuth` 或 `withResourceAuth` 包装逻辑函数：

```typescript
logic: withToolAuth(['tool:name:action'], myLogic),
```

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式
npm run dev:stdio    # STDIO 传输
npm run dev:http     # HTTP 传输

# 构建和检查
npm run build        # 构建项目
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm run test         # 运行测试

# 生产模式
npm run start:stdio
npm run start:http

# 清理和重建
npm run clean        # 清理 dist 目录
npm run rebuild      # 清理并重新构建
```

## 环境变量

| 变量 | 说明 | 默认值 |
|-----|------|-------|
| `MCP_TRANSPORT_TYPE` | 传输类型 (`stdio`/`http`) | `stdio` |
| `MCP_HTTP_PORT` | HTTP 端口 | `3010` |
| `MCP_LOG_LEVEL` | 日志级别 | `info` |
| `MCP_AUTH_MODE` | 认证模式 (`none`/`jwt`/`oauth`) | `none` |
| `STORAGE_PROVIDER_TYPE` | 存储类型 | `in-memory` |

## 示例工具

参考 `src/mcp-server/tools/definitions/` 中的飞书工具实现创建新工具，例如：

1. **feishu_auth_url** - 生成 OAuth 授权链接，展示参数校验与 URL 构建
2. **feishu_upload_markdown** - 上传文档，展示外部 API 调用和错误处理
