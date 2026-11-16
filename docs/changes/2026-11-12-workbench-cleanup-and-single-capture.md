# 工作台整理与单机抓包

## 背景与范围

将本地单人 API 工作台的现有修改集中保存为一次提交。范围包括独立 Mock 规则、AI 审批、导航与调试交互整理、单机抓包，以及桌面打包接入。用户最终选择移除 WireGuard、多设备管理和独立请求 Agent，不再维护这些入口及其兼容分支。

## 设计与实现

### 单机抓包

- 抓包独立于接口集合，支持系统代理和本机透明捕获，抓取的是抓包引擎所在机器的流量。网页部署在服务器时不会自动捕获访问网页的另一台电脑。
- Python `CaptureController` 统一管理单个运行实例、配置版本和会话资源；网页服务与桌面 IPC 复用控制入口。管理请求格式为 `{action,input}`。
- 系统代理监听回环地址并接收 HTTP CONNECT / SOCKS5；透明捕获依赖本机原生组件和授权。打开页面不会自动启用系统代理。
- 开始和暂停合为一个状态按钮。暂停停止新记录但保留转发；新建会话位于会话面板，支持重命名。已有进行中的请求继续写入原会话，完成后才释放旧会话资源。
- 配置使用版本校验防止覆盖。活动会话不能被删除或导入覆盖；原有会话文件保留。旧多设备配置不再读取，不提供设备或 WireGuard 接入动作。
- 抓包详情提供正文预览、按需查找、高亮与跳转、内容类型对应的下载、响应对比及规则编辑。应用信息来自捕获引擎的原生进程元数据。
- 管理接口保留本机所有者认证和同源校验；运行时凭证、CA 私钥、流量正文、浏览器缓存及构建产物不纳入 Git。
- 桌面应用负责捕获引擎准备、启动与退出清理；构建流程覆盖引擎资源准备和测试。历史设计说明移入抓包 `HISTORY.md`，当前契约以相邻 `README.md` 为准。

### Mock、AI 和工作台

- Mock 可独立创建单条规则或规则集合，配置请求匹配、响应顺序、生效次数、延迟、失败及 SSE；不再必须依赖现有接口的响应示例。
- Mock 后端增加规则管理接口，并扩展 Prisma 数据：`MockServer.ruleSet`、`MockServerLog.mockMatch`。新增迁移添加两个 JSONB 列，不修改旧迁移。
- AI 接入页整理连接、审批和配置列表；允许用户控制普通修改的审批要求，删除和文档变更继续要求审核。网页和桌面的 MCP 说明同步调整。
- 导航支持显示、隐藏、排序和恢复默认；设置始终可见，抓包默认第二位。Mock 和文档开关放回对应页面；移除冗余工作区标题、重复运行入口和实验说明。
- 调试布局切换放到请求工具栏；变量和其他参数标签统一排列。移除独立授权标签，但请求发送仍处理已有鉴权数据。
- REST、GraphQL 和 WebSocket 切换保留当前标签身份及协议草稿，并清理旧连接，避免每次切换都新增标签。
- 移除独立请求 Agent、扩展和公共 Proxy 的设置、选择器及失效接入。网页使用内置转发，桌面使用 Native；底层有效的请求发送能力继续保留。
- 清理失效翻译键和依赖，补充相关界面翻译。

## 数据、配置与部署注意事项

- 本次涉及数据库迁移，部署后端前需通过项目现有 Prisma 部署流程应用迁移。数据库恢复与代码回退应分别处理；不要直接删除已有 Mock 数据。
- 抓包会话仍使用现有归档目录；新单机配置使用 `capture.json`。旧设备配置不再生效，但此次代码修改不删除用户磁盘文件。
- 退出需取消尚未完成的引擎启动、释放监听、关闭归档并恢复由本次启动设置的系统代理。不得停止其他应用的代理进程。
- macOS / Windows 的证书信任和透明捕获权限由系统控制；服务器管理接口不会替访问电脑安装证书。
- Linux 容器仅提供管理服务，不将回环代理或 UDP 隧道发布为多设备入口。服务器部署不等同于浏览器客户端的透明捕获。
- 本次只提交本地版本，不执行推送、发布安装包或远程部署。

