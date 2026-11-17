# API Request 桌面版

桌面版使用 Tauri、Rust、SQLite 和系统 WebView。HTTP、GraphQL、WebSocket、自动化、压测、Mock 和历史响应在单人工作区运行。原生包只有一套构建和数据格式。

## 本地数据

- 历史页从 SQLite 分页读取。搜索和星标过滤覆盖整个历史库。新工作区默认归档响应，可在历史页调整归档与清理规则。
- 「设置 → 数据管理 → 工作区备份」把数据库和响应文件导出到一个文件夹。恢复需要选择整个备份文件夹。应用验证数据后重启进入备份，原工作区仍留在本机。备份可能包含工作区凭证。
- 桌面版使用自身 SQLite 数据目录。浏览器和 Electron 的旧工作区格式不在支持范围内。HTTP 和 GraphQL 标签与集合统一保存在接口管理中。

## AI 与本地文档

在「AI 接入」生成连接配置并加入支持 Streamable HTTP 的 MCP 客户端。端点只监听本机，连接令牌有效期为 90 天。读取配置可直接执行，新增、修改和删除须在桌面应用里审批。自动化、压测、WebSocket 计划保存在同一工作区。

在集合文档界面发布后，可从同一台电脑的浏览器打开文档快照。文档链接依赖应用运行。快照保留接口描述和路径，省略请求头、认证、正文、主机和查询参数。

## 构建和验收

安装仓库指定的 Node.js、pnpm 和 Rust 后依次运行。

```sh
python3 desktop/prepare-capture.py
pnpm --dir desktop run prepare:native
cargo test --locked --manifest-path desktop/workbench-core/Cargo.toml
cargo build --locked --manifest-path desktop/src-tauri/Cargo.toml
python3 desktop/src-tauri/tests/smoke.py desktop/src-tauri/target/debug/apirequest-native --save-only
python3 desktop/src-tauri/tests/smoke.py desktop/src-tauri/target/debug/apirequest-native
(cd desktop && npm exec --yes --package=@tauri-apps/cli@2.11.3 -- tauri build --bundles dmg)
```

Windows 使用 `--bundles nsis`，调试可执行文件以 `.exe` 结尾。窗口测试使用独立数据目录和回环端口。

