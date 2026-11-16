import { describe, expect, it } from "vitest"
import { parseAppActionCommand, splitCommands } from "../app-actions"

describe("removed interceptor selection", () => {
  it.each([
    // Names
    ["use extension", "extension"],
    ["select interceptor extension", "extension"],
    ["set the interceptor to the browser", "browser"],
    ["select the extension interceptor", "extension"],
    ["use a extension", "extension"],
    ["use native", "native"],
    ["use the browser", "browser"],
    ["switch to the extension", "extension"],
    ["use the extension interceptor", "extension"],
    ["use the browser extension interceptor", "browser extension"],
    ["Use Browser Extension Interceptor", "Browser Extension"],
    ["USE THE native!", "native"],
    ["use my native", "native"],
    ["switch to the default extension", "extension"],
    ["switch the interceptor", ""],
    // What the verb acts on
    ["select interceptor browser", "browser"],
    ["switch interceptor native", "native"],
    ["set the interceptor to Native", "Native"],
    ["switch interceptors to extension", "extension"],
    ["switch back to the browser interceptor", "browser"],
    ["switch it over to native", "native"],
    ["change it to extension", "extension"],
    ["change the default interceptor to extension", "extension"],
    ["switch the active interceptor to browser", "browser"],
    ["change the request interceptor to native", "native"],
    ["set this tab’s interceptor to native", "native"],
    ["set this tab‘s interceptor to native", "native"],
    ["set the interceptor for this tab to extension", "extension"],
    [
      "Please switch the interceptor over to the browser extension",
      "browser extension",
    ],
    ["switch this tab to extension", "extension"],
    ["set it to use extension", "extension"],
    ["set it to use the extension", "extension"],
    ["set the request to use the native", "native"],
    ["switch to using the extension", "extension"],
    // From one to another
    ["switch from browser to extension", "extension"],
    ["switch the interceptor from browser to extension", "extension"],
    ["switch from the browser interceptor to the extension", "extension"],
    ["switch from browser to the extension interceptor", "extension"],
    ["switch from the default to native", "native"],
    ["switch back from the extension to browser", "browser"],
    ["switch from extension back to browser", "browser"],
    ["switch from native over to browser", "browser"],
    ["change from the extension one to browser", "browser"],
    ["switch to extension from browser", "extension"],
    // Lead-ins
    ["can you please switch to the extension interceptor?", "extension"],
    ["Could you kindly switch to extension", "extension"],
    ["I'd like to use the extension", "extension"],
    ["I’d like to switch to the native interceptor", "native"],
    ["I'd prefer to use the extension", "extension"],
    ["i think we should use the extension", "extension"],
    ["I think we should use the extension", "extension"],
    ["we should switch to the native", "native"],
    ["We should switch to the native", "native"],
    ["maybe use the extension", "extension"],
    ["maybe use the native", "native"],
    ["kindly switch to the native", "native"],
    ["alright switch to native", "native"],
    ["let me switch to the extension", "extension"],
    ["time to switch to the extension", "extension"],
    ["Hey Claude switch to extension", "extension"],
    ["yeah use the extension", "extension"],
    ["yes switch to the native", "native"],
    ["Actually switch to the native", "native"],
    ["no, use the extension interceptor", "extension"],
    ["go ahead and use extension", "extension"],
    ["Now, please, switch over to the extension interceptor", "extension"],
    ["make it use the native", "native"],
    ["configure it to use the extension", "extension"],
    ["I want requests to use the native", "native"],
    ["for this request use the extension", "extension"],
    ["For the interceptor use native", "native"],
    ["for the interceptor, use native", "native"],
    ["interceptor: select native", "native"],
    // Endings
    ["switch to native,", "native"],
    ["use the extension interceptor;", "extension"],
    ["use the extension  .", "extension"],
    ["switch to the native interceptor, please", "native"],
    ["use the native interceptor instead of the browser", "native"],
    ["use the extension for this request", "extension"],
    ["set the interceptor to extension, not native", "extension"],
  ])("does not switch the fixed sending method for %s", (text) => {
    expect(parseAppActionCommand(text)).toBeNull()
  })

  it.each([
    // 删除的发送端不再生成操作，同名请求头继续按普通字段处理。
    ["switch to the agent interceptor", null],
    ["USE THE AGENT!", null],
    ["use the proxy interceptor", null],
    ["switch to agent", null],
    ["use proxy", null],
    // Request edits naming proxy / agent / interceptor
    ["set header proxy: on", null],
    ["set header agent on", null],
    ["set header User-Agent: foo", null],
    ["set header Proxy-Authorization: Basic abc", null],
    ["set header X-Interceptor: 1", null],
    ["set header interceptor: 1", null],
    ["set x-interceptor to proxy", null],
    ["set the user agent to proxy", null],
    ["set param agent=chrome", null],
    ["set proxy url to http://x", null],
    ["set url to https://proxy.example.com", null],
    ['set body to {"proxy": true}', null],
    ["set variable interceptor to proxy", null],
    ["set interceptor variable to proxy", null],
    ["set interceptor header to proxy", null],
    ["set the interceptor header to 1", null],
    ["then set the interceptor header to 1", null],
    ["set the Interceptor header to native", null],
    ["set the interceptor param to agent", null],
    ["set the proxy interceptor url to http://localhost:9159", null],
    ["set the interceptor timeout to 30s", null],
    ["set the interceptor url to proxy", null],
    ["set endpoint interceptor.example.com", null],
    ["use endpoint interceptor.dev/api", null],
    ["set address interceptor.local", null],
    ["set bearer interceptor.a.b", null],
    ["use proxy auth", null],
    ["set it to use proxy mode", null],
    ["set from address to proxy", null],
    // Values that end in a switch
    ["set header X-Note: please use proxy", null],
    ["set header Via: use proxy", null],
    ["set param q=use proxy", null],
    ["add param search=switch to agent", null],
    ["set the url to use proxy", null],
    ["set bearer token to use proxy", null],
    ["set pre-request script to // use proxy", null],
    ["rename this request to Switch to agent", null],
    // Other targets
    ["set env variable proxy=http://x", "add_or_update_environment_variables"],
    ["switch to the proxy environment", "select_environment"],
    ["switch to the interceptor env", "select_environment"],
    ["select interceptor environment", "select_environment"],
    ["select the interceptor environment", "select_environment"],
    ["switch to the interceptor tests environment", "select_environment"],
    ["select the interceptors tab", null],
    ["switch to team Interceptor QA", null],
    ["use the interceptor docs link in the description", null],
    ["switch from the dev collection to the interceptor collection", null],
    ["switch from staging to proxy", null],
    ["switch from GET to proxy", null],
    ["change from json to the agent", null],
    ["switch from proxy", null],
    // Questions, statements, negations
    ["can I use the agent interceptor?", null],
    ["could I use the proxy?", null],
    ["can I use proxy?", null],
    ["can we use the proxy?", null],
    ["can we use the agent?", null],
    ["will I need to use the proxy?", null],
    ["would I need to switch to the agent?", null],
    ["should I use the proxy interceptor?", null],
    ["which interceptor should I use?", null],
    ["I need to know if I should use the proxy", null],
    ["i can use the agent", null],
    ["I use proxy", null],
    ["you use proxy", null],
    ["we use the agent.", null],
    ["you can use the proxy interceptor for CORS", null],
    ["I set the interceptor to proxy but it fails", null],
    ["we set the interceptor to agent last week", null],
    ["you set the interceptor to proxy earlier", null],
    ["I'd use the proxy interceptor but it's down", null],
    ["don't use the proxy", null],
    ["no need to switch to proxy", null],
    ["let's not use the proxy", null],
    ["I'd rather not use the agent interceptor", null],
  ])("doesn't read %s as a switch", (text, name) => {
    expect(parseAppActionCommand(text)?.name ?? null).toBe(name)
  })
})

describe("create_collection", () => {
  it.each([
    "create a collection for the auth flows",
    "create a collection with my requests",
    "make a new collection",
  ])("needs a name for %s", (text) => {
    expect(parseAppActionCommand(text)?.name).not.toBe("create_collection")
  })

  it.each([
    ["create a collection called Auth flows", "Auth flows"],
    ["create collection Users", "Users"],
    ["create a collection for login named Login", "Login"],
    ['create a collection "for the win"', "for the win"],
  ])("names the collection from %s", (text, name) => {
    expect(parseAppActionCommand(text)).toEqual({
      name: "create_collection",
      input: { name },
    })
  })
})

describe("splitCommands", () => {
  it("splits a tab action from the run", () => {
    expect(splitCommands("open a new tab and run the request")).toEqual([
      "open a new tab",
      "run the request",
    ])
  })
})
