import {
  getSharedCookieMethods,
  getSharedEnvMethods,
  getSharedRequestProps,
  preventCyclicObjects,
} from "~/utils/shared"

import { Cookie, HoppRESTRequest } from "@apirequest/data"
import { describe, expect, test } from "vitest"
import { TestResult } from "~/types"

describe("preventCyclicObjects", () => {
  test("succeeds with a simple object", () => {
    const testObj = {
      a: 1,
    }

    expect(preventCyclicObjects(testObj)).toBeRight()
  })

  test("fails with a cyclic object", () => {
    const testObj = {
      a: 1,
      b: null as any,
    }

    testObj.b = testObj

    expect(preventCyclicObjects(testObj)).toBeLeft()
  })
})

describe("getSharedRequestProps", () => {
  const baseRequest: HoppRESTRequest = {
    v: "16",
    name: "Test Request",
    endpoint: "https://example.com/api",
    method: "GET",
    headers: [{ key: "X-Test", value: "val1", active: true, description: "" }],
    params: [{ key: "q", value: "search", active: true, description: "" }],
    body: { contentType: null, body: null },
    auth: { authType: "none", authActive: false },
    preRequestScript: "",
    testScript: "",
    requestVariables: [],
    responses: {},
  }

  test("`url` getter", () => {
    const request = getSharedRequestProps(baseRequest)
    expect(request.url).toBe("https://example.com/api")
  })

  test("`method` getter", () => {
    const request = getSharedRequestProps(baseRequest)
    expect(request.method).toBe("GET")
  })

  test("`headers` getter", () => {
    const request = getSharedRequestProps(baseRequest)
    expect(request.headers).toEqual(baseRequest.headers)
  })

  test("`params` getter", () => {
    const request = getSharedRequestProps(baseRequest)
    expect(request.params).toEqual(baseRequest.params)
  })

  test("`body` getter", () => {
    const request = getSharedRequestProps(baseRequest)
    expect(request.body).toEqual(baseRequest.body)
  })

  test("`auth` getter", () => {
    const request = getSharedRequestProps(baseRequest)
    expect(request.auth).toEqual(baseRequest.auth)
  })
})

describe("getSharedCookieMethods", () => {
  const validCookie: Cookie = {
    name: "session",
    value: "abc123",
    domain: "example.com",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }

  test("get() should return existing cookie or null", () => {
    const { methods } = getSharedCookieMethods([
      validCookie,
      { ...validCookie, name: "token", value: "xyz" },
    ])

    expect(methods.get("example.com", "session")).toEqual(validCookie)
    expect(methods.get("example.com", "missing")).toBeNull()
  })

  test("get() should throw for non-string args", () => {
    const { methods } = getSharedCookieMethods([validCookie])
    expect(() => methods.get(123, "session")).toThrow(
      "Expected domain and cookieName to be strings",
    )
  })

  test("set() should add a new cookie", () => {
    const { methods } = getSharedCookieMethods([])
    methods.set("example.com", validCookie)

    expect(methods.get("example.com", "session")).toEqual(validCookie)
  })

  test("set() should replace an existing cookie with same domain+name", () => {
    const oldCookie = { ...validCookie, value: "old" }
    const { methods } = getSharedCookieMethods([oldCookie])

    methods.set("example.com", validCookie)

    expect(methods.getAll("example.com")).toHaveLength(1)
    expect(methods.get("example.com", "session")?.value).toBe("abc123")
  })

  test("set() should throw for invalid cookie per schema", () => {
    const { methods } = getSharedCookieMethods([])
    expect(() => methods.set("example.com", { bad: "cookie" })).toThrow(
      "Invalid cookie",
    )
  })

  test("has() should return true if cookie exists", () => {
    const { methods } = getSharedCookieMethods([validCookie])

    expect(methods.has("example.com", "session")).toBe(true)
    expect(methods.has("example.com", "missing")).toBe(false)
  })

  test("getAll() should return all cookies for a domain", () => {
    const cookies = [
      validCookie,
      { ...validCookie, name: "token", value: "x" },
      { ...validCookie, domain: "other.com" },
    ]
    const { methods } = getSharedCookieMethods(cookies)

    const result = methods.getAll("example.com")
    expect(result).toHaveLength(2)
    expect(result.every((c) => c.domain === "example.com")).toBe(true)
  })

  test("delete() should remove the specified cookie", () => {
    const { methods } = getSharedCookieMethods([validCookie])
    methods.delete("example.com", "session")
    expect(methods.get("example.com", "session")).toBeNull()
  })

  test("clear() should remove all cookies for a domain", () => {
    const cookies = [validCookie, { ...validCookie, name: "token", value: "x" }]
    const { methods } = getSharedCookieMethods(cookies)

    methods.clear("example.com")
    expect(methods.getAll("example.com")).toHaveLength(0)
  })

  test("should throw for non-string args on has/delete/getAll/clear", () => {
    const { methods } = getSharedCookieMethods([validCookie])
    expect(() => methods.has(123 as any, "session")).toThrow()
    expect(() => methods.delete(123 as any, "session")).toThrow()
    expect(() => methods.getAll(123 as any)).toThrow()
    expect(() => methods.clear(123 as any)).toThrow()
  })
})

