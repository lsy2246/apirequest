import { z } from "zod"
import { defineVersion } from "verzod"
import { V0_SCHEMA } from "./0"

export const V1_SCHEMA = z.object({
  v: z.literal(1),
  variables: z.array(
    z.union([
      z.object({
        key: z.string(),
        secret: z.literal(true),
      }),
      z.object({
        key: z.string(),
        value: z.string(),
        secret: z.literal(false),
      }),
    ])
  ),
})

export default defineVersion({ initial: true, schema: V1_SCHEMA })
