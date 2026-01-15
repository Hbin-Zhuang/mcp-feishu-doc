# Clarification Log: 飞书 Markdown MCP 服务

**Feature**: 001-feishu-markdown-mcp-service
**Session Date**: 2025-01-15
**Total Questions**: 5 (planned)

---

## Q1: OAuth 授权回调处理机制

**Category**: Integration & External Dependencies

**Question**: MCP 服务应该如何处理飞书 OAuth 的授权回调？

**Context**: 规范中提到需要实现 OAuth 2.0 认证流程（FR-002, FR-024, FR-025），但 MCP 服务通常运行在后台，没有 Web 服务器来接收 OAuth 回调。

**Options Presented**:
- **A**: 使用项目现有的 HTTP 传输模式，在 `/oauth/callback` 端点接收回调
- **B**: 提供两种模式：HTTP 模式直接接收回调，stdio 模式使用外部回调服务器
- **C**: 仅支持手动授权码输入，用户在浏览器完成授权后手动复制授权码
- **D**: 使用设备授权流程（Device Flow），用户在另一台设备上完成授权
- **Other**: Custom answer allowed

**Recommended**: Option B - 更灵活，支持多种部署场景

**User's Choice**: A

**Resolution**: 
- OAuth 回调将通过 HTTP 传输模式的 `/oauth/callback` 端点接收
- 需要在 HTTP 传输配置中添加 OAuth 回调路由
- stdio 模式下，用户需要切换到 HTTP 模式进行授权，或者提示用户使用 HTTP 模式
- 更新 FR-025 说明回调处理依赖 HTTP 传输模式

**Applied To**: 
- User Story 2 (OAuth 认证管理)
- FR-025 (feishu_auth_callback 工具)
- 技术约束部分

---

## Q2: 本地文件路径解析策略

**Category**: Domain & Data Model

**Question**: 当 Markdown 文件通过 MCP 工具传入时（可能是文件路径或直接内容），如何解析和定位本地文件？

**Context**: 规范中提到需要上传本地文件（FR-004, FR-005），Markdown 中可能包含相对路径（`./image.png`）或绝对路径（`/Users/xxx/image.png`）的文件引用。

**Options Presented**:
- **A**: 要求用户提供工作目录参数，所有相对路径基于该目录解析
- **B**: 如果传入文件路径，使用文件所在目录作为基准；如果传入内容，要求用户提供工作目录
- **C**: 仅支持绝对路径，不支持相对路径
- **D**: 支持多种路径解析策略，通过配置选择
- **Other**: Custom answer allowed

**Recommended**: Option B - 平衡灵活性和安全性

**User's Choice**: B

**Resolution**: 
- `feishu_upload_markdown` 工具接受两种输入方式：
  1. `filePath`: Markdown 文件路径 → 自动使用文件所在目录作为基准解析相对路径
  2. `content` + `workingDirectory`: Markdown 内容 + 工作目录 → 使用指定工作目录解析相对路径
- 绝对路径直接使用，不受工作目录影响
- 更新 FR-026 说明输入参数和路径解析规则
- 在 MarkdownDocument 实体中添加 `baseDirectory` 属性

**Applied To**: 
- User Story 1 (Markdown 文档转换)
- User Story 3 (文件和图片上传)
- FR-026 (feishu_upload_markdown 工具)
- MarkdownDocument 实体定义

---

## Q3: Token 存储和多用户支持

**Category**: Domain & Data Model

**Question**: 系统应该如何管理和存储不同用户/应用的 OAuth tokens？

**Context**: 规范中提到需要安全存储 OAuth tokens（FR-023），但没有明确说明如何处理多个飞书账号或多个应用的场景。

**Options Presented**:
- **A**: 单用户模式，全局只存储一套 App ID/Secret 和 tokens
- **B**: 支持多应用配置，通过 App ID 作为标识符区分不同的认证信息
- **C**: 支持多租户模式，每个 MCP 客户端会话独立管理自己的认证信息
- **D**: 使用项目现有的 tenantId 机制，每个租户独立存储认证信息
- **Other**: Custom answer allowed

**Recommended**: Option B - 适合大多数使用场景

**User's Choice**: B

**Resolution**: 
- 系统支持配置多个飞书应用，每个应用通过 App ID 唯一标识
- 存储结构：`feishu_auth:{appId}` 存储对应的认证信息
- 所有 MCP 工具接受可选的 `appId` 参数，未指定时使用默认应用
- 添加 `feishu_set_default_app` 工具设置默认应用
- 添加 `feishu_list_apps` 工具列出已配置的应用
- 更新 FR-008 说明支持多应用配置
- 更新 FR-023 说明按 App ID 隔离存储

**Applied To**: 
- User Story 2 (OAuth 认证管理)
- FR-008 (配置管理)
- FR-023 (Token 存储)
- FeishuAuth 实体定义
- 所有 MCP 工具接口（添加可选 appId 参数）

---

## Q4: 文档更新策略和冲突处理

