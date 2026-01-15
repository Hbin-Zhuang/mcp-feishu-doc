# Feature Specification: 飞书 Markdown MCP 服务

**Feature Branch**: `001-feishu-markdown-mcp-service`
**Created**: 2025-01-15
**Status**: Draft

## 概述

将 feishushare Obsidian 插件的核心功能提取并重构为独立的 MCP (Model Context Protocol) 服务，使其能够被任何支持 MCP 的 AI 客户端调用，实现 Markdown 文档到飞书云文档的转换和同步功能。

## 用户场景与测试

### User Story 1 - Markdown 文档转换为飞书文档 (Priority: P0)

作为 AI 助手的用户，我希望能够通过 MCP 工具将本地 Markdown 文件转换并上传到飞书云文档，这样我就可以在任何支持 MCP 的环境中使用飞书文档功能，而不仅限于 Obsidian。

**Why this priority**: 这是核心功能，是整个服务的基础能力。

**Independent Test**: 
1. 准备一个包含标准 Markdown 语法的文件
2. 调用 MCP 工具 `feishu_upload_markdown`
3. 验证飞书中创建了对应文档且格式正确

**Acceptance Scenarios**:

1. **Given** 用户有一个包含标题、列表、代码块的 Markdown 文件，**When** 调用上传工具，**Then** 飞书中创建文档并保留所有格式
2. **Given** Markdown 文件包含本地图片引用，**When** 启用图片上传选项，**Then** 图片被上传到飞书并正确嵌入文档
3. **Given** Markdown 文件包含 Front Matter，**When** 设置为移除 Front Matter，**Then** 飞书文档中不包含 Front Matter 内容
4. **Given** Markdown 文件包含表格，**When** 上传文档，**Then** 飞书中表格格式正确显示
5. **Given** 用户指定了目标文件夹，**When** 上传文档，**Then** 文档创建在指定文件夹中

---

### User Story 2 - 飞书 OAuth 认证管理 (Priority: P0)

作为服务使用者，我需要通过 OAuth 2.0 安全地授权访问飞书 API，这样我的飞书账号信息和文档数据才能得到保护。

**Why this priority**: 安全认证是使用飞书 API 的前提条件。

**Independent Test**:
1. 配置飞书应用的 App ID 和 App Secret
2. 调用授权工具获取授权 URL
3. 完成授权流程后验证 token 有效性

**Acceptance Scenarios**:

1. **Given** 用户提供了有效的 App ID 和 App Secret，**When** 请求授权，**Then** 返回有效的授权 URL
2. **Given** 用户完成了授权流程，**When** 系统接收到授权码，**Then** 成功获取 access token 和 refresh token
3. **Given** access token 已过期，**When** 调用 API，**Then** 自动使用 refresh token 刷新并重试
4. **Given** refresh token 也已过期，**When** 调用 API，**Then** 返回明确的重新授权提示
5. **Given** 用户已授权，**When** 查询用户信息，**Then** 返回飞书用户名、邮箱等基本信息

---

### User Story 3 - 文件和图片上传 (Priority: P1)

作为用户，我希望 Markdown 中引用的本地文件（图片、PDF、文档等）能够自动上传到飞书，这样文档内容才是完整的。

**Why this priority**: 文件上传是文档完整性的重要保障，但不是最基础的文本转换功能。

**Independent Test**:
1. 准备包含本地图片引用的 Markdown 文件
2. 调用上传工具并启用文件上传
3. 验证图片在飞书文档中正确显示

**Acceptance Scenarios**:

1. **Given** Markdown 包含 `![alt](./image.png)` 格式的图片，**When** 上传文档，**Then** 图片被上传并嵌入飞书文档
2. **Given** Markdown 包含 PDF 附件引用，**When** 上传文档，**Then** PDF 被上传并在文档中显示为附件块
3. **Given** 图片文件不存在，**When** 上传文档，**Then** 跳过该图片并记录警告，继续处理其他内容
4. **Given** 文件大小超过飞书限制，**When** 上传文件，**Then** 返回明确的错误信息
5. **Given** 用户禁用了文件上传，**When** 上传文档，**Then** 保留原始文件引用文本

