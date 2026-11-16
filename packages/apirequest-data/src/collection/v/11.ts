import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppCollection } from ".."
import { v10_baseCollectionSchema, V10_SCHEMA } from "./10"

export const v11_baseCollectionSchema = v10_baseCollectionSchema.extend({
  v: z.literal(11),
  description: z.string().nullable().catch(null),
})

type Input = z.input<typeof v11_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v11_baseCollectionSchema> & {
  folders: Output[]
}

export const V11_SCHEMA = v11_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V11_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V11_SCHEMA })
