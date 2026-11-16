# Mock 工作台

网页单人工作区与原生桌面版使用相同的规则格式和面板。Mock 统一使用规则工作台；接口集合中的响应示例用于接口管理和文档，不再自动作为 Mock 服务。

## 配置与调试

单个 Mock 的新建编辑先保存在当前窗口中，点击「保存」后才写入服务和规则。关闭并放弃草稿不会留下空项；保存失败保留输入内容，可继续修改或重试。集合在名称确认页保存后创建，集合内新规则同样在编辑器保存后才生效。

- 单个 Mock 包含一条规则；Mock 集合可组织多条规则。优先级数值越大越先匹配，同优先级按列表顺序匹配。
- 路径支持完全相等、`:id` 参数、`*`/`**` 通配符及受限正则。条件支持 Query、Header、Cookie 和 JSON 字段，提供相等、不等、包含、正则、存在性、数值比较和 JSON 部分匹配。正文的 `$` 表示整个正文，嵌套字段使用 `order.items.0.id`。
- 响应动作包括 HTTP、文件、SSE、断连、代理转发、脚本响应、外部回调和 WebSocket。每一步可设置次数和延迟，结束后可重复最后一步、循环或继续匹配其他规则。
- 高级配置可设置到期时间和场景。相同场景名称的规则共享状态，初始状态是 `STARTED`，命中后切换到配置的下一状态。状态在选择响应时提交；客户端随后断开不会撤销命中。
- 编辑器中的「匹配预览」检查当前尚未保存的规则，显示匹配顺序、未命中原因和动态响应结果，不发送请求、不消耗次数、不改变场景。

## 动态响应

在响应步骤中开启动态响应，正文和响应头可使用：

```text
{{query.id}}
{{headers.x-request-id}}
{{body.user.name}}
{{path.id}}
{{uuid}}
{{timestamp}}
{{isoDate}}
{{randomInt:1:100}}
```

JSON 中完整占位值保留原始类型，例如 `{"active":"{{body.active}}"}` 可输出布尔值；嵌入字符串的值作为文本插入，字符串内容会正确转义。缺失字段输出空字符串。模板不执行脚本。WebSocket 回复还可以引用 `{{message}}`。

## 脚本和回调

选择「脚本响应」后，可用标准 JavaScript 定义函数、循环和分支，读取 `request.method`、`request.path`、`request.params`、`request.query`、`request.headers`、`request.body` 和 `request.secure`，返回响应对象：

```javascript
function calculate(items) {
  let total = 0
  for (const item of items) total += item.price * item.quantity
  return total
}
const total = calculate(request.body.items ?? [])
return {
  statusCode: total > 100 ? 201 : 200,
  headers: { "content-type": "application/json" },
  cookies: ["session=demo; HttpOnly; SameSite=Lax"],
  body: { id: request.params.id, total }
}
```

脚本为同步 JavaScript，隔离运行，每次请求使用独立上下文；不提供文件、系统、模块导入、计时器或网络 API。执行时限可设置为 10–5000 ms，默认 1000 ms，内存上限 32 MiB。脚本预览不增加命中次数。

需要外部服务计算时，选择「外部回调」：向配置的 HTTP/HTTPS 地址 POST 请求上下文 JSON，回调返回上面相同结构的 JSON 对象。可配置请求头和超时；非成功状态、非 JSON、超时和超出大小限制都会失败，不会直接透传成正常 Mock 响应。匹配预览只展示回调配置，不会调用外部服务；实际请求、发送测试请求和回放会执行回调。

## Cookie、协议和结构匹配

「响应 Cookie」每行填写一条原始 `Set-Cookie`，支持同时写入、更新和删除多个 Cookie，例如：

```text
session=abc; HttpOnly; SameSite=Lax
old_session=; Max-Age=0
```

也支持在响应头 JSON 中填写 `Set-Cookie` 字符串或字符串数组，保存时会归入 Cookie 配置。脚本和回调可通过 `cookies` 数组返回它们。Cookie 会进入真实 HTTP 响应头、日志和从记录生成的规则，代理转发也保留上游 Cookie。路径入口的 Cookie 会限定在当前 Mock 的路径，并移除 Domain，避免影响工作台；子域名入口保留配置的作用域。`Secure` Cookie 仍遵循客户端的 HTTPS 行为。

「高级配置 → 请求协议匹配」可以选择 HTTP、HTTPS 或两者；调试区可以按 HTTPS 请求预览。网页端遵循实际连接和已配置的 `TRUST_PROXY` 策略，WebSocket 使用对应的 ws/wss 安全连接状态；桌面端当前仅监听 HTTP，HTTPS 规则可预览但不会在 HTTP 监听上命中。