---

### User Story 4 - 知识库支持 (Priority: P1)

作为用户，我希望能够将文档上传到飞书知识库而不仅是云空间，这样我可以更好地组织和管理文档。

**Why this priority**: 知识库是飞书的重要功能，但云空间已经能满足基本需求。

**Independent Test**:
1. 配置目标为知识库并指定空间和节点
2. 上传 Markdown 文档
3. 验证文档出现在指定知识库位置

**Acceptance Scenarios**:

1. **Given** 用户选择知识库作为目标，**When** 上传文档，**Then** 文档创建在指定知识库空间中
2. **Given** 用户指定了知识库节点，**When** 上传文档，**Then** 文档创建在该节点下
3. **Given** 用户未指定节点，**When** 上传文档，**Then** 文档创建在知识库根目录
4. **Given** 用户没有知识库权限，**When** 尝试上传，**Then** 返回权限错误提示
5. **Given** 知识库空间不存在，**When** 尝试上传，**Then** 返回明确的错误信息

---

### User Story 5 - Markdown 语法扩展支持 (Priority: P2)

作为用户，我希望支持常见的 Markdown 扩展语法（如 Callout、高亮、删除线等），这样我的文档格式能够更丰富。

**Why this priority**: 扩展语法提升用户体验，但不影响核心功能。

**Independent Test**:
1. 准备包含 Callout 语法的 Markdown
2. 上传文档
3. 验证 Callout 在飞书中正确显示为对应样式

**Acceptance Scenarios**:

1. **Given** Markdown 包含 `> [!note]` Callout 语法，**When** 上传文档，**Then** 转换为飞书的提示块样式
2. **Given** Markdown 包含 `==高亮==` 语法，**When** 上传文档，**Then** 文本显示为加粗（飞书不支持高亮）
3. **Given** Markdown 包含 `~~删除线~~` 语法，**When** 上传文档，**Then** 文本显示为删除线
4. **Given** Markdown 包含任务列表 `- [ ]`，**When** 上传文档，**Then** 转换为飞书的任务列表
5. **Given** Markdown 包含数学公式，**When** 上传文档，**Then** 保留公式文本（飞书支持有限）

---

### User Story 6 - 文档更新和同步 (Priority: P2)

作为用户，我希望能够更新已经上传的飞书文档，而不是每次都创建新文档，这样可以保持文档链接的稳定性。

**Why this priority**: 更新功能提升用户体验，但创建新文档也能满足基本需求。

**Independent Test**:
1. 首次上传 Markdown 文档并记录文档 ID
2. 修改 Markdown 内容
3. 使用相同文档 ID 再次上传
4. 验证飞书文档内容已更新

**Acceptance Scenarios**:

1. **Given** 用户提供了已存在的文档 ID，**When** 上传文档且文档未被他人修改，**Then** 更新该文档内容而不是创建新文档
2. **Given** 文档在上次上传后被他人修改过，**When** 尝试更新，**Then** 返回冲突错误并提示用户
3. **Given** 文档存在冲突但用户使用强制覆盖选项，**When** 更新文档，**Then** 强制覆盖文档内容
4. **Given** 文档 ID 不存在，**When** 尝试更新，**Then** 返回错误并提示创建新文档
5. **Given** 用户没有文档编辑权限，**When** 尝试更新，**Then** 返回权限错误

---

### User Story 7 - 代码块过滤 (Priority: P3)

作为用户，我希望能够过滤掉某些特定语言的代码块（如 Obsidian 插件专用的代码块），这样上传到飞书的文档更加简洁。

**Why this priority**: 这是特定场景的需求，不影响大多数用户。

