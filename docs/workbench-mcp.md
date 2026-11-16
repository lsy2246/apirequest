# 单人工作台 MCP 接入

在本地工作台打开 **AI 接入**（`/ai-access`），展开 **管理连接**，点击 **启用并生成连接配置**。选择 Codex TOML 或通用 MCP JSON，复制到同一台电脑上的 AI 客户端。令牌只显示一次，替换或关闭接入会撤销旧令牌。

Codex 使用 `config.toml` 的 `[mcp_servers.apirequest]`、`command`、`args` 和 `[mcp_servers.apirequest.env]`。支持 `mcpServers` 的客户端可使用页面生成的 JSON。按 [OpenAI Docs 的 MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) 保存后重新加载客户端。这里使用本机 stdio，`scripts/workbench-mcp.mjs` 由客户端启动，Node.js 22 或更高版本，无额外 npm 依赖。`/v1/workbench-mcp/tool` 是该进程调用的本机后端入口，不是给客户端粘贴的远程 MCP URL。

连接后可对 AI 说：

> 先列出我的接口集合。给测试集合新增一个 GET `/health` 请求，再提议保存一个并发 3、总请求数 20 的压测配置。把待审批的变更告诉我。

| 工具 | 用途 |
| --- | --- |
| `workbench_help` | 返回操作规则、字段、参数范围和各类示例 |
| `workbench_list` | 分页查询配置概要及稳定 ID |
| `workbench_get` | 按 ID 查询一项配置，隐藏识别到的已有凭据 |
| `workbench_propose_change` | 提出一条新增、修改或删除，返回变更前后、提案 ID 和审批入口 |
| `workbench_change_status` | 查询审批及执行结果；`applied` 才表示写入成功 |

支持集合和目录、HTTP/GraphQL 请求、环境与变量、已发布文档、自动化计划、压测计划、WebSocket 连接配置。更新只提交要改的字段：对象递归合并，数组整体替换，`null` 是显式值。文档发布使用已有的发布服务。自动化和压测配置可在对应页面载入；WebSocket 配置可从 AI 接入页载入。运行、发送和连接仍由原有界面发起。

**需要审批**默认开启。关闭后，所有新的新增、修改和删除（包括文档发布、修改和撤销发布）直接执行，结果出现在 **变更记录**，不再按操作类型额外要求审批。切换前已进入队列的提案保留原状态。配置列表在 **已保存配置** 中按自动化测试、压测和 WebSocket 切换。

网页版提案有效期 15 分钟，浏览器显示变更字段及前后内容，可确认或拒绝。执行时重新检查目标快照和引用，已处理提案不能重放。相同 `idempotencyKey` 只用于重试完全相同的提交。正在执行的提案在服务中断后不会自动重试，先核对实际配置。目录删除会列出子目录和请求；有关联文档时先处理关联文档。

实现分为 [stdio 工具](../scripts/workbench-mcp.mjs)、[后端审批](../packages/apirequest-backend/src/workbench-mcp/mcp.service.ts)、[配置适配](../packages/apirequest-backend/src/workbench-mcp/domain.service.ts) 和 [审批页面](../packages/apirequest-common/src/pages/ai-access.vue)。手动审批和修改审批策略要求本机来源、工作台 HttpOnly 会话及固定本机用户。令牌哈希、审批策略、提案和计划保存在 `WorkbenchConfig` 表，内容使用原有数据密钥加密。令牌轮换、策略切换与提案执行在同一服务内串行。

页面通过 `GET /v1/workbench-mcp/events` 订阅统一 SSE 事件，沿用所有者会话、本机来源和
`X-Workbench-Local` 校验；MCP 访问令牌不能订阅此入口。事件按所有者隔离，只通知
`ai`、`plans`、`mock`、`automation` 数据变化，不携带连接凭据、请求正文或审批内容。
写入提交后发布通知，前端合并连续通知再读取数据；所有接入页面始终启用实时更新和后台同步，断线重连时重新读取快照。
后台执行器按请求完成情况报告进度，`automation/runs` 提供当前进程最近的运行摘要，
重启后的历史结果继续从持久化报告读取。桌面页面复用同一订阅接口，由 IPC 和本地配置变更触发。

数据库更新使用 [新增迁移](../packages/apirequest-backend/prisma/migrations/20261105093000_workbench_mcp/migration.sql)，通过 `prisma migrate deploy` 应用。本地预览在既有数据库仅增加该表；关闭入口可直接撤销接入，保留已保存配置和审批记录。回退应用代码不要求删除该表。

验证：Node stdio 测试 4 项，相关 Nest 回归 197 项；使用独立 PostgreSQL 18.6 数据库跑通 [MCP 集成验收](../scripts/workbench-mcp.integration.mjs) 87 项断言，包括八类配置、过期前的审批、拒绝、冲突、重复审批、令牌撤销和凭据脱敏。浏览器验证了待审预览、实际确认写入和载入压测参数。测试未发送外部请求、未启动压测、未修改用户的 AI 客户端配置。详见 [本地验证记录](../scripts/workbench-verification.json)。

协议依据：[MCP stdio 传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP 工具](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)；访问与会话边界参考 [OWASP 认证指南](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) 和 [会话管理指南](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。
