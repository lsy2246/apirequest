import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppCollection } from ".."
import { v9_baseCollectionSchema, V9_SCHEMA } from "./9"

export const CollectionVariable = z.object({
  key: z.string(),
  initialValue: z.string(),
  currentValue: z.string(),
  secret: z.boolean(),
})

export type CollectionVariable = z.infer<typeof CollectionVariable>

export const v10_baseCollectionSchema = v9_baseCollectionSchema.extend({
  v: z.literal(10),
  variables: z.array(CollectionVariable),
})

type Input = z.input<typeof v10_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v10_baseCollectionSchema> & {
  folders: Output[]
}

export const V10_SCHEMA = v10_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V10_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V10_SCHEMA })
