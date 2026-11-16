import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { V4_SCHEMA, v4_baseCollectionSchema } from "./4"
import { generateUniqueRefId } from "../../utils/collection"
import { HoppCollection } from ".."

export const v5_baseCollectionSchema = v4_baseCollectionSchema.extend({
  v: z.literal(5),
  _ref_id: z.string().optional(),
})

type Input = z.input<typeof v5_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v5_baseCollectionSchema> & {
  folders: Output[]
}

export const V5_SCHEMA = v5_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V5_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V5_SCHEMA })
