import { defineVersion } from "verzod"
import { z } from "zod"
import { V9_SCHEMA } from "./9"
import { generateUniqueRefId } from "../../utils/collection"
import { HoppGQLRequestResponses } from "../../gql-request-response"

export const V10_SCHEMA = V9_SCHEMA.extend({
  v: z.literal(10),
  _ref_id: z.string().optional(),
  description: z.string().nullable().catch(null),
  responses: HoppGQLRequestResponses.catch({}),
  preRequestScript: z.string().catch(""),
  testScript: z.string().catch(""),
})

export default defineVersion({ initial: true, schema: V10_SCHEMA })
