;(async () => {
  // 窗口验收聚焦功能状态，避免后台 WebView 的动画节流阻塞路由切换。
  const animationStyle = document.createElement("style")
  animationStyle.textContent =
    "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }"
  document.head.append(animationStyle)
  // Vue 路由过渡要等两帧，后台 WebView 可能完全暂停原生 RAF。
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16)
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
  const invoke = (command, args) =>
    window.__TAURI_INTERNALS__.invoke(command, args)
  const history = (action) => invoke("workbench_history", { action })
  const target = window.__workbenchSmoke.target
  const expected = '{"desktop":"native relay"}'
  const collection = "原生测试集合"
  const savedRequest = "MCP request"
  const savedCase = "原生用例"
  const store = (key) =>
    invoke("workbench_store", {
      action: {
        type: "get",
        scope: "localhost.apirequest.store",
        key: "data",
      },
    }).then((value) => value?.["persistence.v1"]?.[key]?.data)
  const exactText = (root, selector, label) =>
    [...root.querySelectorAll(selector)].find(
      (node) => node.textContent.trim() === label
    )
  const nav = async (path) => {
    await until(() => document.querySelector(`a[href='${path}']`))
    const router =
      document.querySelector("#app").__vue_app__.config.globalProperties.$router
    await router.push(path)
    await until(() => location.pathname === path)
  }
  const collectionName = (label) =>
    [...document.querySelectorAll(".collection-tree span.truncate")].find(
      (node) =>
        node.textContent.trim() === label && node.getClientRects().length > 0
    )
  const menuFor = async (kind) => {
    const more = await until(() =>
      document.querySelector(`[data-testid="${kind}-more"]`)
    )
    more.click()
  }
  const named = (root, labels) =>
    Array.from(root.querySelectorAll("button, [role='menuitem']")).find(
      (node) =>
        [
          node.getAttribute("aria-label"),
          node.title,
          node.textContent.trim(),
          ...[...node.querySelectorAll("span")].map((part) =>
            part.textContent.trim()
          ),
        ].some((label) => labels.includes(label))
    )
  const pause = () => new Promise((resolve) => setTimeout(resolve, 150))
  async function until(callback) {
    const end = Date.now() + 25000
    while (Date.now() < end) {
      const result = await callback()
      if (result) return result
      await pause()
    }
    throw new Error("Timed out waiting for the workbench")
  }
  let stage = "initial request view"
  let replayView
  const runtimeErrors = []
  const originalConsoleError = console.error
  console.error = (...values) => {
    runtimeErrors.push(values.map(String).join(" "))
    originalConsoleError(...values)
  }
  try {
    await until(() => document.querySelector(".collection-tree"))
    if (localStorage.getItem("collections") !== "[]")
      throw new Error("Native boot imported old WebView storage")
    stage = "capture settings removed"
    await nav("/settings")
    await until(() =>
      /General|通用/.test(document.querySelector("main")?.innerText ?? "")
    )
    if (
      document.querySelector("#capture-limits") ||
      Object.hasOwn((await store("settings")) ?? {}, "CAPTURE_LIMITS")
    )
      throw new Error("Removed capture settings remain")

    stage = "packaged traffic capture"
    await nav("/capture")
    const capture = (action, body) =>
      invoke("workbench_capture", {
        action: ["certificate", "archive_export", "archive_download"].includes(
          action
        )
          ? action
          : "capture_api",
        body: ["certificate", "archive_export", "archive_download"].includes(
          action
        )
          ? body
          : { action: action || "status", input: body || {} },
      })
    if ((await capture("")).state !== "stopped")
      throw new Error("Capture engine started without user action")
    let capturedArchive, capturedID
    try {
      await pause()
      // 系统接管行为由设置替身和网页请求验收覆盖，原生冒烟不修改真实系统代理。
      const initial = await capture("")
      await capture("capture_settings", {
        revision: initial.revision,
        mode: "system",
        systemProxy: false,
        service: "",
      })
      await capture("record", { recording: true })
      await until(async () => (await capture("")).state === "running")
      const state = await capture("")
      const relay = window.__KERNEL__.relay.execute({
        id: Date.now(),
        url: target,
        method: "GET",
        version: "HTTP/1.1",
        proxy: { url: state.proxy },
      })
      const response = await relay.response
      if (response._tag !== "Right" || response.right.status !== 422)
        throw new Error("Packaged capture changed the response")
      await until(async () => {
        const state = await capture("")
        const page = await capture("archive_page", { session: state.archiveID })
        const id = page.entries.find((entry) => entry.url === target)?.id
        if (
          id &&
          (await capture("archive_entry", { session: state.archiveID, id }))
            .responseBody?.text === expected
        ) {
          capturedArchive = state.archiveID
          capturedID = id
          return true
        }
        return false
      })
      await until(() =>
        document.querySelector("main")?.innerText.includes(target)
      )
      if (!(await capture("certificate")).pem.includes("BEGIN CERTIFICATE"))
        throw new Error("Packaged capture CA is missing")
    } finally {
      await invoke("workbench_capture", { action: "stop", body: {} })
      await until(
        async () =>
          (await invoke("workbench_capture", { action: "" })).state ===
          "stopped"
      )
    }
    stage = "disk replay after engine restart"
    try {
      await capture("record", { recording: true })
      await until(async () => (await capture("")).state === "running")
      await capture("replay", { session: capturedArchive, ids: [capturedID] })
      await until(async () => {
        const state = await capture("")
        // 重放失败应立即报告具体错误，避免等待正文超时掩盖引擎失败。
        const status = await capture("session_status", {})
        if (status.replayError)
          throw new Error(`Disk replay failed: ${status.replayError}`)
        const page = await capture("archive_page", { session: state.archiveID })
        const entry = page.entries[0]
        const detail = entry
          ? await capture("archive_entry", { session: state.archiveID, id: entry.id })
          : null
        replayView = {
          session: state.archiveID,
          total: page.total,
          response: detail?.responseBody,
          status: detail?.status,
          contentType: detail?.contentType,
        }
        return detail?.responseBody?.text === expected
      })
      if ((await capture("session_status", {})).replayError)
        throw new Error("Disk replay failed")
    } finally {
      await invoke("workbench_capture", { action: "stop", body: {} })
      await until(
        async () =>
          (await invoke("workbench_capture", { action: "" })).state ===
          "stopped"
      )
    }
    if (document.querySelector("main input[type=file]"))
      throw new Error("Removed HAR import input remains")
    if (window.__workbenchSmoke.captureOnly) {
      await invoke("workbench_smoke_finish", { passed: true })
      return
    }
    await nav("/")
    await until(() => document.querySelector(".collection-tree"))
    if (window.__workbenchSmoke.restart) {
      const merged = await store("restTabs")
      const restored = merged?.orderedDocs.filter(
        ({ tabID }) => tabID === "standalone-gql:smoke"
      )
      const collections = await store("restCollections")
      const roots = collections.filter(
        ({ _ref_id }) => _ref_id === "coll-standalone-smoke"
      )
      if (
        roots.length !== 1 ||
        restored?.length !== 1 ||
        restored[0].doc.type !== "gql-request" ||
        restored[0].doc.saveContext?.folderPath !==
          String(collections.indexOf(roots[0])) ||
        (await store("gqlTabs")) ||
        (await store("gqlCollections"))
      )
        throw new Error(
          "Standalone GraphQL data was not merged into the native workspace"
        )
    }
    if (!window.__workbenchSmoke.restart) {
      const send = await until(() => document.querySelector("#send"))
      if (!(await history({ type: "policy" })).enabled)
        throw new Error("New workspace must archive responses by default")
      const toolbar = await until(() =>
        document.querySelector(".collection-tree")
      )
      const add = await until(() => named(toolbar, ["New", "新增"]))
      add.click()
      const newCollection = await until(() =>
        named(document, ["New Collection", "新建集合"])
      )
      newCollection.click()
      const dialog = await until(() =>
        document.querySelector("[role='dialog']")
      )
      const name = await until(() => dialog.querySelector("input"))
      name.value = collection
      name.dispatchEvent(new Event("input", { bubbles: true }))
      const save = await until(() => named(dialog, ["Save", "保存"]))
      save.click()
      await until(async () => {
        const action = {
          type: "get",
          scope: "localhost.apirequest.store",
          key: "data",
        }
        const saved = await invoke("workbench_store", { action })
        return saved?.["persistence.v1"]?.restCollections?.data?.some(
          (item) => item.name === collection
        )
      })
      await invoke("workbench_store", {
        action: { type: "put", scope: "smoke", key: "marker", value: "SQLite" },
      })
      send.click()
    }
    stage = "restored collection"
    await until(() =>
      document
        .querySelector(".collection-tree")
        ?.textContent.includes(collection)
    )
    const marker = await invoke("workbench_store", {
      action: { type: "get", scope: "smoke", key: "marker" },
    })
    if (marker !== "SQLite") throw new Error("Expected persisted SQLite value")
    stage = "archived response"
    const id = await until(async () => {
      const rows = await history({ type: "list", protocol: "rest", take: 20 })
      for (const row of rows) {
        if (
          row.entry.request.endpoint === target &&
          (await history({ type: "detail", id: row.id }))
        )
          return row.id
      }
    })
    const { result, paths } = await until(() => history({ type: "detail", id }))
    if (result.metadata.statusCode !== 422)
      throw new Error("Unexpected native relay status")
    const file = result.files.find((file) => file.isBody)
    const url = window.__TAURI_INTERNALS__.convertFileSrc(paths[file.id])
    const response = await fetch(url)
    if (!response.ok || (await response.text()) !== expected)
      throw new Error("Response archive mismatch")
    stage = "collection restore and cases"
    if (!window.__workbenchSmoke.restart) {
      stage = "collection documentation menu"
      await menuFor("collection")
      const documentation = await until(() =>
        document.querySelector('[data-testid="collection-open-documentation"]')
      )
      documentation.click()
      const docsDialog = await until(() =>
        document.querySelector("[role='dialog']")
      )
      if (!docsDialog.textContent.includes(collection))
        throw new Error("Collection documentation opened the wrong dialog")
      const closeDocs = await until(() => named(docsDialog, ["Close", "关闭"]))
      closeDocs.click()
      await until(() => !document.querySelector("[role='dialog']"))

      stage = "settings backup"
      await nav("/settings")
      await until(
        () =>
          exactText(document, "h2", "工作区备份") ||
          exactText(document, "h2", "Workspace backup")
      )

      stage = "database history pagination"
      const fixture = (
        await history({ type: "list", protocol: "rest", take: 20 })
      ).find((row) => row.id === id)
      for (let i = 0; i < 52; i++) {
        const entry = JSON.parse(JSON.stringify(fixture))
        entry.id = crypto.randomUUID()
        entry.executedAt = fixture.executedAt - 1000 - i
        entry.entry.request.endpoint =
          i === 51 ? "https://history.example/old-page" : target
        await history({ type: "add", entry })
      }
      const page = await history({
        type: "query",
        query: { search: "", starred: false },
      })
      if (page.entries.length !== 50 || !page.next)
        throw new Error("SQL history did not return a cursor")
      stage = "database history navigation"
      await nav("/history")
      stage = "database history next page button"
      const next = await until(() =>
        document.querySelector('[data-testid="history-next-page"]:enabled')
      )
      next.click()
      stage = "reading old history page"
      await until(() =>
        document.body.textContent.includes("history.example/old-page")
      )
      stage = "searching old history"
      const search = document.querySelector("input[type=search]")
      search.value = "old-page"
      search.dispatchEvent(new Event("input", { bubbles: true }))
      await until(
        () =>
          !named(document, ["Next page", "下一页"]) &&
          document.body.textContent.includes("old-page")
      )

      stage = "external MCP proposals"
      const access = await invoke("workbench_mcp_access", { enabled: true })
      await invoke("append_log", {
        filename: "mcp-test.log",
        content: JSON.stringify(access.mcpServers.apirequest),
      })
      await nav("/ai-access")
      const approve = await until(() =>
        named(document, ["Approve all (3)", "一键批准（3）"])
      )
      const before = (await store("restCollections")).find(
        (item) => item.name === collection
      )
      if (before.requests.length)
        throw new Error("An unapproved request was written")
      approve.click()
      const savedCollection = await until(async () => {
        const item = (await store("restCollections")).find(
          (item) => item.name === collection
        )
        return item?.requests.some((request) => request.name === savedRequest)
          ? item
          : undefined
      })
      await until(async () => {
        const entries = await store("workbench-native-proposals")
        return (
          entries?.filter((entry) => entry.status === "applied").length >= 3
        )
      })
      stage = "approving saved plans and configuration update"
      const approvePlans = await until(() =>
        named(document, ["Approve all (6)", "一键批准（6）"])
      )
      approvePlans.click()
      await until(
        async () =>
          (await store("workbench-native-proposals"))?.filter(
            (entry) => entry.status === "applied"
          ).length === 9
      )
      // 已保存配置改为按类型切换，分别验收后返回待审批处理删除。
      const savedPlans = await until(() =>
        named(document, ["Saved configurations", "已保存配置"])
      )
      savedPlans.click()
      await until(() => document.body.textContent.includes("MCP automation"))
      const planKind = await until(() =>
        document.querySelector(
          "main select[aria-label='已保存配置'], main select[aria-label='Saved configurations']"
        )
      )
      planKind.value = "load_test"
      planKind.dispatchEvent(new Event("change", { bubbles: true }))
      await until(() => document.body.textContent.includes("MCP load"))
      document.querySelector("main nav button").click()
      stage = "approving deletion"
      const approveDelete = await until(() =>
        named(document, ["Approve all (1)", "一键批准（1）"])
      )
      approveDelete.click()
      await until(
        async () =>
          (await store("workbench-native-proposals"))?.filter(
            (entry) => entry.status === "applied"
          ).length === 10
      )
      await until(() =>
        Array.from(document.querySelectorAll("[role=status]")).some(
          (status) =>
            status.textContent.includes("已执行 1 条") ||
            status.textContent.includes("Applied 1.")
        )
      )
      const savedEnvs = await store("environments")
      const env = savedEnvs.find(
        (environment) => environment.name === "MCP environment updated"
      )
      const secrets = await store("secretEnvironments")
      if (
        env.variables[0].initialValue ||
        secrets?.[env.id]?.[0]?.initialValue !== "environment-test-secret"
      ) {
        throw new Error(
          "Secret variable was not persisted in the private store"
        )
      }
      const refId = savedCollection.requests[0]._ref_id

      stage = "returning to request workspace"
      await nav("/")
      stage = "opening approved request and saving a case"
      async function toggleFolder() {
        const folder = await until(() => collectionName(collection))
        folder.parentElement.parentElement.click()
      }
      await until(() => collectionName(savedRequest))
      await toggleFolder()
      await until(() => !collectionName(savedRequest))
      await toggleFolder()
      const row = await until(() => collectionName(savedRequest))
      stage = "persisting folder expansion after navigation"
      const collectionID = savedCollection.id ?? savedCollection._ref_id
      await until(
        async () =>
          (await store("collection-expansion"))?.[collectionID] === true
      )
      const requestLink = row.closest(".pointer-events-auto")
      requestLink.click()
      await until(() => requestLink.querySelector(".animate-ping"))
      const casesTab = await until(
        () =>
          exactText(document, "[role=tab]", "接口用例") ||
          exactText(document, "[role=tab]", "API test cases")
      )
      casesTab.click()
      await until(() => casesTab.getAttribute("aria-selected") === "true")
      const addCase = await until(() =>
        named(document, ["New test case", "新建用例"])
      )
      addCase.click()
      const caseForm = await until(() =>
        document.querySelector("form:has(input[type=number])")
      )
      const [caseName, status] = caseForm.querySelectorAll("input")
      caseName.value = savedCase
      status.value = "422"
      caseName.dispatchEvent(new Event("input", { bubbles: true }))
      status.dispatchEvent(new Event("input", { bubbles: true }))
      ;(await until(() => named(caseForm, ["Save", "保存"]))).click()
      const caseRow = await until(() =>
        exactText(document, "strong", savedCase)?.closest("article")
      )
      await until(async () =>
        (await store("workbench.request-cases.v1"))?.[refId]?.some(
          (entry) => entry.name === savedCase
        )
      )
      stage = "running saved case"
      const run = await until(() => named(caseRow, ["Run", "运行", "执行"]))
      run.click()
      await until(() =>
        caseRow.querySelector("[role=status]")?.textContent.includes("422")
      )

      stage = "copy cURL directly"
      await menuFor("request")
      const copy = await until(() =>
        document.querySelector('[data-testid="request-copy-curl"]')
      )
      copy.click()
      await until(async () => {
        const copied = await invoke("workbench_store", {
          action: { type: "get", scope: "smoke", key: "copiedCurl" },
        })
        return copied?.startsWith("curl ") && copied.includes(target)
      })
      if (document.querySelector("[role='dialog']"))
        throw new Error("Copy cURL opened a legacy dialog")
    } else {
      stage = "restored folder expansion"
      await until(() => collectionName(savedRequest))
      const saved = (await store("restCollections"))?.find(
        (item) => item.name === collection
      )
      const refId = saved?.requests[0]?._ref_id
      const persisted = await store("workbench.request-cases.v1")
      if (
        !refId ||
        !persisted?.[refId]?.some((entry) => entry.name === savedCase)
      )
        throw new Error(
          "The approved request or saved case is missing after restart"
        )
    }

    if (!window.__workbenchSmoke.restart) {
      stage = "protocol menu WebSocket"
      await nav("/")
      const selectProtocol = async (name) => {
        const trigger = await until(() =>
          named(document, ["切换协议", "Switch protocol"])
        )
        trigger.click()
        const option = await until(() =>
          [
            ...document.querySelectorAll(
              ".tippy-box[data-state='visible'] button,[data-state='visible'] [role='menuitem']"
            ),
          ].find((button) => button.textContent.trim() === name)
        )
        option.click()
      }
      await selectProtocol("WebSocket")
      const connect = await until(() =>
        document.querySelector("[data-websocket-connect]")
      )
      const endpoint = await until(() =>
        connect.closest(".sticky")?.querySelector("input[type='url']")
      )
      const websocket = new URL("/native-websocket", target)
      websocket.protocol = "ws:"
      endpoint.value = websocket.href
      endpoint.dispatchEvent(new Event("input", { bubbles: true }))
      await until(() => !connect.disabled)
      connect.click()
      await until(() =>
        document.body.textContent.includes("native-workbench-websocket")
      )

      stage = "protocol menu GraphQL"
      await selectProtocol("GraphQL")
      const gqlEndpoint = await until(
        () =>
          document
            .querySelector("#connect")
            ?.parentElement.querySelector(".cm-content")?.cmView?.rootView?.view
      )
      gqlEndpoint.dispatch({
        changes: {
          from: 0,
          to: gqlEndpoint.state.doc.length,
          insert: new URL("/native-graphql", target).href,
        },
      })
      if (location.pathname !== "/")
        throw new Error("GraphQL opened a separate page")
      const runGraphql = await until(() => named(document, ["Request"]))
      runGraphql.click()
      await until(() =>
        document.body.textContent.includes("native-workbench-graphql")
      )
    }
    stage = "rule Mock dashboard"
    await nav("/mock")
    const mockAPI = (path = "", data) =>
      invoke("workbench_mock_rules", {
        path,
        data: data ?? null,
        write: data !== undefined,
      })
    if (named(document, ["基于接口示例", "Response examples"]))
      throw new Error("Removed example Mock mode is still visible")
    if (!window.__workbenchSmoke.restart)
      await mockAPI("", { name: "原生 Mock 验收", kind: "single" })
    const server = await until(async () =>
      (await mockAPI()).find((v) => v.name === "原生 Mock 验收")
    )
    const preview = await mockAPI(server.id + "/inspect", {
      request: { method: "GET", path: "/hello" },
    })
    if (preview.selection?.step.statusCode !== 200)
      throw new Error("Rule Mock preview failed")
    const mockResponse = await mockAPI(server.id + "/test", {
      request: { method: "GET", path: "/hello" },
    })
    if (mockResponse.status !== 200) throw new Error("Rule Mock response failed")
    await until(async () => (await mockAPI(server.id + "/logs")).length > 0)
    if (window.__workbenchSmoke.restart)
      await mockAPI(server.id + "/delete", {})
    await invoke("workbench_smoke_finish", { passed: true })
  } catch (error) {
    const state = await invoke("workbench_store", {
      action: {
        type: "get",
        scope: "localhost.apirequest.store",
        key: "data",
      },
    })
    const saved = state?.["persistence.v1"]?.restCollections?.data
    const tree = document.querySelector(".collection-tree")
    await invoke("workbench_smoke_finish", {
      passed: false,
      message:
        stage +
        ": " +
        String(error) +
        ", collection state " +
        JSON.stringify(saved?.map((item) => item.name)) +
        ", tree " +
        (tree?.textContent.trim() || "missing") +
        ", route " +
        location.pathname +
        ", view root " +
        document.querySelector("main")?.firstElementChild?.className +
        ", replay " + JSON.stringify(replayView) +
        ", runtime errors " +
        JSON.stringify(runtimeErrors.slice(-5)) +
        ", view " +
        document.body.innerText.trim().slice(-800),
    })
  }
})()