## 验证记录

以下为提交前本轮已有验证证据的汇总，原始诊断日志保存在本机临时测试目录，不将真实流量或私有配置纳入提交。

| 验证 | 实际结果与边界 |
| --- | --- |
| Python 单元测试 | 23 项通过：捕获模式、系统代理、启动取消、暂停、归档和会话生命周期等 |
| 真实捕获引擎 smoke | HTTP / SOCKS 转发、磁盘重放、完整正文分页、暂停恢复、会话切换及重命名、活动保护、进行中请求保留、规则持久化、重启和端口清理通过 |
| Node 管理接口 | 6 项测试通过；真实引擎集成验证所有者认证、同源校验、配置版本冲突、移除动作拒绝等 |
| 桌面 IPC | `capture::tests::captures_real_http_through_packaged_engine` 通过（1 项），使用临时数据和空闲端口 |
| 浏览器交互 | 模拟管理 API 验证单机工具栏、两种模式、开始暂停、加载状态、会话新建、规则和窄屏布局；没有改动实际系统代理 |
| 前端构建 | 网页生产构建和桌面前端构建通过 |
| 类型检查 | 抓包文件未报告类型错误；项目其他文件仍有现存诊断，不能视为全项目类型检查通过 |
| 全仓提交钩子 | 初次提交因环境缺少 `npm` 中止；直接运行 `pnpm -r do-lint` 后，未安装依赖的 `apirequest-agent` 包因缺少 `eslint` 中止，后续全仓类型检查未运行。本次用 `HUSKY=0` 跳过钩子完成用户要求的本地快照提交，不宣称全仓检查通过 |
| 提交检查 | `git diff --check` 通过；构建输出、运行时凭证和调试浏览器目录已排除 |

此前工作台修改有相关前端测试和构建记录；本次提交未重新执行所有历史功能的完整业务验收。独立 Mock 的 PostgreSQL 迁移及全量后端业务验收、Windows 真机捕获、系统权限弹窗和正式安装包发布未在此次提交收尾阶段重新验证。构建通过不代替这些验收。

测试启动的隔离引擎、浏览器和临时 HTTP 服务已清理并核验端口释放；供用户查看的既有调试服务继续运行。

## 关闭与回退

先暂停记录、退出捕获引擎并核验系统代理恢复，再停止调试服务或回退代码。会话目录和证书文件不随代码回退删除。数据库迁移后的数据需要单独备份与恢复；旧程序不应继续写入新增独立 Mock 规则配置。

## 全部变更文件

下面按提交前实际 Git 差异列出产品修改、新文件和删除文件。浏览器生成目录不在此列表，提交说明和索引也一并保存。

