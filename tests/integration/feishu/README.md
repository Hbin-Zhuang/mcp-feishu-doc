# 飞书 MCP 服务集成测试指南

本目录包含飞书 MCP 服务的集成测试。这些测试需要真实的飞书应用凭证和网络连接。

## 前置条件

1. **创建飞书应用**
   - 访问 [飞书开放平台](https://open.feishu.cn/)
   - 创建企业自建应用
   - 获取 App ID 和 App Secret

2. **配置权限**
   - 联系人权限：`contact:user.base:readonly`
   - 文档权限：`docx:document`
   - 云空间权限：`drive:drive`
   - 知识库权限：`wiki:wiki`
   - 离线访问：`offline_access`

3. **配置环境变量**

   ```bash
   cp .env.example .env
   ```

   编辑 `.env` 文件，填入真实的飞书凭证：

   ```bash
   FEISHU_DEFAULT_APP_ID=cli_your_app_id
   FEISHU_DEFAULT_APP_SECRET=your_app_secret
   FEISHU_OAUTH_CALLBACK_URL=http://localhost:3010/oauth/feishu/callback
   ```

## 运行集成测试

### 手动测试流程

1. **启动 MCP 服务**

   ```bash
   pnpm run dev:http
   ```

2. **测试 OAuth 认证**
   - 访问 `http://localhost:3010/mcp`
   - 调用 `feishu_auth_url` 工具获取授权链接
   - 在浏览器中访问授权链接完成认证
   - 使用返回的 code 和 state 调用 `feishu_auth_callback` 工具

3. **测试文档操作**
   - 调用 `feishu_upload_markdown` 上传测试文档
   - 调用 `feishu_list_folders` 列出文件夹
   - 调用 `feishu_list_wikis` 列出知识库
   - 调用 `feishu_get_user_info` 获取用户信息

4. **测试批量操作**
   - 调用 `feishu_batch_upload_markdown` 批量上传文档

### 自动化集成测试

由于集成测试需要真实的用户交互（OAuth 认证），建议使用以下方式：

1. **使用测试用户账号**
   - 创建专门的测试用户
   - 预先完成 OAuth 认证，保存 token

2. **Mock 外部依赖**
   - 对于 CI/CD 环境，使用 Mock 服务模拟飞书 API
   - 保留核心业务逻辑测试

3. **端到端测试**
   - 使用 Playwright 或类似工具自动化浏览器操作
   - 完整测试 OAuth 流程

## 测试用例覆盖

### OAuth 认证流程 (T206)

- [ ] 生成授权 URL
- [ ] 处理授权回调
- [ ] Token 刷新
- [ ] 多应用配置

### 文档操作 (T310)

- [ ] 上传 Markdown 文档
- [ ] 上传包含图片的文档
- [ ] 更新文档
- [ ] 冲突检测

### 管理功能 (T410)

- [ ] 列出文件夹
- [ ] 列出知识库
- [ ] 获取用户信息
- [ ] 应用配置管理

### 批量操作 (T505)

- [ ] 批量上传多个文档
- [ ] 并发控制
- [ ] 错误隔离
- [ ] 频率限制处理

### 端到端测试 (T601)

- [ ] 完整工作流程
- [ ] 所有工具集成测试
- [ ] 错误恢复

### 错误场景 (T602)

- [ ] 网络错误处理
- [ ] Token 过期处理
- [ ] API 限制处理
- [ ] 权限不足处理

### 性能测试 (T603)

- [ ] 单文档上传性能 (< 5 秒)
- [ ] 批量上传性能 (10 文档 < 60 秒)
- [ ] 内存占用 (< 500MB)
- [ ] 频率控制效果

## 注意事项

1. **数据清理**
   - 测试后清理创建的文档和文件夹
   - 避免污染生产环境

2. **频率限制**
   - 遵守飞书 API 频率限制
   - 测试间添加适当延迟

3. **敏感信息**
   - 不要在测试代码中硬编码凭证
   - 使用环境变量或配置文件

4. **网络依赖**
   - 集成测试依赖网络连接
   - 考虑网络超时和重试

## 示例测试代码

```typescript
// 示例：OAuth 集成测试
describe('OAuth 集成测试', () => {
  it('应该完成完整的 OAuth 流程', async () => {
    // 1. 获取授权 URL
    const authResult = await callTool('feishu_auth_url', {});
    expect(authResult.authUrl).toContain('open.feishu.cn');

    // 2. 模拟用户授权（需要真实的 code）
    const code = process.env.TEST_AUTH_CODE;
    if (!code) {
      console.log('跳过集成测试：缺少 TEST_AUTH_CODE');
      return;
    }

    // 3. 处理回调
    const callbackResult = await callTool('feishu_auth_callback', {
      code,
      state: authResult.state,
    });

    expect(callbackResult.success).toBe(true);
    expect(callbackResult.userInfo).toBeDefined();
  });
});
```

## 持续集成

在 CI/CD 环境中，建议：

1. **跳过集成测试**
   - 使用环境变量控制是否运行集成测试
   - 只在有凭证的环境中运行

2. **使用测试替身**
   - 创建 Mock 服务模拟飞书 API
   - 保持测试的确定性和速度

3. **定期验证**
   - 定期在真实环境中运行集成测试
   - 确保与飞书 API 的兼容性
