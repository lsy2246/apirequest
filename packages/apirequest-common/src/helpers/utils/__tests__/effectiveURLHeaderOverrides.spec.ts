import { describe, expect, test } from "vitest"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { parseCurlToHoppRESTReq } from "~/helpers/curl"
import {
  getComputedAuthHeaders,
  getComputedBodyHeaders,
  getEffectiveRESTRequest,
} from "../EffectiveURL"

const env = { name: "本地请求头测试", variables: [] }

describe("请求头编辑与发送保持一致", () => {
  test.each(["Authorization", "authorization", "AUTHORIZATION"])(
    "显式 %s 覆盖自动认证头且只发送一次",
    async (key) => {
      const request = getDefaultRESTRequest()
      request.auth = {
        authType: "bearer",
        authActive: true,
        token: "generated-test-token",
      }
      request.headers = [
        {
          key,
          value: "Bearer edited-test-token",
          active: true,
          description: "",
        },
      ]
      expect(await getComputedAuthHeaders([], request)).toEqual([])
      const effective = await getEffectiveRESTRequest(request, env)
      expect(
        effective.effectiveFinalHeaders.filter(
          (h) => h.key.toLowerCase() === "authorization"
        )
      ).toEqual(request.headers)
    }
  )

  test("停用手写请求头后恢复自动生成值", async () => {
    const request = getDefaultRESTRequest()
    request.auth = {
      authType: "bearer",
      authActive: true,
      token: "generated-test-token",
    }
    request.headers = [
      {
        key: "Authorization",
        value: "ignored",
        active: false,
        description: "",
      },
    ]
    expect(await getComputedAuthHeaders([], request)).toMatchObject([
      { value: "Bearer generated-test-token" },
    ])
  })

  test("手写请求头同样覆盖继承的授权", async () => {
    const request = getDefaultRESTRequest()
    request.headers = [
      {
        key: "authorization",
        value: "Bearer edited",
        active: true,
        description: "",
      },
    ]
    expect(
      await getComputedAuthHeaders([], request, {
        authType: "bearer",
        authActive: true,
        token: "parent",
      })
    ).toEqual([])
  })

  test("cURL 的显式认证与 Content-Type 可编辑，修改后的值用于发送", async () => {
    const request = parseCurlToHoppRESTReq(
      `curl http://127.0.0.1:3188/api/echo -H 'Authorization: Bearer original' -H 'CoNtEnT-TyPe: application/json; charset=utf-8' -d '{"check":true}'`
    )
    expect(request.headers).toMatchObject([
      { key: "Authorization" },
      { key: "CoNtEnT-TyPe", value: "application/json; charset=utf-8" },
    ])
    request.headers[0].value = "Bearer edited-test-token"
    request.headers[1].value = "application/problem+json"
    expect(getComputedBodyHeaders(request)).toEqual([])
    const effective = await getEffectiveRESTRequest(request, env)
    expect(effective.effectiveFinalHeaders).toEqual(request.headers)
  })

  test("multipart 不能沿用 cURL 的旧 boundary", () => {
    const request = parseCurlToHoppRESTReq(
      `curl http://127.0.0.1:3188/api/echo -H 'Content-Type: multipart/form-data; boundary=old' -F 'name=test'`
    )
    expect(request.body.contentType).toBe("multipart/form-data")
    expect(
      request.headers.some((h) => h.key.toLowerCase() === "content-type")
    ).toBe(false)
  })
})
