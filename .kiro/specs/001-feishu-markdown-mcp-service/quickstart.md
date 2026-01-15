# 飞书 Markdown MCP 服务快速开始指南

本指南帮助您快速配置和使用飞书 Markdown MCP 服务。

## 前置条件

- Node.js >= 20.0.0
- 飞书开放平台账号
- 支持 MCP 协议的 AI 客户端（如 Claude Desktop、Cursor 等）

## 第一步：创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 填写应用名称和描述
4. 获取 **App ID** 和 **App Secret**

### 配置应用权限

在应用的「权限管理」页面，添加以下权限：

**云文档权限**：

- `docs:doc` - 查看、创建、编辑云文档
- `docs:doc:readonly` - 查看云文档
- `drive:drive` - 查看、管理云空间文件

**知识库权限**（可选）：

- `wiki:wiki` - 查看、创建、编辑知识库

**用户信息权限**：

- `contact:user.base:readonly` - 获取用户基本信息

### 配置 OAuth 回调地址

在应用的「安全设置」页面，添加重定向 URL：

```
http://localhost:3000/oauth/feishu/callback
```

> 生产环境请使用 HTTPS 地址

## 第二步：配置环境变量

创建 `.env` 文件或设置环境变量：

```bash
# 飞书应用配置
FEISHU_DEFAULT_APP_ID=cli_xxxxxxxxxx
FEISHU_DEFAULT_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_OAUTH_CALLBACK_URL=http://localhost:3000/oauth/feishu/callback

# MCP 服务配置
MCP_TRANSPORT_TYPE=http
MCP_HTTP_PORT=3000
```

## 第三步：启动服务

```bash
# 开发模式
npm run dev:http

# 生产模式
npm run build
npm run start:http
```

服务启动后，您将看到：

```
MCP Server started on http://localhost:3000
```

## 第四步：完成 OAuth 授权

### 方式一：通过 MCP 工具

1. 在 AI 客户端中调用 `feishu_auth_url` 工具
2. 访问返回的授权链接
3. 在飞书中完成授权
4. 系统自动处理回调并存储令牌

### 方式二：手动授权

1. 访问授权链接：

   ```
   https://open.feishu.cn/open-apis/authen/v1/authorize?client_id=YOUR_APP_ID&redirect_uri=YOUR_CALLBACK_URL&response_type=code&state=random_state
   ```

2. 完成授权后，使用 `feishu_auth_callback` 工具处理授权码

## 第五步：开始使用

### 上传 Markdown 文档

```json
{
  "tool": "feishu_upload_markdown",
  "arguments": {
    "filePath": "/path/to/document.md",
    "targetType": "drive"
  }
}
```

### 上传到知识库

```json
{
  "tool": "feishu_upload_markdown",
  "arguments": {
    "content": "# 标题\n\n这是文档内容",
    "targetType": "wiki",
    "targetId": "wiki_space_id"
  }
}
```

### 列出可用文件夹

```json
{
  "tool": "feishu_list_folders"
}
```

### 列出知识库空间

```json
{
  "tool": "feishu_list_wikis"
}
```

## 可用工具列表

| 工具名称                       | 描述                |
| ------------------------------ | ------------------- |
| `feishu_auth_url`              | 生成 OAuth 授权链接 |
| `feishu_auth_callback`         | 处理 OAuth 回调     |
| `feishu_upload_markdown`       | 上传 Markdown 文档  |
| `feishu_update_document`       | 更新已有文档        |
| `feishu_batch_upload_markdown` | 批量上传文档        |
| `feishu_list_folders`          | 列出云空间文件夹    |
| `feishu_list_wikis`            | 列出知识库空间      |
| `feishu_get_user_info`         | 获取当前用户信息    |
| `feishu_set_default_app`       | 设置默认应用        |
| `feishu_list_apps`             | 列出已配置的应用    |

## 常见问题

### Q: 授权失败，提示 "state 验证失败"

A: state 参数有 5 分钟有效期，请在有效期内完成授权。

### Q: 上传文档失败，提示 "权限不足"

A: 请检查飞书应用是否已添加必要的权限，并确保应用已发布。

### Q: 图片上传失败

A: 请确保：

1. 图片文件存在且可读
2. 图片大小不超过 20MB
3. 图片格式为 PNG、JPG、GIF 等常见格式

### Q: 如何使用多个飞书应用？

A: 使用 `appId` 参数指定应用：

```json
{
  "tool": "feishu_upload_markdown",
  "arguments": {
    "filePath": "/path/to/doc.md",
    "appId": "cli_another_app_id"
  }
}
```

### Q: 如何更新已上传的文档？

A: 使用 `feishu_update_document` 工具：

```json
{
  "tool": "feishu_update_document",
  "arguments": {
    "documentId": "doccnXXXXXXXX",
    "filePath": "/path/to/updated.md"
  }
}
```

如果文档被他人修改过，会提示冲突。使用 `force: true` 强制覆盖。

## 下一步

- 查看 [API 文档](./contracts/mcp-tools.yaml) 了解完整的工具参数
- 查看 [数据模型](./data-model.md) 了解 Markdown 转换规则
- 查看 [设计文档](./design.md) 了解架构设计

---

如有问题，请提交 Issue 或联系维护者。
