import { z } from "zod"
import { defineVersion } from "verzod"
import { V13_SCHEMA } from "./13"

// Update the HoppRESTRequestResponses while migrating HoppRESTRequest
export const V14_SCHEMA = V13_SCHEMA.extend({
  v: z.literal("14"),
})

export default defineVersion({ initial: true, schema: V14_SCHEMA })
