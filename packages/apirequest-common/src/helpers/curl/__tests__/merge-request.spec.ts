import { describe, expect, it } from "vitest"
import { getDefaultRESTRequest } from "@apirequest/data"
import { parseCurlToHoppRESTReq } from ".."
import { mergeCurlRequest } from "../merge-request"
import { generateCode } from "~/helpers/new-codegen"
import * as O from "fp-ts/Option"

describe("updating a documented API from cURL", () => {
  it("keeps the API identity, documentation and examples while updating the request", () => {
    const current = {
      ...getDefaultRESTRequest(),
      id: "saved-api",
      _ref_id: "req-original",
      name: "Create user",
      description: "# User API\nCreates a user.",
      preRequestScript: "pw.env.set('tenant', 'test')",
      testScript: "pw.test('status', () => {})",
      requestVariables: [{ key: "tenant", value: "test", active: true }],
      responses: {
        success: {
          name: "Created",
          status: "Created",
          code: 201,
          headers: [],
          body: '{"id":1}',
        },
      },
    }
    const imported = parseCurlToHoppRESTReq(
      `curl 'https://example.com/users?tenant=test' -H 'Content-Type: application/json' --data '{"name":"Ada"}'`
    )
    const updated = mergeCurlRequest(current, imported)

    expect(updated).toMatchObject({
      id: current.id,
      _ref_id: current._ref_id,
      name: current.name,
      description: current.description,
      responses: current.responses,
      requestVariables: current.requestVariables,
      preRequestScript: current.preRequestScript,
      testScript: current.testScript,
      method: "POST",
      endpoint: "https://example.com/users",
      body: { contentType: "application/json" },
    })
    // 导入器会格式化 JSON；这里验证请求内容，不依赖缩进方式。
    if (updated.body.contentType !== "application/json")
      throw new Error("Expected a JSON request body")
    expect(JSON.parse(updated.body.body)).toEqual({ name: "Ada" })
    const regenerated = O.getOrElse(() => "")(
      generateCode("shell-curl", updated)
    )
    expect(regenerated).toContain("https://example.com/users?tenant=test")
    expect(regenerated).toContain("Ada")
    expect(current.endpoint).not.toBe(updated.endpoint)
  })

  it("retains matching field descriptions and removes fields absent from the new command", () => {
    const current = getDefaultRESTRequest()
    current.params = [
      { key: "page", value: "1", active: true, description: "Page number" },
      { key: "old", value: "yes", active: true, description: "Old field" },
    ]
    current.headers = [
      { key: "X-Tenant", value: "old", active: true, description: "Tenant ID" },
    ]
    const updated = mergeCurlRequest(
      current,
      parseCurlToHoppRESTReq(
        "curl 'https://example.com/users?page=2&sort=name' -H 'x-tenant: new'"
      )
    )
    expect(updated.params).toEqual([
      { key: "page", value: "2", active: true, description: "Page number" },
      { key: "sort", value: "name", active: true, description: "" },
    ])
    expect(updated.headers).toContainEqual({
      key: "x-tenant",
      value: "new",
      active: true,
      description: "Tenant ID",
    })
  })

  it("clears old cURL flags when the imported command omits them", () => {
    const current = getDefaultRESTRequest()
    current.curlOptions = { flags: ["f"], output: "result.json" }
    expect(
      mergeCurlRequest(
        current,
        parseCurlToHoppRESTReq("curl https://example.com")
      ).curlOptions
    ).toBeUndefined()
  })
})
