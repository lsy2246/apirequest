import type { HoppCollectionVariable, HoppRESTAuth, HoppRESTHeaders } from "@apirequest/data";

export type CollectionDataProps = {
  auth: HoppRESTAuth
  headers: HoppRESTHeaders
  variables: HoppCollectionVariable[]
  description: string | null
  preRequestScript: string
  testScript: string
  _ref_id?: string
}