正文条件新增三个专用操作符：

- **JSON Schema**：键填写 `$` 或嵌套字段，值填写 Schema JSON。支持 Draft 7、2019-09、2020-12、内部引用、组合条件、数组和常见格式。不自动加载远程引用。
- **JSONPath**：键填写查询，例如 `$..items[?(@.price > 10)].id`，在整个 JSON 正文查询；值留空检查有结果，填写值则匹配任意结果。
- **XML XPath 1.0**：键填写 XPath，例如 `/orders/order/@id`、`count(//order)`，在 XML 正文查询；值留空检查节点或布尔结果，填写值则比较查询结果。可在命名空间 JSON 中设置前缀到 URI 的映射。包含 DTD/实体声明的 XML 不参与匹配。

## 转发与录制

规则可指定上游 HTTP/HTTPS 地址，覆盖方法、路径和请求头，移除请求头，选择是否保留查询参数。上游地址的路径作为前缀；改写路径支持请求动态值。没有规则命中时，可在服务设置中启用默认转发。

转发保留原始请求字节，响应按流传送；连接控制头与 Mock 自身的访问密钥不会直接透传。网页端还会从匹配、转发和记录中移除本工作区的会话 Cookie，保留上游应用自己的 Cookie。响应继续遵守现有的同源内容限制。连续经过三个 Mock 转发节点后终止，防止循环转发。

「录制代理响应」控制是否保留上游响应正文。普通 Mock 响应自动记入请求记录。记录展示请求、响应、命中规则和步骤、耗时及当时的匹配过程。点击记录直接进入详情，可再次发送请求，或生成一条待检查和保存的 Mock 规则。生成规则不会自动覆盖现有规则；在编辑器保存后才生效。gzip、deflate、Brotli 的录制结果可解压后生成规则。

## 回放

回放只向当前 Mock 服务发送，保留原始方法、查询参数与请求字节；它会消耗命中次数并推进场景。服务调试区也可直接发送 HTTP 测试请求。

重置单条规则只重置它的次数，重置整个服务会同时清空场景状态。

## WebSocket 与边界

WebSocket 规则支持连接后推送文本或二进制消息、按收到的消息类型和内容匹配并回复、消息间隔和指定关闭代码。访问相同路径的 `ws://`/`wss://` 地址；复制 WebSocket 规则地址时自动切换协议。请求记录保留会话中的消息方向和内容。HTTP 和 WebSocket 规则可以使用相同路径。

- 二进制推送、匹配值和回复使用 Base64 配置，可与文本消息混合；匹配器可限定文本、二进制或任意消息。动态二进制回复可以引用 `{{message}}` / `{{messageBase64}}`（收到的二进制内容，以 Base64 表示）。会话日志保留前 200 条消息，单条内容最多 64 KiB，二进制日志明确标记 Base64；服务端单条接收消息最多 1 MiB。
- 单条录制正文和文件响应上限 10 MiB；超出的流仍会转发，但不允许从不完整记录生成规则。回放/测试结果最多读取 10 MiB。
- 每个规则集最多 1000 条规则，每条最多 20 个条件、30 个响应步骤；规则正文与元数据合计最多 1 MiB，文件另计，总文件上限 20 MiB。
- SSE 最多 50 个事件，事件间隔累计最多 60 秒。正则不支持回溯引用、环视或量化分组，以保持两端一致。
- 桌面版服务只监听本机回环地址，依赖应用保持运行。网页端规则保存在 PostgreSQL，桌面端保存在 SQLite；桌面端新规则日志逐条存储、分页读取。

## 验证入口

后端回归测试：`mock-advanced.spec.ts`、`mock-rule.service.spec.ts`、`mock-engine.spec.ts`、`mock-transport.spec.ts`、`mock-server.service.spec.ts`、`mock-file-response.spec.ts`。面板工作流测试：`components/mockServer/__tests__/workflows.spec.ts`、`components/mockServer/__tests__/editor.spec.ts`、`components/mockServer/__tests__/locales.spec.ts`。原生网络与持久化测试位于 `desktop/src-tauri/src/mock/rules.rs`，SQLite 原子批量写入与正文投影测试位于 `desktop/workbench-core/src/store.rs`。

原生窗口专项验收：构建桌面调试版后运行 `python3 desktop/src-tauri/tests/smoke.py desktop/src-tauri/target/debug/apirequest-native --mock-only`，覆盖请求面板、规则编辑、动态预览、日志回放、录制、代理、WebSocket 和重启恢复。
