import { V14_SCHEMA } from "../14"

import { z } from "zod"
import { defineVersion } from "verzod"

import { HoppRESTAuth } from "./auth"

export const V15_SCHEMA = V14_SCHEMA.extend({
  v: z.literal("15"),
  auth: HoppRESTAuth,
})

const V15_VERSION = defineVersion({ initial: true, schema: V15_SCHEMA })

export default V15_VERSION