describe("getSharedEnvMethods", () => {
  const baseEnvs: TestResult["envs"] = {
    global: [
      {
        key: "globalKey",
        currentValue: "globalVal",
        initialValue: "globalVal",
        secret: false,
      },
    ],
    selected: [
      {
        key: "selectedKey",
        currentValue: "selectedVal",
        initialValue: "selectedVal",
        secret: false,
      },
    ],
  }

  test("returns current environment methods", () => {
    const { methods } = getSharedEnvMethods(baseEnvs)

    expect(methods).toHaveProperty("current")
    expect(methods).toHaveProperty("hopp")
    expect(methods.current).toHaveProperty("get")
    expect(methods.hopp).toHaveProperty("set")
  })

  test("hopp.get retrieves from selected then global", () => {
    const { methods } = getSharedEnvMethods(baseEnvs)

    expect(methods.current.get("selectedKey")).toBe("selectedVal")
    expect(methods.current.get("globalKey")).toBe("globalVal")
    expect(methods.current.get("nonexistent")).toBeUndefined()
  })

  test("hopp.set updates selected environment", () => {
    const { methods, updatedEnvs } = getSharedEnvMethods(baseEnvs)

    methods.current.set("newKey", "newVal")

    expect(updatedEnvs.selected).toContainEqual({
      key: "newKey",
      currentValue: "newVal",
      initialValue: "newVal",
      secret: false,
    })
  })

  test("hopp.set validates string key and value", () => {
    const { methods } = getSharedEnvMethods(baseEnvs)

    expect(() => methods.current.set(123 as any, "value")).toThrow(
      "Expected key to be a string",
    )
    expect(() => methods.current.set("key", 123 as any)).toThrow(
      "Expected value to be a string",
    )
  })

  test("hopp.resolve handles template strings", () => {
    const { methods } = getSharedEnvMethods({
      global: [],
      selected: [
        {
          key: "name",
          currentValue: "Alice",
          initialValue: "Alice",
          secret: false,
        },
        {
          key: "greeting",
          currentValue: "Hello <<name>>",
          initialValue: "Hello <<name>>",
          secret: false,
        },
      ],
    })

    const resolved = methods.current.resolve("<<greeting>>")
    expect(resolved).toBe("Hello Alice")
  })

  test("hopp.getResolve combines get and resolve", () => {
    const { methods } = getSharedEnvMethods({
      global: [],
      selected: [
        {
          key: "baseUrl",
          currentValue: "https://api.example.com",
          initialValue: "https://api.example.com",
          secret: false,
        },
        {
          key: "endpoint",
          currentValue: "<<baseUrl>>/users",
          initialValue: "<<baseUrl>>/users",
          secret: false,
        },
      ],
    })

    const resolved = methods.current.getResolve("endpoint")
    expect(resolved).toBe("https://api.example.com/users")
  })

  test("hopp.set creates new variable in selected scope (default source='all')", () => {
    const { methods, updatedEnvs } = getSharedEnvMethods(baseEnvs)

    methods.hopp.set("hoppKey", "hoppVal")

    expect(updatedEnvs.selected).toContainEqual({
      key: "hoppKey",
      currentValue: "hoppVal",
      initialValue: "hoppVal",
      secret: false,
    })
  })

  test("hopp.set validates string types", () => {
    const { methods } = getSharedEnvMethods(baseEnvs)

    expect(() => methods.hopp.set(123 as any, "value")).toThrow(
      "Expected key to be a string",
    )
    expect(() => methods.hopp.set("key", 123 as any)).toThrow(
      "Expected value to be a string",
    )
  })

  test("hopp.delete removes variable from selected scope", () => {
    const { methods, updatedEnvs } = getSharedEnvMethods(baseEnvs)

    methods.hopp.delete("selectedKey")

    expect(updatedEnvs.selected).not.toContainEqual(
      expect.objectContaining({ key: "selectedKey" }),
    )
    expect(updatedEnvs.global.length).toBe(1)
  })

  test("hopp.reset resets a variable to its initial value", () => {
    const { methods, updatedEnvs } = getSharedEnvMethods({
      global: [],
      selected: [
        {
          key: "testKey",
          currentValue: "modified",
          initialValue: "original",
          secret: false,
        },
      ],
    })

    methods.hopp.reset("testKey")

    const variable = updatedEnvs.selected.find((e) => e.key === "testKey")
    expect(variable?.currentValue).toBe("original")
    expect(variable?.initialValue).toBe("original")
  })

  test("hopp.getInitialRaw returns initial value", () => {
    const { methods } = getSharedEnvMethods({
      global: [],
      selected: [
        {
          key: "testKey",
          currentValue: "currentVal",
          initialValue: "initialVal",
          secret: false,
        },
      ],
    })

    expect(methods.hopp.getInitialRaw("testKey")).toBe("initialVal")
    expect(methods.hopp.getInitialRaw("nonexistent")).toBeNull()
  })

  test("hopp.setInitial sets initial value", () => {
    const { methods, updatedEnvs } = getSharedEnvMethods(baseEnvs)

    methods.hopp.setInitial("initKey", "initVal")

    const created = updatedEnvs.selected.find((e) => e.key === "initKey")
    expect(created).toBeDefined()
    expect(created?.initialValue).toBe("initVal")
    expect(created?.currentValue).toBe("initVal")
  })
})

void 0
