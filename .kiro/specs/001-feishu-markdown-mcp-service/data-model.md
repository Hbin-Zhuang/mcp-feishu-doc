# 飞书 Markdown MCP 服务数据模型

本文档定义了飞书 Markdown MCP 服务的数据模型和 Markdown 转换规则。

## 核心类型定义

### MarkdownDocument

表示待上传的 Markdown 文档。

```typescript
interface MarkdownDocument {
  /** 文档内容 */
  content: string;
  /** 文档标题（可选，从 Front Matter 或文件名提取） */
  title?: string;
  /** 文件路径（可选） */
  filePath?: string;
  /** 工作目录（用于解析相对路径） */
  workingDirectory?: string;
}
```

### UploadConfig

上传配置选项。

```typescript
interface UploadConfig {
  /** 目标类型：云空间或知识库 */
  targetType: 'drive' | 'wiki';
  /** 目标位置 ID（文件夹 ID 或知识库空间 ID） */
  targetId?: string;
  /** 飞书应用 ID */
  appId?: string;
  /** 是否上传图片 */
  uploadImages?: boolean;
  /** 是否上传附件 */
  uploadAttachments?: boolean;
  /** 是否移除 Front Matter */
  removeFrontMatter?: boolean;
  /** 代码块过滤语言列表 */
  codeBlockFilterLanguages?: string[];
}
```

### UploadResult

上传结果。

```typescript
interface UploadResult {
  /** 是否成功 */
  success: boolean;
  /** 飞书文档 ID */
  documentId?: string;
  /** 文档访问 URL */
  url?: string;
  /** 文档标题 */
  title?: string;
  /** 已上传的文件列表 */
  uploadedFiles?: UploadedFile[];
  /** 错误信息 */
  error?: string;
  /** 是否检测到冲突 */
  conflictDetected?: boolean;
}
```

### FeishuAuth

飞书认证信息。

```typescript
interface FeishuAuth {
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 令牌过期时间戳 */
  expiresAt: number;
}

interface StoredFeishuAuth extends FeishuAuth {
  /** 应用 ID */
  appId: string;
  /** 应用密钥（加密存储） */
  appSecret: string;
  /** 用户信息 */
  userInfo?: FeishuUserInfo;
}
```

### FeishuUserInfo

飞书用户信息。

```typescript
interface FeishuUserInfo {
  /** 用户 ID */
  userId: string;
  /** 用户名称 */
  name: string;
  /** 用户邮箱 */
  email?: string;
  /** 用户头像 URL */
  avatarUrl?: string;
}
```

## 存储结构

### OAuth Tokens

存储键：`feishu:auth:{appId}`

```typescript
{
  appId: string;
  appSecret: string;  // 加密存储
  accessToken: string;  // 加密存储
  refreshToken: string;  // 加密存储
  expiresAt: number;
  userInfo?: {
    userId: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  }
}
```

### 文档元数据

存储键：`feishu:doc:{documentId}`

```typescript
{
  documentId: string;
  url: string;
  title: string;
  appId: string;
  createdAt: number;
  updatedAt: number;
  lastUploadedAt: number; // 用于冲突检测
}
```

### 应用配置

存储键：`feishu:config:default_app`

```typescript
string; // 默认应用 ID
```

存储键：`feishu:config:app:{appId}`

```typescript
{
  appSecret: string; // 加密存储
}
```

## Markdown 转换规则

### 标准语法转换

| Markdown 语法   | 飞书文档块           | 说明                 |
| --------------- | -------------------- | -------------------- | ----------- | ---- |
| `# 标题`        | Heading Block        | 支持 1-6 级标题      |
| 段落文本        | Text Block           | 普通段落             |
| `- 列表项`      | Bullet List Block    | 无序列表             |
| `1. 列表项`     | Ordered List Block   | 有序列表             |
| `` `代码` ``    | Code Block           | 行内代码转为代码块   |
| ` ```code``` `  | Code Block           | 代码块，保留语言标识 |
| `> 引用`        | Quote Block          | 引用块               |
| `               | 表格                 | `                    | Table Block | 表格 |
| `[链接](url)`   | Text Block with link | 超链接               |
| `![图片](path)` | Image Block          | 需要先上传图片       |