**Independent Test**:
1. 配置过滤语言列表（如 `dataviewjs`）
2. 上传包含该语言代码块的 Markdown
3. 验证飞书文档中不包含该代码块

**Acceptance Scenarios**:

1. **Given** 用户配置了过滤语言列表，**When** 上传包含这些语言的代码块，**Then** 这些代码块被移除
2. **Given** 代码块语言不在过滤列表中，**When** 上传文档，**Then** 代码块正常保留
3. **Given** 用户未配置过滤列表，**When** 上传文档，**Then** 所有代码块都保留
4. **Given** 过滤列表包含大小写不同的语言名，**When** 匹配代码块，**Then** 忽略大小写进行匹配
5. **Given** 文档只包含被过滤的代码块，**When** 上传文档，**Then** 文档仍然创建但内容为空或仅包含其他内容

---

### User Story 8 - 批量文档上传 (Priority: P2)

作为用户，我希望能够一次性上传多个 Markdown 文档到飞书，这样可以提高工作效率，避免重复操作。

**Why this priority**: 批量操作提升效率，但单文档上传已能满足基本需求。

**Independent Test**:
1. 准备多个 Markdown 文件（至少 5 个）
2. 调用批量上传工具
3. 验证所有文档都成功创建在飞书中

**Acceptance Scenarios**:

1. **Given** 用户提供了 5 个 Markdown 文件，**When** 调用批量上传工具，**Then** 所有文档都成功上传到飞书
2. **Given** 批量上传中有 1 个文档失败（如文件不存在），**When** 继续处理其他文档，**Then** 其他 4 个文档成功上传，返回详细的成功/失败列表
3. **Given** 批量上传 10 个文档，**When** 系统自动控制频率，**Then** 不触发飞书 API 限制（429 错误）
4. **Given** 用户设置并发数为 2，**When** 批量上传文档，**Then** 最多同时处理 2 个文档
5. **Given** 批量上传过程中网络中断，**When** 部分文档已上传，**Then** 返回已完成和未完成的文档列表

---

### Edge Cases

- **循环引用**: 如果 Markdown A 引用 B，B 又引用 A，如何处理？
  - 系统应检测循环引用并停止递归，记录警告信息
  
- **超大文件**: 如果 Markdown 文件或图片超过飞书 API 限制，如何处理？
  - 返回明确的错误信息，提示文件大小限制
  
- **网络中断**: 上传过程中网络中断，如何恢复？
  - 实现重试机制，最多重试 3 次，失败后返回详细错误信息
  
- **并发上传**: 同时上传多个文档时，如何避免频率限制？
  - 实现智能频率控制，自动限制 API 调用频率

- **并发更新冲突**: 多个用户同时更新同一文档，如何处理？
  - 通过时间戳检测冲突，后更新者收到冲突提示，可选择强制覆盖或放弃更新
  