| 类型 | 文件 |
| --- | --- |
| 修改 | [.github/workflows/release-workbench-desktop.yml](../../.github/workflows/release-workbench-desktop.yml) |
| 修改 | [.gitignore](../../.gitignore) |
| 修改 | `README.md` |
| 修改 | [desktop/.gitignore](../../desktop/.gitignore) |
| 修改 | [desktop/README.md](../../desktop/README.md) |
| 新增 | [desktop/prepare-capture.py](../../desktop/prepare-capture.py) |
| 修改 | [desktop/src-tauri/Cargo.lock](../../desktop/src-tauri/Cargo.lock) |
| 修改 | [desktop/src-tauri/Cargo.toml](../../desktop/src-tauri/Cargo.toml) |
| 新增 | [desktop/src-tauri/src/capture.rs](../../desktop/src-tauri/src/capture.rs) |
| 新增 | [desktop/src-tauri/src/capture_storage.rs](../../desktop/src-tauri/src/capture_storage.rs) |
| 修改 | [desktop/src-tauri/src/main.rs](../../desktop/src-tauri/src/main.rs) |
| 修改 | [desktop/src-tauri/src/mcp.rs](../../desktop/src-tauri/src/mcp.rs) |
| 修改 | [desktop/src-tauri/tauri.conf.json](../../desktop/src-tauri/tauri.conf.json) |
| 修改 | [desktop/src-tauri/tests/smoke.js](../../desktop/src-tauri/tests/smoke.js) |
| 修改 | [desktop/src-tauri/tests/smoke.py](../../desktop/src-tauri/tests/smoke.py) |
| 新增 | [docs/changes/2026-11-12-workbench-cleanup-and-single-capture.md](../../docs/changes/2026-11-12-workbench-cleanup-and-single-capture.md) |
| 新增 | [docs/changes/README.md](../../docs/changes/README.md) |
| 修改 | [docs/workbench-mcp.md](../../docs/workbench-mcp.md) |
| 新增 | [packages/apirequest-backend/prisma/migrations/20261110090000_independent_mock_rules/migration.sql](../../packages/apirequest-backend/prisma/migrations/20261110090000_independent_mock_rules/migration.sql) |
| 修改 | [packages/apirequest-backend/prisma/schema.prisma](../../packages/apirequest-backend/prisma/schema.prisma) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-request.guard.ts](../../packages/apirequest-backend/src/mock-server/mock-request.guard.ts) |
| 新增 | [packages/apirequest-backend/src/mock-server/mock-rule.controller.ts](../../packages/apirequest-backend/src/mock-server/mock-rule.controller.ts) |
| 新增 | [packages/apirequest-backend/src/mock-server/mock-rule.service.ts](../../packages/apirequest-backend/src/mock-server/mock-rule.service.ts) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-server-logging.interceptor.ts](../../packages/apirequest-backend/src/mock-server/mock-server-logging.interceptor.ts) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-server.controller.ts](../../packages/apirequest-backend/src/mock-server/mock-server.controller.ts) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-server.model.ts](../../packages/apirequest-backend/src/mock-server/mock-server.model.ts) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-server.module.ts](../../packages/apirequest-backend/src/mock-server/mock-server.module.ts) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-server.resolver.ts](../../packages/apirequest-backend/src/mock-server/mock-server.resolver.ts) |
| 修改 | [packages/apirequest-backend/src/mock-server/mock-server.service.ts](../../packages/apirequest-backend/src/mock-server/mock-server.service.ts) |
| 修改 | [packages/apirequest-backend/src/workbench-mcp/mcp.controller.ts](../../packages/apirequest-backend/src/workbench-mcp/mcp.controller.ts) |
| 修改 | [packages/apirequest-backend/src/workbench-mcp/mcp.service.ts](../../packages/apirequest-backend/src/workbench-mcp/mcp.service.ts) |
| 修改 | [packages/apirequest-common/locales/af.json](../../packages/apirequest-common/locales/af.json) |
| 修改 | [packages/apirequest-common/locales/ar.json](../../packages/apirequest-common/locales/ar.json) |
| 修改 | [packages/apirequest-common/locales/ca.json](../../packages/apirequest-common/locales/ca.json) |
| 修改 | [packages/apirequest-common/locales/cn.json](../../packages/apirequest-common/locales/cn.json) |
| 修改 | [packages/apirequest-common/locales/cs.json](../../packages/apirequest-common/locales/cs.json) |
| 修改 | [packages/apirequest-common/locales/da.json](../../packages/apirequest-common/locales/da.json) |
| 修改 | [packages/apirequest-common/locales/de.json](../../packages/apirequest-common/locales/de.json) |
| 修改 | [packages/apirequest-common/locales/el.json](../../packages/apirequest-common/locales/el.json) |
| 修改 | [packages/apirequest-common/locales/en.json](../../packages/apirequest-common/locales/en.json) |
| 修改 | [packages/apirequest-common/locales/es.json](../../packages/apirequest-common/locales/es.json) |
| 修改 | [packages/apirequest-common/locales/fi.json](../../packages/apirequest-common/locales/fi.json) |
| 修改 | [packages/apirequest-common/locales/fr.json](../../packages/apirequest-common/locales/fr.json) |
| 修改 | [packages/apirequest-common/locales/he.json](../../packages/apirequest-common/locales/he.json) |
| 修改 | [packages/apirequest-common/locales/hu.json](../../packages/apirequest-common/locales/hu.json) |
| 修改 | [packages/apirequest-common/locales/hy.json](../../packages/apirequest-common/locales/hy.json) |
| 修改 | [packages/apirequest-common/locales/id.json](../../packages/apirequest-common/locales/id.json) |
| 修改 | [packages/apirequest-common/locales/it.json](../../packages/apirequest-common/locales/it.json) |
| 修改 | [packages/apirequest-common/locales/ja.json](../../packages/apirequest-common/locales/ja.json) |
| 修改 | [packages/apirequest-common/locales/ko.json](../../packages/apirequest-common/locales/ko.json) |
| 修改 | [packages/apirequest-common/locales/mn.json](../../packages/apirequest-common/locales/mn.json) |
| 修改 | [packages/apirequest-common/locales/nl.json](../../packages/apirequest-common/locales/nl.json) |
| 修改 | [packages/apirequest-common/locales/no.json](../../packages/apirequest-common/locales/no.json) |
| 修改 | [packages/apirequest-common/locales/pl.json](../../packages/apirequest-common/locales/pl.json) |
| 修改 | [packages/apirequest-common/locales/pt-br.json](../../packages/apirequest-common/locales/pt-br.json) |
| 修改 | [packages/apirequest-common/locales/pt.json](../../packages/apirequest-common/locales/pt.json) |
| 修改 | [packages/apirequest-common/locales/ro.json](../../packages/apirequest-common/locales/ro.json) |
| 修改 | [packages/apirequest-common/locales/ru.json](../../packages/apirequest-common/locales/ru.json) |
| 修改 | [packages/apirequest-common/locales/sr.json](../../packages/apirequest-common/locales/sr.json) |
| 修改 | [packages/apirequest-common/locales/sv.json](../../packages/apirequest-common/locales/sv.json) |
| 修改 | [packages/apirequest-common/locales/th.json](../../packages/apirequest-common/locales/th.json) |
| 修改 | [packages/apirequest-common/locales/tr.json](../../packages/apirequest-common/locales/tr.json) |
| 修改 | [packages/apirequest-common/locales/tw.json](../../packages/apirequest-common/locales/tw.json) |
| 修改 | [packages/apirequest-common/locales/uk.json](../../packages/apirequest-common/locales/uk.json) |
| 修改 | [packages/apirequest-common/locales/vi.json](../../packages/apirequest-common/locales/vi.json) |
| 修改 | [packages/apirequest-common/package.json](../../packages/apirequest-common/package.json) |
| 修改 | [packages/apirequest-common/src/components.d.ts](../../packages/apirequest-common/src/components.d.ts) |
| 修改 | [packages/apirequest-common/src/components/app/Footer.vue](../../packages/apirequest-common/src/components/app/Footer.vue) |
| 删除 | `packages/apirequest-common/src/components/app/KernelInterceptor.vue` |
| 新增 | [packages/apirequest-common/src/components/app/RequestLayoutToggle.vue](../../packages/apirequest-common/src/components/app/RequestLayoutToggle.vue) |
| 修改 | [packages/apirequest-common/src/components/app/spotlight/index.vue](../../packages/apirequest-common/src/components/app/spotlight/index.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/BodyFind.vue](../../packages/apirequest-common/src/components/capture/BodyFind.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/BodyViewer.vue](../../packages/apirequest-common/src/components/capture/BodyViewer.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/BreakpointEditor.vue](../../packages/apirequest-common/src/components/capture/BreakpointEditor.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/ResponseDiff.vue](../../packages/apirequest-common/src/components/capture/ResponseDiff.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/RuleEditor.vue](../../packages/apirequest-common/src/components/capture/RuleEditor.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/Settings.vue](../../packages/apirequest-common/src/components/capture/Settings.vue) |
| 新增 | [packages/apirequest-common/src/components/capture/Workbench.vue](../../packages/apirequest-common/src/components/capture/Workbench.vue) |
| 修改 | [packages/apirequest-common/src/components/collections/Collection.vue](../../packages/apirequest-common/src/components/collections/Collection.vue) |
| 修改 | [packages/apirequest-common/src/components/collections/Properties.vue](../../packages/apirequest-common/src/components/collections/Properties.vue) |
| 修改 | [packages/apirequest-common/src/components/collections/index.vue](../../packages/apirequest-common/src/components/collections/index.vue) |
| 修改 | [packages/apirequest-common/src/components/cookies/AllModal.vue](../../packages/apirequest-common/src/components/cookies/AllModal.vue) |
| 修改 | [packages/apirequest-common/src/components/embeds/Request.vue](../../packages/apirequest-common/src/components/embeds/Request.vue) |
| 修改 | [packages/apirequest-common/src/components/environments/index.vue](../../packages/apirequest-common/src/components/environments/index.vue) |
| 修改 | [packages/apirequest-common/src/components/gql/Response.vue](../../packages/apirequest-common/src/components/gql/Response.vue) |
| 修改 | [packages/apirequest-common/src/components/gql/ResponseMeta.vue](../../packages/apirequest-common/src/components/gql/ResponseMeta.vue) |
| 修改 | [packages/apirequest-common/src/components/history/index.vue](../../packages/apirequest-common/src/components/history/index.vue) |
| 修改 | [packages/apirequest-common/src/components/http/Headers.vue](../../packages/apirequest-common/src/components/http/Headers.vue) |
| 修改 | [packages/apirequest-common/src/components/http/PreRequestScript.vue](../../packages/apirequest-common/src/components/http/PreRequestScript.vue) |
| 修改 | [packages/apirequest-common/src/components/http/ProtocolSwitcher.vue](../../packages/apirequest-common/src/components/http/ProtocolSwitcher.vue) |
| 修改 | [packages/apirequest-common/src/components/http/RequestOptions.vue](../../packages/apirequest-common/src/components/http/RequestOptions.vue) |
| 修改 | [packages/apirequest-common/src/components/http/ResponseMeta.vue](../../packages/apirequest-common/src/components/http/ResponseMeta.vue) |
| 修改 | [packages/apirequest-common/src/components/http/Tests.vue](../../packages/apirequest-common/src/components/http/Tests.vue) |
| 修改 | [packages/apirequest-common/src/components/importExport/ImportExportSteps/FileImport.vue](../../packages/apirequest-common/src/components/importExport/ImportExportSteps/FileImport.vue) |
| 修改 | [packages/apirequest-common/src/components/importExport/ImportExportSteps/UrlImport.vue](../../packages/apirequest-common/src/components/importExport/ImportExportSteps/UrlImport.vue) |
| 修改 | [packages/apirequest-common/src/components/lenses/ResponseBodyRenderer.vue](../../packages/apirequest-common/src/components/lenses/ResponseBodyRenderer.vue) |
| 修改 | [packages/apirequest-common/src/components/mockServer/MockServerDashboard.vue](../../packages/apirequest-common/src/components/mockServer/MockServerDashboard.vue) |
| 新增 | [packages/apirequest-common/src/components/mockServer/RuleWorkbench.vue](../../packages/apirequest-common/src/components/mockServer/RuleWorkbench.vue) |
| 删除 | `packages/apirequest-common/src/components/settings/Agent.vue` |
| 删除 | `packages/apirequest-common/src/components/settings/AgentSubtitle.vue` |
| 删除 | `packages/apirequest-common/src/components/settings/Extension.vue` |
| 删除 | `packages/apirequest-common/src/components/settings/ExtensionSubtitle.vue` |
| 修改 | [packages/apirequest-common/src/components/settings/InterceptorErrorPlaceholder.vue](../../packages/apirequest-common/src/components/settings/InterceptorErrorPlaceholder.vue) |
| 删除 | `packages/apirequest-common/src/components/settings/Proxy.vue` |
| 修改 | [packages/apirequest-common/src/components/settings/WorkbenchNavigation.vue](../../packages/apirequest-common/src/components/settings/WorkbenchNavigation.vue) |
| 修改 | [packages/apirequest-common/src/components/workbench/CollectionLauncher.vue](../../packages/apirequest-common/src/components/workbench/CollectionLauncher.vue) |
| 新增 | [packages/apirequest-common/src/components/workbench/Select.vue](../../packages/apirequest-common/src/components/workbench/Select.vue) |
| 修改 | [packages/apirequest-common/src/composables/documentationVisibility.ts](../../packages/apirequest-common/src/composables/documentationVisibility.ts) |
| 修改 | [packages/apirequest-common/src/composables/mockServerVisibility.ts](../../packages/apirequest-common/src/composables/mockServerVisibility.ts) |
| 修改 | [packages/apirequest-common/src/composables/workbenchNavigation.ts](../../packages/apirequest-common/src/composables/workbenchNavigation.ts) |
| 修改 | [packages/apirequest-common/src/helpers/RequestRunner.ts](../../packages/apirequest-common/src/helpers/RequestRunner.ts) |
| 新增 | [packages/apirequest-common/src/helpers/__tests__/workbench-capture-body.spec.ts](../../packages/apirequest-common/src/helpers/__tests__/workbench-capture-body.spec.ts) |
| 新增 | [packages/apirequest-common/src/helpers/__tests__/workbench-capture.spec.ts](../../packages/apirequest-common/src/helpers/__tests__/workbench-capture.spec.ts) |
| 修改 | [packages/apirequest-common/src/helpers/aichat/__tests__/app-actions.spec.ts](../../packages/apirequest-common/src/helpers/aichat/__tests__/app-actions.spec.ts) |
| 修改 | [packages/apirequest-common/src/helpers/aichat/app-actions.ts](../../packages/apirequest-common/src/helpers/aichat/app-actions.ts) |
| 删除 | `packages/apirequest-common/src/helpers/migrations.ts` |
| 新增 | [packages/apirequest-common/src/helpers/mockServer/rules.ts](../../packages/apirequest-common/src/helpers/mockServer/rules.ts) |
| 修改 | [packages/apirequest-common/src/helpers/native-workbench-config.ts](../../packages/apirequest-common/src/helpers/native-workbench-config.ts) |
| 修改 | [packages/apirequest-common/src/helpers/native-workbench-mcp.ts](../../packages/apirequest-common/src/helpers/native-workbench-mcp.ts) |
| 删除 | `packages/apirequest-common/src/helpers/proxyUrl.ts` |
| 新增 | [packages/apirequest-common/src/helpers/tab/__tests__/protocol-switch.spec.ts](../../packages/apirequest-common/src/helpers/tab/__tests__/protocol-switch.spec.ts) |
| 修改 | [packages/apirequest-common/src/helpers/tab/protocol-switch.ts](../../packages/apirequest-common/src/helpers/tab/protocol-switch.ts) |
| 新增 | [packages/apirequest-common/src/helpers/workbench-capture-body.ts](../../packages/apirequest-common/src/helpers/workbench-capture-body.ts) |
| 新增 | [packages/apirequest-common/src/helpers/workbench-capture.ts](../../packages/apirequest-common/src/helpers/workbench-capture.ts) |
| 修改 | [packages/apirequest-common/src/helpers/workbench-mcp.ts](../../packages/apirequest-common/src/helpers/workbench-mcp.ts) |
| 修改 | [packages/apirequest-common/src/lib/sync/settings/index.ts](../../packages/apirequest-common/src/lib/sync/settings/index.ts) |
| 修改 | [packages/apirequest-common/src/modules/kernel-interceptors.ts](../../packages/apirequest-common/src/modules/kernel-interceptors.ts) |
| 删除 | `packages/apirequest-common/src/newstore/HoppExtension.ts` |
| 修改 | [packages/apirequest-common/src/newstore/settings.ts](../../packages/apirequest-common/src/newstore/settings.ts) |
| 修改 | [packages/apirequest-common/src/pages/ai-access.vue](../../packages/apirequest-common/src/pages/ai-access.vue) |
| 新增 | [packages/apirequest-common/src/pages/capture.vue](../../packages/apirequest-common/src/pages/capture.vue) |
| 修改 | [packages/apirequest-common/src/pages/graphql.vue](../../packages/apirequest-common/src/pages/graphql.vue) |
| 修改 | [packages/apirequest-common/src/pages/index.vue](../../packages/apirequest-common/src/pages/index.vue) |
| 修改 | [packages/apirequest-common/src/pages/mock.vue](../../packages/apirequest-common/src/pages/mock.vue) |
| 修改 | [packages/apirequest-common/src/pages/settings.vue](../../packages/apirequest-common/src/pages/settings.vue) |
| 修改 | [packages/apirequest-common/src/platform/infra.ts](../../packages/apirequest-common/src/platform/infra.ts) |
| 删除 | `packages/apirequest-common/src/platform/std/kernel-interceptors/agent/index.ts` |
| 删除 | `packages/apirequest-common/src/platform/std/kernel-interceptors/agent/store.ts` |
| 删除 | `packages/apirequest-common/src/platform/std/kernel-interceptors/extension/index.ts` |
| 删除 | `packages/apirequest-common/src/platform/std/kernel-interceptors/extension/store.ts` |
| 删除 | `packages/apirequest-common/src/platform/std/kernel-interceptors/proxy/index.ts` |
| 删除 | `packages/apirequest-common/src/platform/std/kernel-interceptors/proxy/store.ts` |
| 修改 | [packages/apirequest-common/src/services/ai-chat.service.ts](../../packages/apirequest-common/src/services/ai-chat.service.ts) |
| 修改 | [packages/apirequest-common/src/services/initialization.service.ts](../../packages/apirequest-common/src/services/initialization.service.ts) |
| 修改 | [packages/apirequest-common/src/services/inspection/inspectors/__tests__/scripting-interceptor.inspector.spec.ts](../../packages/apirequest-common/src/services/inspection/inspectors/__tests__/scripting-interceptor.inspector.spec.ts) |
| 修改 | [packages/apirequest-common/src/services/inspection/inspectors/scripting-interceptor.inspector.ts](../../packages/apirequest-common/src/services/inspection/inspectors/scripting-interceptor.inspector.ts) |
| 修改 | [packages/apirequest-common/src/services/persistence/__tests__/index.spec.ts](../../packages/apirequest-common/src/services/persistence/__tests__/index.spec.ts) |
| 修改 | [packages/apirequest-common/src/services/persistence/validation-schemas/index.ts](../../packages/apirequest-common/src/services/persistence/validation-schemas/index.ts) |
| 删除 | `packages/apirequest-common/src/services/spotlight/searchers/kernel-interceptor.searcher.ts` |
| 修改 | [packages/apirequest-common/src/services/spotlight/searchers/request.searcher.ts](../../packages/apirequest-common/src/services/spotlight/searchers/request.searcher.ts) |
| 修改 | [packages/apirequest-common/src/services/tab/index.ts](../../packages/apirequest-common/src/services/tab/index.ts) |
| 修改 | [packages/apirequest-common/src/shims.d.ts](../../packages/apirequest-common/src/shims.d.ts) |
| 修改 | [packages/apirequest-common/src/vite-envs.d.ts](../../packages/apirequest-common/src/vite-envs.d.ts) |
| 新增 | [packages/apirequest-selfhost-web/capture/Dockerfile](../../packages/apirequest-selfhost-web/capture/Dockerfile) |
| 新增 | [packages/apirequest-selfhost-web/capture/HISTORY.md](../../packages/apirequest-selfhost-web/capture/HISTORY.md) |
| 新增 | [packages/apirequest-selfhost-web/capture/README.md](../../packages/apirequest-selfhost-web/capture/README.md) |
| 新增 | [packages/apirequest-selfhost-web/capture/archive.py](../../packages/apirequest-selfhost-web/capture/archive.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/archive_api.py](../../packages/apirequest-selfhost-web/capture/archive_api.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/capture_context.py](../../packages/apirequest-selfhost-web/capture/capture_context.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/capture_modes.py](../../packages/apirequest-selfhost-web/capture/capture_modes.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/compose.example.yml](../../packages/apirequest-selfhost-web/capture/compose.example.yml) |
| 新增 | [packages/apirequest-selfhost-web/capture/controller.py](../../packages/apirequest-selfhost-web/capture/controller.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/memory.py](../../packages/apirequest-selfhost-web/capture/memory.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/nginx.example.conf](../../packages/apirequest-selfhost-web/capture/nginx.example.conf) |
| 新增 | [packages/apirequest-selfhost-web/capture/plugin.ts](../../packages/apirequest-selfhost-web/capture/plugin.ts) |
| 新增 | [packages/apirequest-selfhost-web/capture/proxy_listener.py](../../packages/apirequest-selfhost-web/capture/proxy_listener.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/recorder.py](../../packages/apirequest-selfhost-web/capture/recorder.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/replay.py](../../packages/apirequest-selfhost-web/capture/replay.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/server.ts](../../packages/apirequest-selfhost-web/capture/server.ts) |
| 新增 | [packages/apirequest-selfhost-web/capture/server.vite.config.ts](../../packages/apirequest-selfhost-web/capture/server.vite.config.ts) |
| 新增 | [packages/apirequest-selfhost-web/capture/service.ts](../../packages/apirequest-selfhost-web/capture/service.ts) |
| 新增 | [packages/apirequest-selfhost-web/capture/session.py](../../packages/apirequest-selfhost-web/capture/session.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/storage.ts](../../packages/apirequest-selfhost-web/capture/storage.ts) |
| 新增 | [packages/apirequest-selfhost-web/capture/system_proxy.py](../../packages/apirequest-selfhost-web/capture/system_proxy.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/server.integration.mjs](../../packages/apirequest-selfhost-web/capture/tests/server.integration.mjs) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/server.test.mjs](../../packages/apirequest-selfhost-web/capture/tests/server.test.mjs) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/smoke_single.py](../../packages/apirequest-selfhost-web/capture/tests/smoke_single.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/test_archive_workbench.py](../../packages/apirequest-selfhost-web/capture/tests/test_archive_workbench.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/test_capture_modes.py](../../packages/apirequest-selfhost-web/capture/tests/test_capture_modes.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/test_system_proxy.py](../../packages/apirequest-selfhost-web/capture/tests/test_system_proxy.py) |
| 新增 | [packages/apirequest-selfhost-web/capture/tests/test_system_startup.py](../../packages/apirequest-selfhost-web/capture/tests/test_system_startup.py) |
| 删除 | `packages/apirequest-selfhost-web/src/api/queries/GetProxyAppUrl.graphql` |
| 修改 | [packages/apirequest-selfhost-web/src/main.ts](../../packages/apirequest-selfhost-web/src/main.ts) |
| 修改 | [packages/apirequest-selfhost-web/src/native.ts](../../packages/apirequest-selfhost-web/src/native.ts) |
| 修改 | [packages/apirequest-selfhost-web/src/platform/infra/infra.platform.ts](../../packages/apirequest-selfhost-web/src/platform/infra/infra.platform.ts) |
| 修改 | [packages/apirequest-selfhost-web/vite.config.ts](../../packages/apirequest-selfhost-web/vite.config.ts) |
| 修改 | [pnpm-lock.yaml](../../pnpm-lock.yaml) |
| 修改 | [scripts/workbench-mcp.integration.mjs](../../scripts/workbench-mcp.integration.mjs) |
| 修改 | [scripts/workbench-mcp.mjs](../../scripts/workbench-mcp.mjs) |
