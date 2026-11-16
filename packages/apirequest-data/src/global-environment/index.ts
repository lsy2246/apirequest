import { InferredEntity, createVersionedEntity } from "verzod"

import { z } from "zod"

import V2_VERSION from "./v/2"

const versionedObject = z.object({
  v: z.number(),
})

export const GLOBAL_ENV_LATEST_VERSION = 2 as const

export const GlobalEnvironment = createVersionedEntity({
  latestVersion: GLOBAL_ENV_LATEST_VERSION,
  versionMap: { 2: V2_VERSION },
  getVersion(data) {
    const result = versionedObject.safeParse(data)
    return result.success ? result.data.v : null
  },
})

export type GlobalEnvironment = InferredEntity<typeof GlobalEnvironment>

export type GlobalEnvironmentVariable = InferredEntity<
  typeof GlobalEnvironment
>["variables"][number]

export const GlobalEnvironmentSchemaVersion = 2
