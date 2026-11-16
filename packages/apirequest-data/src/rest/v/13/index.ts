import { V12_SCHEMA } from "../12"

import { z } from "zod"
import { defineVersion } from "verzod"

import { HoppRESTAuth } from "./auth"

export const V13_SCHEMA = V12_SCHEMA.extend({
  v: z.literal("13"),
  auth: HoppRESTAuth,
})

export default defineVersion({ initial: true, schema: V13_SCHEMA })
