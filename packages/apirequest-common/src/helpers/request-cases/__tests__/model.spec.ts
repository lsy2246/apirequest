import { describe, expect, it } from "vitest"
import { getDefaultRESTRequest } from "@apirequest/data"
import {
  buildCaseRequest,
  CaseMapSchema,
  newRequestCase,
  evaluateAssertions,
  readCaseFile,
  type CaseAssertion,
} from "../model"
const assertion = (patch: Partial<CaseAssertion> = {}): CaseAssertion => ({
  id: "assertion",
  target: "status",
  path: "",
  operator: "eq",
  expected: "200",
  ...patch,
})
const response = {
  status: 200,
  duration: 120,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    code: 0,
    data: { id: 42, enabled: true, nullable: null, tags: ["a", "b"], "x.y": 5 },
  }),
}

describe("request case model", () => {
  it("migrates legacy variables/status without enabling previously skipped scripts", () => {
    const map = CaseMapSchema.parse({
      request: [
        {
          id: "old",
          name: "Legacy",
          variables: { id: "1" },
          expectedStatus: 401,
        },
      ],
    })
    expect(map.request[0].scripts).toBe("disabled")
    expect(map.request[0].assertions[0]).toMatchObject({
      target: "status",
      expected: "401",
    })
    expect(map.request[0].overrides.auth).toBe("inherit")
    expect(newRequestCase().scripts).toBe("inherit")
  })
  it("overrides inputs and removes inherited/inline fields without mutating the API", () => {
    const base = getDefaultRESTRequest()
    base.endpoint = "http://example.test/users?delete=1&stay=yes"
    base.method = "GET"
    base.params = [{ key: "id", value: "old", active: true, description: "" }]
    base.headers = [
      { key: "X-Case", value: "old", active: true, description: "" },
    ]
    base.auth = { authType: "inherit", authActive: true }
    const entry = newRequestCase()
    entry.variables = { id: "" }
    entry.overrides.method = "POST"
    entry.overrides.params = [
      { key: "id", value: "42", remove: false },
      { key: "delete", value: "", remove: true },
    ]
    entry.overrides.headers = [
      { key: "x-case", value: "new", remove: false },
      { key: "x-parent", value: "", remove: true },
    ]
    entry.overrides.auth = "none"
    entry.overrides.body = { mode: "json", text: '{"ok":true}', fields: [] }
    const inherited = {
      headers: [
        { inheritedHeader: { key: "X-Parent", value: "secret", active: true } },
        {
          inheritedHeader: {
            key: "Authorization",
            value: "Bearer old",
            active: true,
          },
        },
      ],
      auth: {
        inheritedAuth: { authType: "bearer", authActive: true, token: "old" },
      },
    } as any
    const before = JSON.stringify(base),
      parentBefore = JSON.stringify(inherited)
    const request = buildCaseRequest(base, entry, inherited)
    expect(request.method).toBe("POST")
    expect(request.endpoint).toBe("http://example.test/users")
    expect(request.params).toMatchObject([
      { key: "stay", value: "yes" },
      { key: "id", value: "42" },
    ])
    expect(request.headers).toMatchObject([{ key: "x-case", value: "new" }])
    expect(request.auth.authType).toBe("none")
    expect(request.body).toEqual({
      contentType: "application/json",
      body: '{"ok":true}',
    })
    expect(request.requestVariables[0]).toMatchObject({ key: "id", value: "" })
    expect(JSON.stringify(base)).toBe(before)
    expect(JSON.stringify(inherited)).toBe(parentBefore)
  })
  it("inherits auth/scripts by default and supports custom or disabled scripts", () => {
    const base = getDefaultRESTRequest()
    base.preRequestScript = "before"
    base.testScript = "after"
    base.auth = { authType: "inherit", authActive: true }
    const entry = newRequestCase(),
      inherited = {
        headers: [],
        auth: {
          inheritedAuth: {
            authType: "bearer",
            authActive: true,
            token: "parent",
          },
        },
      } as any
    expect(buildCaseRequest(base, entry, inherited)).toMatchObject({
      preRequestScript: "before",
      auth: { token: "parent" },
    })
    entry.scripts = "disabled"
    expect(buildCaseRequest(base, entry, inherited)).toMatchObject({
      preRequestScript: "",
      testScript: "",
    })
    entry.scripts = "custom"
    entry.preRequestScript = "custom"
    expect(buildCaseRequest(base, entry, inherited).preRequestScript).toBe(
      "custom"
    )
  })
  it("lets header patches remove generated authentication without a separate auth selector", () => {
    const base = getDefaultRESTRequest()
    base.auth = { authType: "bearer", authActive: true, token: "original" }
    const entry = newRequestCase()
    entry.overrides.headers = [
      { key: "Authorization", value: "", remove: true },
    ]
    const result = buildCaseRequest(base, entry)
    expect(result.auth.authType).toBe("none")
    expect(
      result.headers.some(
        (header) => header.key.toLowerCase() === "authorization"
      )
    ).toBe(false)
    entry.overrides.headers = [
      { key: "Authorization", value: "Bearer case", remove: false },
    ]
    expect(buildCaseRequest(base, entry).headers).toContainEqual(
      expect.objectContaining({ key: "Authorization", value: "Bearer case" })
    )
    expect(base.auth).toMatchObject({ authType: "bearer", token: "original" })
  })
  it("keeps an explicit Content-Type override for negative request tests", () => {
    const entry = newRequestCase()
    entry.overrides.body = { mode: "json", text: "{}", fields: [] }
    entry.overrides.headers = [
      { key: "Content-Type", value: "text/plain", remove: false },
    ]
    expect(
      buildCaseRequest(getDefaultRESTRequest(), entry).headers
    ).toContainEqual(
      expect.objectContaining({ key: "Content-Type", value: "text/plain" })
    )
  })
  it("round-trips binary and multipart file samples through JSON persistence", async () => {
    const bytes = new Uint8Array([0, 255, 42, 13, 10])
    const file = await readCaseFile(
      new File([bytes], "sample.bin", { type: "application/octet-stream" })
    )
    let entry = newRequestCase()
    entry.overrides.body = {
      mode: "multipart",
      text: "",
      fields: [
        { id: "one", key: "file", kind: "file", value: "", file },
        { id: "two", key: "name", kind: "text", value: "test" },
      ],
    }
    entry = CaseMapSchema.parse({
      request: [JSON.parse(JSON.stringify(entry))],
    }).request[0]
    const body = buildCaseRequest(getDefaultRESTRequest(), entry).body
    expect(body.contentType).toBe("multipart/form-data")
    if (body.contentType !== "multipart/form-data" || !body.body[0].isFile)
      throw new Error("Missing file")
    const uploaded = body.body[0].value[0]
    expect(uploaded.name).toBe("sample.bin")
    expect(uploaded.size).toBe(5)
    entry.overrides.body = { mode: "binary", text: "", fields: [], file }
    expect(buildCaseRequest(getDefaultRESTRequest(), entry).body).toMatchObject(
      {
        contentType: "application/octet-stream",
        body: { name: "sample.bin", size: 5 },
      }
    )
    await expect(
      readCaseFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large"))
    ).rejects.toThrow("case_file_too_large")
  })
  it("evaluates multiple typed JSON/header/status/body/time checks", () => {
    const results = evaluateAssertions(
      [
        assertion(),
        assertion({ target: "json", path: "$.data.id", expected: "42" }),
        assertion({ target: "json", path: "data.enabled", expected: "true" }),
        assertion({ target: "json", path: "data.tags[0]", expected: "a" }),
        assertion({ target: "json", path: 'data["x.y"]', expected: "5" }),
        assertion({
          target: "header",
          path: "content-type",
          operator: "contains",
          expected: "json",
        }),
        assertion({
          target: "body",
          operator: "contains",
          expected: "nullable",
        }),
        assertion({ target: "duration", operator: "lte", expected: "1000" }),
      ],
      response
    )
    expect(results.every((result) => result.passed)).toBe(true)
    expect(results[1]).toMatchObject({ expected: 42, actual: 42 })
  })
  it("distinguishes missing fields, null, failed assertions, invalid JSON, and inherited properties", () => {
    const results = evaluateAssertions(
      [
        assertion({
          target: "json",
          path: "data.nullable",
          operator: "exists",
        }),
        assertion({
          target: "json",
          path: "data.missing",
          operator: "not_exists",
        }),
        assertion({
          target: "json",
          path: "data.missing",
          operator: "ne",
          expected: "42",
        }),
        assertion({ target: "json", path: "constructor", operator: "exists" }),
        assertion({ target: "json", path: "data.id", expected: "43" }),
      ],
      response
    )
    expect(results.map((result) => result.passed)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
    expect(
      evaluateAssertions(
        [assertion({ target: "json", operator: "not_exists" })],
        { ...response, body: "<html>" }
      )[0]
    ).toMatchObject({ passed: false, error: "case_invalid_json_response" })
    expect(
      evaluateAssertions(
        [assertion({ target: "duration", operator: "lt", expected: "" })],
        response
      )[0].passed
    ).toBe(false)
  })
})
