import { V15_SCHEMA } from "./15"
import { z } from "zod"
import { defineVersion } from "verzod"
import { generateUniqueRefId } from "../../utils/collection"

export const V16_SCHEMA = V15_SCHEMA.extend({
  v: z.literal("16"),
  _ref_id: z.string().optional(),
})

const V16_VERSION = defineVersion({ initial: true, schema: V16_SCHEMA })

export default V16_VERSION
