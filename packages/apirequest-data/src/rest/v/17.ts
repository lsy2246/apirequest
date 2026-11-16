import { z } from "zod"
import { defineVersion } from "verzod"
import { V16_SCHEMA } from "./16"

// 仅供生成 Shell cURL 使用，旧版请求没有这组可选字段。
export const HoppRESTCurlOptions = z.object({
  flags: z.array(z.enum(["f", "s", "S", "L", "i", "fail-with-body"])),
  output: z.string().min(1).optional(),
})

export const V17_SCHEMA = V16_SCHEMA.extend({
  v: z.literal("17"),
  description: z.string().nullable().catch(null),
  curlOptions: HoppRESTCurlOptions.optional().catch(undefined),
  queryEncoding: z.boolean().optional().catch(undefined),
})

const V17_VERSION = defineVersion({ initial: true, schema: V17_SCHEMA })

export default V17_VERSION
