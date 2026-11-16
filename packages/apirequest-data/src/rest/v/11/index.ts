import { z } from "zod"

import { V10_SCHEMA } from "../10"
import { defineVersion } from "verzod"

import { HoppRESTAuth } from "./auth"

export const V11_SCHEMA = V10_SCHEMA.extend({
  v: z.literal("11"),
  auth: HoppRESTAuth,
})

export default defineVersion({ initial: true, schema: V11_SCHEMA })