**Category**: Functional Scope & Behavior

**Question**: 当更新已存在的飞书文档时，如何处理可能的冲突？

**Context**: User Story 6 提到文档更新功能，但没有明确说明如何处理并发更新或内容冲突的情况。

**Options Presented**:
- **A**: 完全覆盖模式，直接用新内容替换整个文档，不检测冲突
- **B**: 检测文档最后修改时间，如果文档在上次上传后被修改过，则拒绝更新并提示用户
- **C**: 提供两种更新模式：覆盖模式和追加模式（在文档末尾追加新内容）
- **D**: 仅支持创建新文档，不支持更新已存在的文档
- **Other**: Custom answer allowed

**Recommended**: Option A - 简单直接，符合大多数场景

**User's Choice**: B

**Resolution**: 
- 系统在本地存储每个文档的最后上传时间戳（`lastUploadedAt`）
- 更新文档前，先获取飞书文档的最后修改时间（`updatedAt`）
- 如果 `updatedAt > lastUploadedAt`，说明文档在上次上传后被修改过
- 此时拒绝更新，返回错误信息提示用户文档已被修改
- 提供 `force` 参数允许用户强制覆盖（需要明确确认）
- 更新成功后，更新本地存储的 `lastUploadedAt` 时间戳
- 在 FeishuDocument 实体中添加 `lastUploadedAt` 属性
- 更新 User Story 6 的验收场景，添加冲突检测场景

**Applied To**: 
- User Story 6 (文档更新和同步)
- FR-027 (feishu_update_document 工具)
- FeishuDocument 实体定义
- Edge Cases 部分（添加并发更新场景）

---

## Q5: 频率限制和批量操作策略

**Category**: Non-Functional Quality Attributes

**Question**: 当用户需要上传多个文档时，系统应该如何处理？

**Context**: 规范中提到需要实现频率限制控制（FR-009），feishushare 项目中有 RateLimitController 实现，但没有明确说明批量操作的处理策略。

**Options Presented**:
- **A**: 不支持批量操作，用户需要多次调用单文档上传工具
- **B**: 提供批量上传工具，内部自动处理频率限制和错误隔离（单个文档失败不影响其他文档）
- **C**: 支持批量操作，但要求用户自己控制调用频率
- **D**: 仅在 P0/P1 阶段支持单文档操作，批量操作作为后续功能（P3）
- **Other**: Custom answer allowed

**Recommended**: Option B - 平衡性能和用户体验

**User's Choice**: B

**Resolution**: 
- 添加 `feishu_batch_upload_markdown` 工具支持批量上传
- 工具接受文档列表作为输入，每个文档包含独立的配置
- 内部使用 RateLimitController 自动控制 API 调用频率
- 实现错误隔离：单个文档上传失败不影响其他文档
- 返回详细的批量操作结果，包含成功/失败列表
- 支持并发控制参数（默认最多 3 个并发）
- 添加 FR-033 定义批量上传功能
- 添加 User Story 8 描述批量操作场景（Priority: P2）
- 更新性能需求，说明批量操作的性能指标

**Applied To**: 
- 新增 User Story 8 (批量文档上传)
- FR-009 (频率限制控制)
- 新增 FR-033 (批量上传工具)
- 性能需求部分
- 成功标准部分

---

## Summary

| # | Question | Category | Choice | Applied To |
|---|----------|----------|--------|------------|
| 1 | OAuth 授权回调处理机制 | Integration | A | FR-025, 技术约束 |
| 2 | 本地文件路径解析策略 | Domain & Data | B | FR-026, MarkdownDocument |
| 3 | Token 存储和多用户支持 | Domain & Data | B | FR-008, FR-023, FR-031, FR-032 |
| 4 | 文档更新策略和冲突处理 | Functional Scope | B | FR-027, User Story 6, Edge Cases |
| 5 | 频率限制和批量操作策略 | Non-Functional | B | FR-009, 新增 FR-033, User Story 8 |

---

## Impact on Specification

- **Sections Modified**: 
  - User Story 2 (OAuth 认证)
  - User Story 6 (文档更新)
  - 新增 User Story 8 (批量上传)
  - 功能需求 (FR-008, FR-023, FR-025, FR-026, FR-027)
  - 新增功能需求 (FR-031, FR-032, FR-033)
  - 关键实体 (MarkdownDocument, FeishuDocument)
  - 技术约束
  - Edge Cases
  - 性能需求

- **New Requirements Added**: 
  - FR-031: feishu_set_default_app 工具
  - FR-032: feishu_list_apps 工具
  - FR-033: feishu_batch_upload_markdown 工具
  - User Story 8: 批量文档上传

- **Requirements Changed**: 
  - FR-008: 添加多应用配置支持
  - FR-023: 添加按 App ID 隔离存储
  - FR-025: 明确 OAuth 回调依赖 HTTP 模式
  - FR-026: 添加路径解析策略说明
  - FR-027: 添加冲突检测机制
