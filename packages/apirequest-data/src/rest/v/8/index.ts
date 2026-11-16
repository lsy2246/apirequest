import { defineVersion } from "verzod"
import { z } from "zod"

import { V7_SCHEMA } from "../7"

import { HoppRESTRequestResponses } from "../../../rest-request-response"

import { HoppRESTAuth } from "./auth"

export const V8_SCHEMA = V7_SCHEMA.extend({
  v: z.literal("8"),
  auth: HoppRESTAuth,
  responses: HoppRESTRequestResponses,
})

export default defineVersion({ initial: true, schema: V8_SCHEMA })
