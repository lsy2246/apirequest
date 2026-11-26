import { describe, it, expect } from "vitest"
import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import { indexSyncedRequests, matchesCollectionRequest } from "../collections"

const collection = makeCollection({
  name: "数据库目录",
  folders: [],
  requests: [],
  auth: { authType: "none", authActive: true },
  headers: [],
  variables: [],
  description: null,
  preRequestScript: "",
  testScript: "",
})
const request = { ...getDefaultRESTRequest(), id: "server-one", _ref_id: "one" }

describe("当前接口高亮身份", () => {
  it("摘要与标签页引用不同时仍按数据库 ID 匹配", () => {
    expect(matchesCollectionRequest(request, { id: request.id, _ref_id: "old-ref" })).toBe(true)
  })
  it("相同引用不能把另一个数据库接口标为当前项", () => {
    expect(matchesCollectionRequest(request, { id: "another", _ref_id: request._ref_id })).toBe(false)
  })
  it("没有数据库 ID 时使用稳定引用", () => {
    expect(matchesCollectionRequest({ _ref_id: "one" }, request)).toBe(true)
    expect(matchesCollectionRequest({ _ref_id: "server-one" }, { id: "server-one" })).toBe(true)
  })
  it("没有身份或引用不匹配时不高亮其他接口", () => {
    expect(matchesCollectionRequest({}, request)).toBe(false)
    expect(matchesCollectionRequest({ _ref_id: "another" }, request)).toBe(false)
  })
})

describe("单人工作台重绑请求标签页", () => {
  it("用后端 ID 找到移动到子目录的请求", () => {
    const locate = indexSyncedRequests([
      { ...collection, folders: [{ ...collection, requests: [request] }] },
    ])
    expect(locate(request)).toEqual({ folderPath: "0/0", requestIndex: 0 })
  })

  it("允许刚迁入的请求通过稳定引用接回服务器记录", () => {
    const locate = indexSyncedRequests([{ ...collection, requests: [request] }])
    expect(locate({ _ref_id: request._ref_id })).toEqual({
      folderPath: "0",
      requestIndex: 0,
    })
  })

  it("已删除的请求不会借用旧引用或位置绑定到新记录", () => {
    const locate = indexSyncedRequests([{ ...collection, requests: [request] }])
    expect(locate({ id: "deleted", _ref_id: request._ref_id })).toBeUndefined()
  })
})
