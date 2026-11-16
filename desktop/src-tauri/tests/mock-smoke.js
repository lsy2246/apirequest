;(async () => {
  const style = document.createElement("style")
  style.textContent =
    "*,*::before,*::after{animation:none!important;transition:none!important}"
  document.head.append(style)
  window.requestAnimationFrame = (callback) =>
    setTimeout(() => callback(performance.now()), 16)
  window.cancelAnimationFrame = clearTimeout
  const invoke = (command, args) =>
    window.__TAURI_INTERNALS__.invoke(command, args)
  const api = (path = "", data) =>
    invoke("workbench_mock_rules", {
      path,
      data: data ?? null,
      write: data !== undefined,
    })
  const wait = async (check) => {
    const end = Date.now() + 20000
    while (Date.now() < end) {
      const value = await check()
      if (value) return value
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error("Mock window check timed out")
  }
  const named = (root, labels) =>
    [...root.querySelectorAll("button,[role=menuitem]")].find((node) =>
      [
        node.getAttribute("aria-label"),
        node.title,
        node.textContent.trim(),
        ...[...node.querySelectorAll("span")].map((v) => v.textContent.trim()),
      ].some((v) => labels.includes(v))
    )
  const nav = async (path) => {
    const router =
      document.querySelector("#app").__vue_app__.config.globalProperties.$router
    await router.push(path)
    await wait(() => location.pathname === path)
  }
  const set = (input, value) => {
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const checkFormSizes = (root) => {
    const controls = [
      ...root.querySelectorAll(
        "input.mock-field, select.mock-field, button.select-trigger"
      ),
    ].filter((node) => node.getBoundingClientRect().width > 0)
    if (!controls.length) throw new Error("No visible Mock controls to measure")
    for (const node of controls) {
      const height = node.getBoundingClientRect().height
      if (Math.abs(height - 36) > 0.5)
        throw new Error(
          `Mock control height is ${height}px: ${node.outerHTML.slice(0, 200)}`
        )
    }
    for (const node of root.querySelectorAll("textarea.mock-field")) {
      if (
        node.getBoundingClientRect().width > 0 &&
        (node.getBoundingClientRect().height < 72 ||
          getComputedStyle(node).whiteSpace !== "pre-wrap")
      )
        throw new Error(
          "Mock textarea must retain multiline content and a usable height"
        )
    }
  }
  const dialog = () => document.querySelector("[role=dialog]")
  const target = window.__workbenchSmoke.target
  const restart = window.__workbenchSmoke.restart
  const name = "Mock window verification"
  const viewErrors = []
  window.addEventListener("error", (event) =>
    viewErrors.push(String(event.error?.stack ?? event.message))
  )
  let stage = "native HTTP request"
  let socketServer
  try {
    const old = new Set(
      (
        await invoke("workbench_history", {
          action: { type: "list", protocol: "rest", take: 20 },
        })
      ).map((v) => v.id)
    )
    ;(
      await wait(() => {
        const v = document.querySelector("#send")
        return v && !v.disabled && v
      })
    ).click()
    await wait(async () => {
      const rows = await invoke("workbench_history", {
        action: { type: "list", protocol: "rest", take: 20 },
      })
      for (const row of rows)
        if (!old.has(row.id) && row.entry.request.endpoint === target) {
          const detail = await invoke("workbench_history", {
            action: { type: "detail", id: row.id },
          })
          if (detail?.result?.metadata.statusCode === 422) return true
        }
    })
    const vue = document.querySelector("#app").__vue_app__
    const oldError = vue.config.errorHandler
    vue.config.errorHandler = (error, ...args) => {
      viewErrors.push(String(error?.stack ?? error))
      oldError?.(error, ...args)
    }
    stage = "unified data management settings"
    await nav("/settings")
    const dataManagement = await wait(() =>
      document.querySelector('[data-testid="data-sync"]')
    )
    if (dataManagement.querySelector("h3")?.textContent.trim() !== "数据管理")
      throw new Error("Unified data management heading is missing")
    const dataTabs = [...dataManagement.querySelectorAll('[role="tab"]')]
    if (
      dataTabs.length !== 3 ||
      document.querySelector('[data-testid="workspace-backup"]')
    )
      throw new Error(
        "Data management should have three tabs and no separate backup section"
      )
    dataManagement
      .querySelector('input[name="data-transfer-kind"][value="workspace"]')
      .click()
    const workspaceExport = await wait(() =>
      dataManagement.querySelector('[data-testid="workspace-backup"]')
    )
    if (
      !named(workspaceExport, ["导出工作区备份", "Export workspace backup"]) ||
      named(workspaceExport, ["导入备份并恢复", "Import and restore backup"])
    )
      throw new Error(
        "Export should only expose the workspace backup export action"
      )
    dataTabs.find((node) => node.textContent.trim() === "导入").click()
    const workspaceImport = await wait(() => {
      const panel = dataManagement.querySelector(
        '[data-testid="workspace-backup"]'
      )
      return (
        panel &&
        named(panel, ["导入备份并恢复", "Import and restore backup"]) &&
        panel
      )
    })
    if (named(workspaceImport, ["导出工作区备份", "Export workspace backup"]))
      throw new Error("Import should only expose the workspace restore action")
    dataManagement
      .querySelector('input[name="data-transfer-kind"][value="types"]')
      .click()
    await wait(
      () => !dataManagement.querySelector('[data-testid="workspace-backup"]')
    )
    await wait(() => dataManagement.querySelector('input[type="file"]'))
    dataTabs.find((node) => node.textContent.trim() === "导出").click()
    stage = "Mock page and editor"
    await nav("/mock")
    await wait(() => document.querySelector(".mock-row.list-heading"))
    if (named(document, ["基于接口示例", "Response examples"]))
      throw new Error("Removed example mode is visible")
    if (
      !["Mock 服务", "Mock Servers"].includes(
        document.querySelector(".workbench-page h1").textContent.trim()
      )
    )
      throw new Error("Mock page and navigation names differ")
    if (!restart) {
      const openDraft = async (label) => {
        ;(
          await wait(() => {
            const button = named(document.querySelector(".workbench-page"), [
              "新增",
              "New",
            ])
            return button && !button.disabled && button
          })
        ).click()
        const form = await wait(() => document.querySelector("#mock-create"))
        set(form.querySelector("input"), label)
        ;(await wait(() => named(dialog(), ["继续", "Proceed"]))).click()
        await wait(() => document.querySelector("#mock-rule-editor"))
      }
      stage = "discard unsaved Mock without creating an empty service"
      await openDraft("Discarded draft")
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
      ;(
        await wait(() =>
          named([...document.querySelectorAll('[role="dialog"]')].at(-1), [
            "是",
            "Yes",
          ])
        )
      ).click()
      await wait(() => !dialog())
      if ((await api()).some((v) => v.name === "Discarded draft"))
        throw new Error("Discard left an empty Mock")
      stage = "save unchanged first draft"
      await openDraft("Default draft")
      const defaultSave = await wait(() => named(dialog(), ["保存", "Save"]))
      if (defaultSave.disabled)
        throw new Error("Default draft Save is disabled")
      defaultSave.click()
      await wait(() => !dialog())
      const defaultServer = await wait(async () =>
        (await api()).find((v) => v.name === "Default draft")
      )
      if ((await api(defaultServer.id)).rules[0].path !== "/hello")
        throw new Error("Default draft did not save")
      await api(defaultServer.id + "/delete", {})
      stage = "open Mock creation form"
      ;(
        await wait(() => {
          const button = named(document.querySelector(".workbench-page"), [
            "新增",
            "New",
          ])
          return button && !button.disabled && button
        })
      ).click()
      const create = await wait(() => document.querySelector("#mock-create"))
      set(create.querySelector("input"), name)
      ;(
        await wait(() =>
          named(dialog(), ["继续", "Proceed", "创建", "新增", "Create"])
        )
      ).click()
      stage = "edit Mock response"
      const editor = await wait(() =>
        document.querySelector("#mock-rule-editor")
      )
      checkFormSizes(editor)
      const firstSave = named(dialog(), ["保存", "Save"])
      if (!firstSave || firstSave.disabled)
        throw new Error("First draft cannot be saved")
      if (named(dialog(), ["取消", "Cancel"]))
        throw new Error("Editor still has a cancel button")
      if ((await api()).some((v) => v.name === name))
        throw new Error("New draft persisted before Save")
      const draftPreview = await api("inspect", {
        rules: [
          {
            id: crypto.randomUUID(),
            name: "draft",
            enabled: true,
            method: "GET",
            path: "/draft",
            conditions: [],
            exhausted: "repeat_last",
            steps: [
              {
                action: "http",
                statusCode: 200,
                body: "draft",
                headers: {},
                times: 1,
                delayMs: 0,
                intervalMs: 0,
                disconnectAfter: false,
              },
            ],
          },
        ],
        request: { path: "/draft" },
      })
      if (draftPreview.selection?.step.body !== "draft")
        throw new Error("Unsaved preview failed")
      set(editor.querySelector('input[maxlength="1000"]'), "/users/:id")
      set(
        editor.querySelector('textarea[rows="4"]'),
        '{"id":"{{path.id}}","name":"{{query.name}}"}'
      )
      const summary = [...editor.querySelectorAll("summary")].find((v) =>
        /动态响应|Dynamic response/.test(v.textContent)
      )
      summary.click()
      const template = summary.parentElement.querySelector('[role="switch"]')
      if (template.getAttribute("aria-checked") !== "true") template.click()
      ;(
        await wait(() => {
          const button = named(dialog(), ["保存", "Save"])
          return button && !button.disabled && button
        })
      ).click()
      await wait(() => !dialog())
    }
    const server = await wait(async () =>
      (await api()).find((v) => v.name === name)
    )
    if (!restart) {
      stage = "save changes to an existing Mock"
      const editRow = await wait(() =>
        document.querySelector(`[data-mock-id="${server.id}"] .row-name`)
      )
      editRow.click()
      const editForm = await wait(() =>
        document.querySelector("#mock-rule-editor")
      )
      const body = editForm.querySelector('textarea[rows="4"]')
      set(body, body.value + "\n")
      const saveEdit = named(dialog(), ["保存", "Save"])
      if (saveEdit.disabled) throw new Error("Edited Mock Save is disabled")
      saveEdit.click()
      await wait(() => !dialog())
      if (!(await api(server.id)).rules[0].steps[0].body.endsWith("\n"))
        throw new Error("Mock edit did not persist")
    }
    const state = await api(server.id),
      rule = state.rules[0]
    if (rule.path !== "/users/:id" || !rule.steps[0].template)
      throw new Error("Rule editor did not save the dynamic response")
    stage = "non-consuming preview"
    const preview = await api(server.id + "/inspect", {
      request: { method: "GET", path: "/users/7?name=Alice", headers: {} },
    })
    if (
      JSON.stringify(JSON.parse(preview.selection.step.body)) !==
      JSON.stringify({ id: "7", name: "Alice" })
    )
      throw new Error("Dynamic preview differs")
    if ((await api(server.id)).hits[rule.id] !== state.hits[rule.id])
      throw new Error("Preview consumed a hit")
    if (restart && !(state.hits[rule.id] >= 3))
      throw new Error("Mock progress was not restored")
    stage = "HTTP, recording and replay"
    const response = await window.__KERNEL__.relay.execute({
      id: Date.now(),
      url: server.url + "/users/7?name=Alice",
      method: "GET",
      version: "HTTP/1.1",
    }).response
    if (
      response._tag !== "Right" ||
      response.right.status !== 200 ||
      JSON.parse(new TextDecoder().decode(response.right.body.body)).id !== "7"
    )
      throw new Error("Native HTTP Mock response differs")
    const log = await wait(async () =>
      (await api(server.id + "/logs")).find((v) => v.requestPath === "/users/7")
    )
    const replay = await api(server.id + "/logs/" + log.id + "/replay", {})
    if (replay.status !== 200 || JSON.parse(replay.body).name !== "Alice")
      throw new Error("Native replay failed")
    const captured = await api(server.id + "/logs/" + log.id + "/capture", {})
    if (captured.steps[0].statusCode !== 200)
      throw new Error("Capture did not produce a rule")
    stage = "request log panel"
    stage = "open Mock settings"
    ;(
      await wait(() => {
        const row = document.querySelector(`[data-mock-id="${server.id}"]`)
        const button = row && named(row, ["设置 Mock", "Mock settings"])
        return button && !button.disabled && button
      })
    ).click()
    await wait(() => dialog()?.querySelector("form"))
    if (
      dialog().querySelector("nav, article") ||
      !/匹配预览|Match preview/.test(dialog().textContent) ||
      !/未匹配时转发|Forward unmatched/.test(dialog().textContent)
    )
      throw new Error(
        "Mock settings should contain preview and service options"
      )
    stage = "Mock settings control sizes"
    dialog().querySelector('form [role="switch"]').click()
    await wait(() => dialog()?.querySelector('input[type="url"]'))
    for (const details of dialog().querySelectorAll("details"))
      details.open = true
    await new Promise((resolve) => requestAnimationFrame(resolve))
    checkFormSizes(dialog())
    const previewControls = [
      ...dialog().querySelectorAll(
        "section input.mock-field, section select.mock-field"
      ),
    ]
    if (
      previewControls.length !== 3 ||
      previewControls.some((node) => node.getBoundingClientRect().width === 0)
    )
      throw new Error("Preview method, path and protocol must remain visible")
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
    await wait(() => !dialog())
    stage = "open request logs"
    ;(
      await wait(() => {
        const row = document.querySelector(`[data-mock-id="${server.id}"]`)
        const button =
          row &&
          [...row.querySelectorAll("button")].find((v) =>
            /日志|记录|logs|log/i.test(v.title)
          )
        return button && !button.disabled && button
      })
    ).click()
    const records = await wait(() => dialog()?.querySelector("article button"))
    if (
      dialog().querySelector("nav, form") ||
      /匹配预览|Match preview|未匹配时转发|Forward unmatched/.test(
        dialog().textContent
      )
    )
      throw new Error("Logs should directly show request records only")
    records.click()
    const logDetail = await wait(() =>
      dialog()?.querySelector(".mock-log-detail")
    )
    if (new URL(target).searchParams.has("layout-preview")) {
      await invoke("append_log", {
        filename: "mock-layout-ready.log",
        content: "ready\n",
      })
      await new Promise((resolve) => setTimeout(resolve, 10000))
    }
    stage = "request detail layout"
    await document.fonts.ready
    const payload = logDetail.querySelector(".log-payload")
    const previousPayload = payload.textContent
    payload.textContent = JSON.stringify(
      { "x-long-demo-header": "a".repeat(1600), multiline: "first\nsecond" },
      null,
      2
    )
    const pathLabel = logDetail.querySelector(".log-request-line code")
    const previousPath = pathLabel.textContent
    pathLabel.textContent = "/long-request/" + "segment".repeat(120)
    for (const width of ["", "300px"]) {
      logDetail.style.width = width
      logDetail.style.maxWidth = "100%"
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
      if (logDetail.scrollWidth > logDetail.clientWidth + 1)
        throw new Error(
          `Request details overflow at width ${width || "desktop"}`
        )
      for (const block of logDetail.querySelectorAll(".log-payload")) {
        const style = getComputedStyle(block)
        if (
          block.getBoundingClientRect().width >
            logDetail.getBoundingClientRect().width ||
          style.overflowX !== "auto" ||
          !["pre-wrap", "break-spaces"].includes(style.whiteSpace) ||
          (style.userSelect || style.webkitUserSelect) !== "text"
        )
          throw new Error(
            "Request detail payload layout: " +
              JSON.stringify({
                clientWidth: block.clientWidth,
                scrollWidth: block.scrollWidth,
                whiteSpace: style.whiteSpace,
                userSelect: style.userSelect,
                webkitUserSelect: style.webkitUserSelect,
              })
          )
      }
    }
    logDetail.style.width = ""
    payload.textContent = previousPayload
    pathLabel.textContent = previousPath
    ;(await wait(() => named(dialog(), ["再次发送", "Send again"]))).click()
    await wait(
      async () =>
        ((await api(server.id)).hits[rule.id] ?? 0) >=
        (state.hits[rule.id] ?? 0) + 3
    )
    await nav("/")
    stage = "upstream forwarding and recording"
    const latest = await api(server.id)
    await api(server.id, {
      revision: latest.revision,
      rules: latest.rules,
      options: {
        recording: true,
        fallback: {
          url: new URL(target).origin,
          headers: {},
          removeHeaders: [],
          timeoutMs: 10000,
          preserveQuery: true,
        },
      },
    })
    const forwarded = await window.__KERNEL__.relay.execute({
      id: Date.now(),
      url: server.url + "/native-smoke",
      method: "GET",
      version: "HTTP/1.1",
    }).response
    if (forwarded._tag !== "Right" || forwarded.right.status !== 422)
      throw new Error("Fallback proxy did not preserve the upstream status")
    await wait(async () =>
      (await api(server.id + "/logs")).some(
        (v) => v.requestPath === "/native-smoke" && v.mockMatch?.recorded
      )
    )
    stage = "advanced response editor and execution"
    const codeRule = {
      id: crypto.randomUUID(),
      name: "Script response",
      enabled: true,
      method: "GET",
      path: "/code/:id",
      secure: false,
      conditions: [],
      exhausted: "repeat_last",
      steps: [
        {
          action: "script",
          script: {
            code: 'let total=0;for(const value of [5,10])total+=value;return {statusCode:201,body:{id:request.params.id,total},cookies:["session=demo; HttpOnly","old=; Max-Age=0"]};',
            timeoutMs: 1000,
          },
          headers: {},
          times: 1,
          delayMs: 0,
        },
      ],
    }
    const callbackRule = {
      ...codeRule,
      id: crypto.randomUUID(),
      name: "Callback response",
      path: "/callback/:id",
      steps: [
        {
          action: "callback",
          callback: {
            url: new URL(target).origin + "/native-mock-callback",
            headers: {},
            timeoutMs: 5000,
          },
          headers: {},
          times: 1,
          delayMs: 0,
        },
      ],
    }
    const advanced = await api("", {
      name: "Advanced window verification",
      kind: "collection",
      rules: [codeRule, callbackRule],
    })
    await nav("/mock")
    ;(
      await wait(() =>
        document.querySelector(`[data-mock-id="${advanced.id}"] .row-name`)
      )
    ).click()
    ;(
      await wait(() =>
        document.querySelector(`[data-mock-id="${codeRule.id}"] .row-name`)
      )
    ).click()
    const storedCode = (await api(advanced.id)).rules.find(
      (rule) => rule.id === codeRule.id
    ).steps[0]
    if (!storedCode.script?.code)
      throw new Error("Stored script missing: " + JSON.stringify(storedCode))
    stage = "script form: " + JSON.stringify(storedCode)
    const scriptEditor = await wait(() =>
      document.querySelector('#mock-rule-editor textarea[rows="12"]')
    )
    if (!scriptEditor.value.includes("request.params"))
      throw new Error("Script editor did not load its code")
    set(scriptEditor, scriptEditor.value + "\n// window verification")
    ;(await wait(() => named(dialog(), ["保存", "Save"]))).click()
    await wait(() => !dialog())
    const scripted = await api(advanced.id + "/test", {
      request: { method: "GET", path: "/code/7" },
    })
    if (
      scripted.status !== 201 ||
      JSON.parse(scripted.body).total !== 15 ||
      JSON.parse(scripted.body).id !== "7"
    )
      throw new Error("Script response differs")
    const called = await api(advanced.id + "/test", {
      request: { method: "GET", path: "/callback/9" },
    })
    if (called.status !== 202 || !JSON.parse(called.body).callback)
      throw new Error("External callback differs")
    const securePreview = await api(advanced.id + "/inspect", {
      request: { method: "GET", path: "/code/7", secure: true },
    })
    if (securePreview.selection)
      throw new Error("HTTP rule matched HTTPS preview")
    await api(advanced.id + "/delete", {})
    await nav("/")
    stage = "WebSocket in native WebView"
    socketServer = await api("", {
      name: "Mock socket window",
      kind: "collection",
    })
    await api(socketServer.id, {
      revision: 0,
      rules: [
        {
          id: crypto.randomUUID(),
          name: "socket",
          method: "GET",
          path: "/chat",
          enabled: true,
          conditions: [],
          exhausted: "repeat_last",
          steps: [
            {
              action: "websocket",
              headers: {},
              times: 1,
              delayMs: 0,
              intervalMs: 0,
              websocket: {
                messages: ["connected"],
                matchers: [
                  {
                    operator: "equals",
                    value: "ping",
                    replies: ["pong"],
                    close: true,
                  },
                ],
                closeCode: 1000,
              },
            },
          ],
        },
      ],
    })
    const socketState = await api(socketServer.id)
    await api(socketServer.id, {
      revision: socketState.revision,
      rules: [
        ...socketState.rules,
        {
          id: crypto.randomUUID(),
          name: "binary socket",
          enabled: true,
          method: "GET",
          path: "/binary",
          conditions: [],
          exhausted: "repeat_last",
          steps: [
            {
              action: "websocket",
              headers: {},
              times: 1,
              delayMs: 0,
              websocket: {
                messages: [{ type: "binary", data: "AP8=" }],
                matchers: [
                  {
                    type: "binary",
                    operator: "equals",
                    value: "AQI=",
                    replies: [{ type: "binary", data: "AwQ=" }],
                    close: true,
                  },
                ],
                closeCode: 1000,
              },
            },
          ],
        },
      ],
    })
    await new Promise((resolve, reject) => {
      const messages = [],
        socket = new WebSocket(
          socketServer.url.replace(/^http/, "ws") + "/chat"
        )
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error("WebSocket timed out"))
      }, 15000)
      socket.onmessage = (event) => {
        messages.push(event.data)
        if (event.data === "connected") socket.send("ping")
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error("WebSocket connection failed"))
      }
      socket.onclose = (event) => {
        clearTimeout(timer)
        if (event.code !== 1000 || messages.join(",") !== "connected,pong")
          reject(new Error("WebSocket messages differ"))
        else resolve()
      }
    })
    await wait(async () =>
      (await api(socketServer.id + "/logs")).some(
        (v) => v.responseStatus === 101
      )
    )
    stage = "binary WebSocket in native WebView"
    await new Promise((resolve, reject) => {
      const frames = [],
        socket = new WebSocket(
          socketServer.url.replace(/^http/, "ws") + "/binary"
        )
      socket.binaryType = "arraybuffer"
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error("Binary WebSocket timed out"))
      }, 15000)
      socket.onmessage = (event) => {
        frames.push([...new Uint8Array(event.data)])
        if (frames.length === 1) socket.send(new Uint8Array([1, 2]))
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error("Binary WebSocket failed"))
      }
      socket.onclose = (event) => {
        clearTimeout(timer)
        if (event.code === 1000 && JSON.stringify(frames) === "[[0,255],[3,4]]")
          resolve()
        else reject(new Error("Binary WebSocket frames differ"))
      }
    })
    await api(socketServer.id + "/delete", {})
    if (restart) await api(server.id + "/delete", {})
    await invoke("workbench_smoke_finish", { passed: true })
  } catch (error) {
    await invoke("workbench_smoke_finish", {
      passed: false,
      message:
        stage +
        ": " +
        String(error) +
        ", render errors " +
        JSON.stringify(viewErrors.slice(-3)) +
        ", route " +
        location.pathname +
        ", view " +
        document.body.innerText.slice(-600),
    })
  }
})()