macOS 安装包使用 ad-hoc 签名封装整个 `.app` 及其资源。CD 在上传前挂载生成的 DMG，校验镜像完整性、应用签名与 ARM64 架构；本地可运行 `python3 desktop/verify-macos-installer.py 安装包.dmg` 执行相同检查。当前安装包没有 Apple Developer ID 签名及公证，首次下载打开时可能需要在「系统设置 → 隐私与安全性」中允许打开；ad-hoc 签名不会使应用成为 Apple 已验证的开发者应用。参见 [Tauri macOS 签名说明](https://tauri.app/distribute/sign/macos/)。

普通提交推送到 `master`、以及向 `master` 提交 PR 时运行 CI 测试。推送 `v版本号` 标签时运行桌面 CD，构建 Windows x64 和 macOS Apple Silicon（ARM64）安装包，两种平台均通过窗口验收后发布到 GitHub Releases。Docker 镜像通过单独的手动任务发布。

发布时先用 `npm --prefix desktop version patch --no-git-tag-version` 更新版本，提交并推送到 `master`，确认 CI 通过，再为该提交创建并推送同版本标签。例如应用版本为 `0.1.1` 时：

```sh
git tag -a v0.1.1 -m "API Request 0.1.1"
git push origin v0.1.1
```

CD 要求标签与 `desktop/package.json` 版本完全一致，且标签提交属于 `master`；轻量标签和附注标签均受支持。只修改版本文件而不推送标签时仍仅运行 CI。原生前端独立构建。团队后端的 GraphQL 文档由网页版生成和加载，原生客户端直接向用户填写的 GraphQL 地址发送请求。

## 流量抓包

抓包只作用于运行应用的这台电脑，提供「系统代理」和「本机透明捕获」两种方式。
系统代理默认监听回环地址 `127.0.0.1:18888`，同一端口识别 HTTP（包括 HTTPS CONNECT）
与 SOCKS5。macOS 和 Windows 可自动配置本机系统代理；不支持自动设置的平台使用本机应用的代理配置。
透明捕获不接管系统 PAC；首次使用依赖操作系统授权和引擎提供的原生重定向组件。

进入页面只启动控制进程，不自动开始捕获。顶部按钮在「开始记录／暂停记录」之间切换；
暂停不关闭网络入口，恢复继续写原会话。新建会话放在会话面板，暂停时也可以新建。
捕获设置中修改模式前需要暂停，保存时关闭旧入口、恢复本应用持有的代理配置。
应用退出时关闭本次连接、停止重放并恢复代理，不删除归档和证书。

HTTPS 解密需要在本机信任抓包 CA。证书下载、信任与移除放在捕获设置，信任操作由用户明确确认。
网页部署也只捕获运行抓包程序的机器；浏览器不会自动捕获访问页面的其他电脑。
WireGuard、远程设备登记、独立接入凭据、设备筛选和规则的设备范围均已移除。

抓包工作台采用应用与域名筛选、虚拟滚动表格和请求详情。可以按协议、内容类型、
状态码搜索和筛选，选择显示列并排序；详情可放在右侧或下方，窄窗口使用单条详情视图。
正文支持 JSON 树、XML、表单、图片、音视频、文本和十六进制预览。SSE 按事件查看，
WebSocket 可查看消息方向、时间和文本；耗时面板展示代理实际观测的阶段，复用连接没有
新建连接的耗时，DNS 仅在导入来源提供时显示。响应对比使用只读差异高亮。

规则使用表单编辑，支持启停、调整同类型匹配优先级、请求和响应断点、同源 URL 改写、
本地响应以及延迟和请求失败模拟。当前会话应用规则后，详情中可查看实际命中顺序。
断点支持修改普通请求头、同源 URL、响应状态和正文；认证、连接控制头继续受保护。

会话自动归档到应用数据目录的 `capture-ca/sessions/`。每条请求使用独立元数据文件，
请求开始即进入紧凑顺序索引，实时与历史统一分页查询；内存缓存淘汰后主列表仍可访问旧记录。
完整 HTTP 正文逐块直接写入磁盘，没有待写盘队列，也不设置磁盘归档总量上限。引擎停止或显示缓存淘汰后，仍可打开历史会话和下载已记录的完整正文。
磁盘不足和权限错误会显示归档不完整；磁盘较慢时会拖慢代理转发。
完整正文始终随请求归档，不提供单独的存储开关。删除会话会同时删除正文。

设置页的抓包限额组及 15 项配置均已删除。列表和消息从磁盘分页读取，普通请求头、
HTTP 正文及 WebSocket 消息不会按旧的条数或长度截断。正文预览缓冲根据机器内存
自动分配，不影响已写盘的内容。
HAR 文件导入已移除；导出按当前筛选覆盖
全部已完成请求，完整正文直接从磁盘串流输出。旧 IndexedDB 会话在打开会话面板时
迁入磁盘，成功后才移除旧条目。磁盘归档目录不在工作区数据库备份中，可通过 HAR
另行导出；CA 私钥不会加入 HAR。

原始请求头、地址、正文直接保存在本地归档，认证头和 Cookie 完整保留。重放统一读取
磁盘记录，没有独立的重放缓存和开关；一条发送完成后再读取下一条正文。停止或重启
引擎不会删除原记录，重新开始抓包后可重放目标范围内的完整记录。HAR 和转为接口也
保留原始认证信息。HTTP/3 和 WebSocket 不进入 HTTP 原样重放。规则配置在本机持久保存，重启后仍可使用；进程信息由本机原生捕获提供。

桌面构建会随安装包提供锁定版本的抓包引擎。首次启动 macOS 抓包时解包引擎，Windows
直接使用随包提供的可执行文件。
