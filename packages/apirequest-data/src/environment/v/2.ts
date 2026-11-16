import { z } from "zod"
import { defineVersion } from "verzod"
import { V1_SCHEMA } from "./1"

export const V2_SCHEMA = V1_SCHEMA.extend({
  v: z.literal(2),
  variables: z.array(
    z.object({
      key: z.string(),
      initialValue: z.string(),
      currentValue: z.string(),
      secret: z.boolean(),
    })
  ),
})

export default defineVersion({ initial: true, schema: V2_SCHEMA })