- **特殊字符**: 文件名包含特殊字符（如 `/`, `\`, `:`）时如何处理？
  - 自动清理或替换特殊字符，确保文件名合法
  
- **空文档**: 如果 Markdown 文件为空或只包含 Front Matter，如何处理？
  - 创建空文档或返回警告，由用户配置决定

## 功能需求

### 核心功能需求

- **FR-001**: 系统必须支持将 Markdown 文本转换为飞书文档格式
- **FR-002**: 系统必须支持飞书 OAuth 2.0 认证流程
- **FR-003**: 系统必须支持自动刷新过期的 access token
- **FR-004**: 系统必须支持上传本地图片文件到飞书
- **FR-005**: 系统必须支持上传本地附件文件（PDF、DOCX、XLSX 等）到飞书
- **FR-006**: 系统必须支持云空间和知识库两种目标类型
- **FR-007**: 系统必须提供 MCP 工具接口供 AI 客户端调用
- **FR-008**: 系统必须支持配置管理（App ID、App Secret、目标位置等），支持多个飞书应用配置，通过 App ID 区分
- **FR-009**: 系统必须实现频率限制控制，避免触发飞书 API 限制
- **FR-010**: 系统必须支持错误处理和重试机制

### Markdown 语法支持需求

- **FR-011**: 系统必须支持标准 Markdown 语法（标题、列表、代码块、引用、表格等）
- **FR-012**: 系统必须支持 Callout 语法转换（`> [!note]` 等）
- **FR-013**: 系统必须支持高亮语法转换（`==text==`）
- **FR-014**: 系统必须支持删除线语法（`~~text~~`）
- **FR-015**: 系统必须支持任务列表语法（`- [ ]` 和 `- [x]`）
- **FR-016**: 系统必须支持图片语法（`![alt](url)` 和 `![[image]]`）
- **FR-017**: 系统必须支持链接语法（`[text](url)` 和 `[[link]]`）

### 配置和管理需求

- **FR-018**: 系统必须支持通过环境变量或配置文件管理飞书应用凭证
- **FR-019**: 系统必须支持配置默认上传目标（文件夹或知识库）
- **FR-020**: 系统必须支持配置文件上传开关（图片、附件）
- **FR-021**: 系统必须支持配置代码块过滤语言列表
- **FR-022**: 系统必须支持配置 Front Matter 处理方式（移除或保留）
- **FR-023**: 系统必须安全存储和管理 OAuth tokens，按 App ID 隔离存储，支持多应用配置

### MCP 接口需求

- **FR-024**: 系统必须提供 `feishu_auth_url` 工具获取授权 URL
- **FR-025**: 系统必须提供 `feishu_auth_callback` 工具处理授权回调（通过 HTTP 传输模式的 `/oauth/callback` 端点接收）
- **FR-026**: 系统必须提供 `feishu_upload_markdown` 工具上传 Markdown 文档，支持两种输入方式：(1) 文件路径（自动推断基准目录）(2) 内容 + 工作目录参数
- **FR-027**: 系统必须提供 `feishu_update_document` 工具更新已存在的文档，包含冲突检测机制（检测文档是否在上次上传后被修改）和强制覆盖选项
- **FR-028**: 系统必须提供 `feishu_list_folders` 工具列出云空间文件夹
- **FR-029**: 系统必须提供 `feishu_list_wikis` 工具列出知识库空间
- **FR-030**: 系统必须提供 `feishu_get_user_info` 工具获取当前用户信息
- **FR-031**: 系统必须提供 `feishu_set_default_app` 工具设置默认使用的飞书应用
- **FR-032**: 系统必须提供 `feishu_list_apps` 工具列出已配置的飞书应用
- **FR-033**: 系统必须提供 `feishu_batch_upload_markdown` 工具批量上传多个文档，支持自动频率控制、错误隔离和并发控制

## 关键实体

### MarkdownDocument
表示待上传的 Markdown 文档
- **属性**: 
  - `content`: 文档内容（字符串）
  - `title`: 文档标题
  - `frontMatter`: Front Matter 数据（可选）
  - `localFiles`: 引用的本地文件列表
  - `targetType`: 目标类型（云空间或知识库）
  - `targetId`: 目标位置 ID（文件夹 ID 或知识库节点 token）
  - `baseDirectory`: 基准目录，用于解析相对路径（可选，如果提供文件路径则自动推断）

### FeishuDocument
表示飞书中的文档
- **属性**:
  - `documentId`: 飞书文档 ID
  - `url`: 文档访问 URL
  - `title`: 文档标题
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间
  - `lastUploadedAt`: 最后上传时间（用于冲突检测）
- **关系**: 由 MarkdownDocument 转换而来

### LocalFile
表示 Markdown 中引用的本地文件
- **属性**:
  - `path`: 文件路径
  - `type`: 文件类型（图片、PDF、文档等）
  - `size`: 文件大小
  - `placeholder`: 占位符（用于替换）
- **关系**: 属于 MarkdownDocument

### FeishuAuth
表示飞书认证信息
- **属性**:
  - `appId`: 应用 ID
  - `appSecret`: 应用密钥
  - `accessToken`: 访问令牌
  - `refreshToken`: 刷新令牌
  - `expiresAt`: 令牌过期时间
  - `userInfo`: 用户信息
- **关系**: 用于所有飞书 API 调用

### UploadConfig
表示上传配置
- **属性**:
  - `targetType`: 目标类型（drive 或 wiki）
  - `targetId`: 目标位置 ID
  - `enableImageUpload`: 是否上传图片
  - `enableAttachmentUpload`: 是否上传附件
  - `frontMatterHandling`: Front Matter 处理方式
  - `codeBlockFilters`: 代码块过滤语言列表
  - `maxRetries`: 最大重试次数
  - `rateLimitConfig`: 频率限制配置

## 成功标准

### 可衡量的结果

- **SC-001**: 95% 的标准 Markdown 语法能够正确转换为飞书文档格式
- **SC-002**: 单个文档上传（不含文件）在 5 秒内完成
- **SC-003**: 包含 10 张图片的文档上传在 30 秒内完成
- **SC-004**: OAuth 认证流程在 60 秒内完成
- **SC-005**: Token 自动刷新成功率达到 99%
- **SC-006**: API 调用失败时，80% 的情况通过重试能够成功
- **SC-007**: 系统能够处理至少 100MB 的 Markdown 文件
- **SC-008**: 系统能够处理至少 50 个本地文件引用
- **SC-009**: 频率控制能够确保不触发飞书 API 限制（429 错误）
- **SC-010**: 所有 MCP 工具调用的响应时间在 3 秒内（不含文件上传）
- **SC-015**: 批量上传 10 个文档时，单个文档失败不影响其他文档的上传
- **SC-016**: 批量操作能够自动控制频率，确保不触发飞书 API 限制

### 用户体验标准

- **SC-011**: 错误信息清晰明确，包含问题原因和解决建议
- **SC-012**: 上传进度能够实时反馈给用户
- **SC-013**: 配置过程简单，用户能在 5 分钟内完成首次设置
- **SC-014**: 文档格式转换后，视觉效果与原 Markdown 相似度达到 90%

## 假设

1. **飞书 API 稳定性**: 假设飞书 API 服务稳定可用，响应时间在正常范围内
2. **网络环境**: 假设用户网络环境稳定，能够访问飞书 API
3. **文件系统访问**: 假设系统能够读取本地文件系统中的 Markdown 和图片文件
4. **MCP 客户端兼容性**: 假设 MCP 客户端遵循标准 MCP 协议规范
5. **飞书应用权限**: 假设用户创建的飞书应用具有必要的 API 权限
6. **文件格式支持**: 假设飞书 API 支持常见的图片和文档格式
7. **并发限制**: 假设单个用户不会同时上传超过 10 个文档
8. **存储空间**: 假设用户的飞书账号有足够的存储空间

## 非功能需求

### 性能需求
- 单个文档转换延迟不超过 2 秒
- 支持并发处理多个文档（最多 5 个）
- 批量上传 10 个文档（每个约 1MB）在 60 秒内完成
- 内存占用不超过 500MB

### 安全需求
- OAuth tokens 必须加密存储
- 不在日志中记录敏感信息（tokens、密钥）
- 支持 HTTPS 传输

### 可靠性需求
- 实现自动重试机制（最多 3 次）
- 实现优雅降级（文件上传失败不影响文本上传）
- 提供详细的错误日志

### 可维护性需求
- 代码遵循项目现有架构规范（AGENTS.md）
- 提供完整的 TypeScript 类型定义
- 提供单元测试覆盖率达到 80%

## 技术约束

1. **必须遵循项目现有架构**: 使用 DI 容器、ToolDefinition 模式等
2. **必须使用 TypeScript**: 保持类型安全
3. **必须实现 MCP 协议**: 通过 MCP 工具暴露功能
4. **必须使用飞书官方 API**: 不依赖第三方代理服务
5. **必须支持 stdio 和 HTTP 传输**: 兼容不同的 MCP 客户端
6. **OAuth 授权需要 HTTP 模式**: OAuth 回调通过 HTTP 传输的 `/oauth/callback` 端点接收，stdio 模式下需要提示用户切换到 HTTP 模式完成授权

## 排除范围

以下功能明确不在本次实现范围内：

1. **Obsidian 插件功能**: 不保留任何 Obsidian 特定的 UI 或插件 API
2. **实时同步**: 不支持文档的实时双向同步
3. **版本控制**: 不实现文档版本历史管理
4. **协作功能**: 不实现多人协作编辑
5. **离线模式**: 不支持离线缓存和离线上传
6. **批量导出**: 不支持从飞书批量导出文档
7. **模板系统**: 不实现文档模板功能
8. **自动化触发**: 不实现文件监听和自动上传

## 依赖关系

### 外部依赖
- 飞书开放平台 API
- MCP SDK (@modelcontextprotocol/sdk)
- 项目现有的存储服务（StorageService）
- 项目现有的日志服务（Logger）

### 内部依赖
- 需要用户提供飞书应用凭证（App ID、App Secret）
- 需要用户完成 OAuth 授权流程
- 需要配置文件或环境变量支持

## 迁移策略

从 feishushare 项目迁移到 MCP 服务的策略：

1. **提取核心逻辑**: 
   - MarkdownProcessor: Markdown 处理逻辑
   - FeishuApiService: 飞书 API 调用逻辑
   - ImageProcessingService: 图片处理逻辑

2. **移除 Obsidian 依赖**:
   - 移除 `obsidian` 包依赖
   - 移除 UI 相关代码（Notice、Modal 等）
   - 移除 Obsidian 特定的文件系统 API

3. **适配 MCP 架构**:
   - 创建 ToolDefinition 定义
   - 使用 DI 容器管理服务
   - 使用项目的 StorageService 存储配置和 tokens

4. **保持功能对等**:
   - 确保所有核心功能都能通过 MCP 工具访问
   - 保持相同的错误处理和重试逻辑
   - 保持相同的频率控制机制

## 后续阶段

本规范完成后，可以考虑的后续功能：

1. **批量操作**: 支持批量上传多个文档
2. **文档搜索**: 在飞书中搜索已上传的文档
3. **权限管理**: 设置文档的分享权限
4. **统计分析**: 提供上传统计和使用分析
5. **模板支持**: 支持使用飞书文档模板
6. **Webhook 集成**: 支持飞书文档变更通知

---

## 澄清记录

详细的澄清过程和决策记录请参见 [clarifications.md](./clarifications.md)。

### 澄清会话 2025-01-15

本次澄清解决了以下关键问题：

1. **OAuth 授权回调处理** → 使用 HTTP 传输模式的 `/oauth/callback` 端点
2. **本地文件路径解析** → 文件路径自动推断，内容需提供工作目录
3. **Token 存储策略** → 支持多应用配置，按 App ID 隔离
4. **文档更新冲突处理** → 时间戳检测冲突，支持强制覆盖
5. **批量操作策略** → 提供批量上传工具，自动频率控制和错误隔离

---

## 附录

### 参考资料
- 飞书开放平台文档: https://open.feishu.cn/document/
- MCP 协议规范: https://modelcontextprotocol.io/
- feishushare 项目: feishushare/ 目录

### 术语表
- **MCP**: Model Context Protocol，模型上下文协议
- **OAuth 2.0**: 开放授权标准
- **Front Matter**: Markdown 文件头部的元数据区域
- **Callout**: Markdown 扩展语法，用于创建提示框
- **Wiki**: 飞书知识库
- **Drive**: 飞书云空间
