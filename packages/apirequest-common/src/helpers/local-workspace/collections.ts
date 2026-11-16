import type { HoppCollection } from "@apirequest/data";

type RequestLocation = {
  folderPath: string
  requestIndex: number
}

type CollectionRequest = HoppCollection["requests"][number]
type RequestIdentity = Pick<CollectionRequest, "id" | "_ref_id">

// 集合顺序由后端决定。重新绑定标签页时按身份查找，旧索引只用于识别原请求。
export function indexSyncedRequests(collections: HoppCollection[]) {
  const byID = new Map<string, RequestLocation>()
  const byRef = new Map<string, RequestLocation>()

  function visit(items: HoppCollection[], parent?: string) {
    items.forEach((item, index) => {
      const folderPath =
        parent === undefined ? String(index) : `${parent}/${index}`
      item.requests.forEach((request, requestIndex) => {
        const location = { folderPath, requestIndex }
        if (request.id) byID.set(request.id, location)
        if (request._ref_id) byRef.set(request._ref_id, location)
      })
      visit(item.folders, folderPath)
    })
  }

  visit(collections)
  return (identity: RequestIdentity, refID?: string) => {
    if (identity.id) return byID.get(identity.id)
    const ref = refID || identity._ref_id
    return ref ? (byRef.get(ref) ?? byID.get(ref)) : undefined
  }
}