### 扩展语法转换

| Markdown 语法 | 飞书文档块              | 说明                       |
| ------------- | ----------------------- | -------------------------- |
| `> [!note]`   | Callout Block           | 提示框，支持多种类型       |
| `==高亮==`    | Text with bold          | 转为加粗（飞书不支持高亮） |
| `~~删除线~~`  | Text with strikethrough | 删除线                     |
| `- [ ] 任务`  | Todo Block              | 任务列表                   |
| `[[链接]]`    | Text Block              | Wiki 链接转为文本          |
| `![[嵌入]]`   | Image/File Block        | 嵌入文件                   |

### Callout 类型映射

| Callout 类型 | 飞书样式 | 颜色 |
| ------------ | -------- | ---- |
| note         | 📝 笔记  | 蓝色 |
| info         | ℹ️ 信息  | 蓝色 |
| tip          | 💡 提示  | 绿色 |
| warning      | ⚠️ 警告  | 黄色 |
| danger       | ❌ 危险  | 红色 |
| error        | ⛔ 错误  | 红色 |
| question     | ❓ 问题  | 紫色 |
| success      | ✅ 成功  | 绿色 |
| quote        | 💬 引用  | 灰色 |
| example      | 📖 示例  | 紫色 |

### 文件处理规则

#### 图片文件

支持的格式：`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`

处理流程：

1. 识别图片引用（`![alt](path)` 或 `![[image]]`）
2. 解析文件路径（相对路径基于工作目录）
3. 上传图片到飞书
4. 替换文档中的占位符为飞书图片 key

#### 附件文件

支持的格式：`.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.zip` 等

处理流程：

1. 识别附件引用（`[[file.pdf]]`）
2. 上传文件到飞书
3. 在文档中插入文件块

### Front Matter 处理

支持的 Front Matter 字段：

```yaml
---
title: 文档标题
date: 2025-01-15
tags: [tag1, tag2]
---
```

处理选项：

- `removeFrontMatter: true` - 移除 Front Matter，提取 title 作为文档标题
- `removeFrontMatter: false` - 保留 Front Matter 为 YAML 代码块

### 代码块过滤

配置 `codeBlockFilterLanguages` 可以过滤特定语言的代码块：

```typescript
{
  codeBlockFilterLanguages: ['dataviewjs', 'dataview', 'tasks'];
}
```

过滤规则：

- 匹配代码块的语言标识
- 忽略大小写
- 完全移除匹配的代码块

## 错误码定义

| 错误码 | 说明                                 |
| ------ | ------------------------------------ |
| -32602 | 参数验证失败                         |
| -32603 | 内部错误（API 调用失败、网络错误等） |
| -32601 | 资源不存在（文档不存在）             |

### 常见错误场景

| 场景       | 错误码 | 错误信息                                 |
| ---------- | ------ | ---------------------------------------- |
| 未认证     | -32602 | 应用 {appId} 未认证，请先完成 OAuth 认证 |
| Token 过期 | -32603 | 访问令牌已过期，请重新授权               |
| 文档冲突   | -32603 | 检测到文档冲突：文档在上次上传后已被修改 |
| 权限不足   | -32603 | 权限不足，请检查应用权限配置             |
| 文件不存在 | -32602 | 文件不存在: {filePath}                   |
| 文件过大   | -32602 | 文件大小超过限制: {size} > {limit}       |

## API 频率限制

| API 类型 | 每秒限制 | 每分钟限制 |
| -------- | -------- | ---------- |
| document | 2        | 90         |
| import   | 1        | 90         |
| block    | 2        | 150        |
| upload   | 2        | 60         |
| wiki     | 2        | 90         |

频率控制策略：

- 滑动窗口算法
- 自动等待和重试
- 智能节流，避免触发 429 错误

---

更多详情请参考 [设计文档](./design.md) 和 [API 契约](./contracts/)。
