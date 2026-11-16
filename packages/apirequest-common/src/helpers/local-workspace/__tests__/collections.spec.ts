import { describe, it, expect } from "vitest"
import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import { indexSyncedRequests } from "../collections"

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
