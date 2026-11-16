import { defineVersion } from "verzod"
import { z } from "zod"

import { V8_SCHEMA } from "../8"
import { HoppRESTReqBody } from "./body"

export const V9_SCHEMA = V8_SCHEMA.extend({
  v: z.literal("9"),
  body: HoppRESTReqBody,
})

export default defineVersion({ initial: true, schema: V9_SCHEMA })
