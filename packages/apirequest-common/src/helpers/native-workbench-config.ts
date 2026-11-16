import {
  Environment,
  generateUniqueRefId,
  getDefaultGQLRequest,
  HoppCollection,
  HoppGQLRequest,
  HoppRESTRequest,
  makeCollection,
  type EnvironmentVariable,
} from "@apirequest/data"
import { invoke } from "@tauri-apps/api/core"
import { z } from "zod"
import { NATIVE_STORE_SCOPE, Store } from "~/kernel/store"
import {
  populateLocalStoresFromVariables,
  stripClientLocalValuesForWire,
} from "~/helpers/clientLocalVariables"
import { getService } from "~/modules/dioc"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { LOAD_TEST_LIMITS } from "~/helpers/load-test/runner"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { restCollectionStore, setRESTCollections } from "~/newstore/collections"
import {
  deleteEnvironment,
  environmentsStore,
  updateEnvironment,
  appendEnvironments,
} from "~/newstore/environments"
import { STORE_KEYS, STORE_NAMESPACE } from "~/services/persistence"

type Config = Record<string, unknown> & { id: string }
type Mutation = "create" | "update" | "delete"
export const domains = z.enum([
  "collection",
  "request",
  "environment",
  "documentation",
  "automation",
  "load_test",
  "websocket",
])
export type Domain = z.infer<typeof domains>
type Entity = { id: string; data: Config }
type Change = {
  entity: Domain
  operation: Mutation
  id: string
  data?: unknown
}
type WorkbenchRequest = HoppRESTRequest | HoppGQLRequest

const text = z.string().trim().min(1).max(300)
const reference = z.string().min(1).max(256)
const variable = z
  .object({
    key: text,
    initialValue: z.string().default(""),
    currentValue: z.string().default(""),
    secret: z.boolean().default(false),
  })
  .strict()
const header = z
  .object({
    key: text,
    value: z.string(),
    active: z.boolean().default(true),
    description: z.string().default(""),
  })
  .strict()
const count = (min: number, max: number) => z.number().int().min(min).max(max)
const shape = {
  collection: z
    .object({
      name: text,
      parentID: reference.optional(),
      description: z.string().nullable().optional(),
      headers: z.array(header).optional(),
    })
    .strict(),
  request: z
    .object({
      name: text,
      collectionID: reference.optional(),
      protocol: z.enum(["rest", "graphql"]).optional(),
      endpoint: text.optional(),
      method: z
        .string()
        .regex(/^[A-Z-]+$/)
        .optional(),
      url: text.optional(),
      query: z.string().optional(),
      variables: z.string().optional(),
      headers: z.array(header).optional(),
      body: z.unknown().optional(),
      auth: z.unknown().optional(),
      params: z.array(header).optional(),
      preRequestScript: z.string().optional(),
      testScript: z.string().optional(),
      description: z.string().nullable().optional(),
    })
    .strict(),
  environment: z
    .object({ name: text, variables: z.array(variable).max(500).optional() })
    .strict(),
  documentation: z
    .object({
      title: text,
      collectionID: reference,
      description: z.string().optional(),
    })
    .strict(),
  automation: z
    .object({
      name: text,
      collectionID: reference,
      environmentID: reference.optional(),
      config: z
        .object({
          iterations: count(1, 1000),
          delay: count(0, 60000),
          stopOnError: z.boolean(),
          persistResponses: z.boolean(),
          keepVariableValues: z.boolean(),
          executeScripts: z.boolean(),
        })
        .partial()
        .strict()
        .optional(),
    })
    .strict(),
  load_test: z
    .object({
      name: text,
      requestID: reference,
      environmentID: reference.optional(),
      config: z
        .object({
          mode: z.enum(["requests", "duration"]),
          concurrency: count(1, LOAD_TEST_LIMITS.concurrency),
          requests: count(1, LOAD_TEST_LIMITS.requests),
          durationSeconds: count(1, LOAD_TEST_LIMITS.durationSeconds),
          timeoutMs: count(1, LOAD_TEST_LIMITS.timeoutMs),
        })
        .partial()
        .strict()
        .optional(),
    })
    .strict(),
  websocket: z
    .object({
      name: text,
      url: z
        .string()
        .url()
        .regex(/^wss?:\/\//i),
      protocols: z.array(z.string()).max(50).optional(),
    })
    .strict(),
}

function key(entity: Domain) {
  return `workbench-native-config.${entity}`
}

export async function readLocal<T>(key: string) {
  const result = await Store.get<T>(STORE_NAMESPACE, key)
  if (result._tag === "Left") throw new Error(result.left.message)
  return result.right
}

export async function writeLocal(key: string, value: unknown) {
  const result = await Store.set(STORE_NAMESPACE, key, value)
  if (result._tag === "Left") throw new Error(result.left.message)
}

const uid = (value: { id?: string; _ref_id?: string }) =>
  value.id ?? value._ref_id
function scanTree(
  folders: HoppCollection[],
  visit: (folder: HoppCollection, parent?: HoppCollection) => void,
  parent?: HoppCollection
) {
  for (const folder of folders) {
    visit(folder, parent)
    scanTree(folder.folders, visit, folder)
  }
}

function findFolder(folders: HoppCollection[], id: string) {
  let found: HoppCollection | undefined
  scanTree(folders, (folder) => {
    if (uid(folder) === id) found = folder
  })
  if (!found) throw new Error("Collection does not exist")
  return found
}

function activeTree() {
  return restCollectionStore.value.state
}

export async function configurations(entity: Domain): Promise<Entity[]> {
  if (entity === "collection" || entity === "request") {
    const result: Entity[] = []
    scanTree(activeTree(), (folder, parent) => {
      const id = uid(folder)
      if (!id) return
      if (entity === "collection") {
        const { folders, requests, ...properties } = folder
        result.push({
          id,
          data: {
            ...properties,
            id,
            parentID: parent && uid(parent),
            folders: folders.length,
            requests: requests.length,
          },
        })
      } else {
        for (const request of folder.requests) {
          const requestID = uid(request)
          if (requestID)
            result.push({
              id: requestID,
              data: {
                ...request,
                id: requestID,
                collectionID: id,
                protocol: "url" in request ? "graphql" : "rest",
              },
            })
        }
      }
    })
    return result
  }
  if (entity === "environment") {
    return environmentsStore.value.environments.map((environment) => ({
      id: environment.id,
      data: environment,
    }))
  }
  return ((await readLocal<Config[]>(key(entity))) ?? []).map((data) => ({
    id: data.id,
    data,
  }))
}

export const nativeGuide = {
  workflow:
    "Query by stable ID and propose an explicit patch. When the owner turns off approval, all new changes, including deletions and documentation changes, apply immediately and are recorded.",
  fields: Object.fromEntries(
    domains.options.map((entity) => [entity, Object.keys(shape[entity].shape)])
  ),
  examples: {
    collection: { name: "Demo API" },
    request: {
      name: "Get users",
      collectionID: "<collection ID>",
      protocol: "rest",
      method: "GET",
      endpoint: "https://example.com/users",
    },
    environment: {
      name: "Local",
      variables: [{ key: "baseURL", initialValue: "http://127.0.0.1:8080" }],
    },
    documentation: {
      title: "API documentation",
      collectionID: "<collection ID>",
    },
    automation: {
      name: "Smoke tests",
      collectionID: "<collection ID>",
      config: { iterations: 2 },
    },
    load_test: {
      name: "Latency test",
      requestID: "<REST request ID>",
      config: { mode: "requests", requests: 20, concurrency: 2 },
    },
    websocket: { name: "Local WS", url: "ws://127.0.0.1:8080" },
  },
}

const privateKeys =
  /^(auth|authorization|localAccessKey|accessKey|body|responses|preRequestScript|testScript|initialValue|currentValue|value|password|token|secretKey)$/i
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      (key === "endpoint" || key === "url") && typeof child === "string"
        ? child.replace(/^(\w+:\/\/)[^/]*@/, "$1").split(/[?#]/, 1)[0]
        : privateKeys.test(key) && child !== null && child !== ""
          ? "[REDACTED]"
          : redact(child),
    ])
  )
}

export function newConfigID(entity: Domain) {
  return entity === "collection"
    ? generateUniqueRefId("coll")
    : entity === "request"
      ? generateUniqueRefId("req")
      : crypto.randomUUID()
}

export function validatePortablePlan(
  entity: "automation" | "load_test" | "websocket",
  input: Record<string, unknown>
) {
  const { id: _id, revision: _revision, ...data } = input
  return shape[entity].parse(data)
}

function editableData(change: Change, before: Config | undefined) {
  const schema = shape[change.entity]
  const data = schema.partial().parse(change.data)
  const baseline = Object.fromEntries(
    Object.entries(before ?? {}).filter(([field]) =>
      Object.hasOwn(schema.shape, field)
    )
  )
  const merged: Record<string, unknown> = { ...baseline, ...data }
  if (change.entity === "environment" && !Object.hasOwn(data, "variables"))
    delete merged.variables
  if (
    "config" in data &&
    data.config &&
    typeof data.config === "object" &&
    baseline.config
  ) {
    merged.config = { ...Object(baseline.config), ...data.config }
  }
  return schema.parse(merged) as Record<string, unknown>
}

function requestValue(
  before: Config | undefined,
  after: Config
): WorkbenchRequest {
  const protocol = after.protocol ?? before?.protocol ?? "rest"
  const defaults =
    protocol === "graphql" ? getDefaultGQLRequest() : getDefaultRESTRequest()
  const {
    id,
    protocol: _protocol,
    collectionID: _collection,
    ...fields
  } = after
  const input = {
    ...defaults,
    ...before,
    ...fields,
    id: before?.id === before?._ref_id ? undefined : before?.id,
    _ref_id: before?._ref_id ?? id,
  }
  const result =
    protocol === "graphql"
      ? HoppGQLRequest.safeParse(input)
      : HoppRESTRequest.safeParse(input)
  if (result.type !== "ok") throw new Error("Invalid API request fields")
  return result.value
}

export async function prepareChange(change: Change, before?: Config) {
  if (change.operation !== "create" && !before)
    throw new Error("Configuration does not exist")
  if (change.operation === "delete") return undefined
  const data = editableData(change, before)
  if (change.entity === "request") {
    if (before && data.protocol !== before.protocol)
      throw new Error("The request protocol cannot change")
    if (typeof data.collectionID !== "string")
      throw new Error("A request requires a collectionID")
    findFolder(activeTree(), data.collectionID)
    if (before && data.collectionID !== before.collectionID)
      throw new Error("The request cannot move in an update")
    requestValue(before, { ...data, id: change.id })
  }
  if (change.entity === "collection" && data.parentID) {
    findFolder(activeTree(), String(data.parentID))
    if (before && data.parentID !== before.parentID)
      throw new Error("The collection cannot move in an update")
  }
  if (["documentation", "automation"].includes(change.entity)) {
    findFolder(activeTree(), String(data.collectionID ?? before?.collectionID))
  }
  if (change.entity === "load_test") {
    const request = (await configurations("request")).find(
      ({ id }) => id === data.requestID
    )
    if (!request || request.data.protocol !== "rest")
      throw new Error("A load test requires an HTTP request")
  }
  if (
    data.environmentID &&
    !environmentsStore.value.environments.some(
      (env) => env.id === data.environmentID
    )
  ) {
    throw new Error("Environment does not exist")
  }
  return { ...data, id: change.id }
}

async function applyTree(
  change: Change,
  before: Config | undefined,
  after: Config | undefined
) {
  const tree: HoppCollection[] = JSON.parse(JSON.stringify(activeTree()))
  if (change.entity === "collection") {
    const parentID = before?.parentID ?? after?.parentID
    const container =
      typeof parentID === "string" ? findFolder(tree, parentID).folders : tree
    const index = container.findIndex((folder) => uid(folder) === change.id)
    if (change.operation === "delete") {
      if (index < 0) throw new Error("Collection disappeared")
      container.splice(index, 1)
    } else if (after) {
      const collection =
        index >= 0
          ? container[index]
          : makeCollection({
              name: String(after.name),
              _ref_id: change.id,
              folders: [],
              requests: [],
              auth: { authType: "inherit", authActive: true },
              headers: [],
              variables: [],
              description: null,
              preRequestScript: "",
              testScript: "",
            })
      const { id: _id, parentID: _parent, ...fields } = after
      const parsed = HoppCollection.safeParse({ ...collection, ...fields })
      if (parsed.type !== "ok") throw new Error("Invalid collection fields")
      if (index < 0) container.push(parsed.value)
      else container[index] = parsed.value
    }
  } else {
    const folder = findFolder(
      tree,
      String(before?.collectionID ?? after?.collectionID)
    )
    const index = folder.requests.findIndex(
      (request) => uid(request) === change.id
    )
    if (change.operation === "delete") {
      if (index < 0) throw new Error("Request disappeared")
      folder.requests.splice(index, 1)
    } else if (after) {
      const value = requestValue(before, after)
      if (index < 0) folder.requests.push(value)
      else folder.requests[index] = value
    }
  }
  await writeLocal(STORE_KEYS.REST_COLLECTIONS, tree)
  setRESTCollections(tree)
}

function markdown(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "")
}

function documentationSnapshot(
  title: string,
  description: string,
  collectionID: string
) {
  const sections = [`# ${markdown(title)}`, description]
  scanTree([findFolder(activeTree(), collectionID)], (folder) => {
    sections.push(`## ${markdown(folder.name)}`, folder.description ?? "")
    for (const request of folder.requests) {
      const endpoint = "url" in request ? request.url : request.endpoint
      const path =
        endpoint.replace(/^\w+:\/\/[^/]+/, "").split(/[?#]/, 1)[0] || "/"
      const method = "method" in request ? request.method : "GraphQL"
      sections.push(
        `### ${markdown(request.name)}`,
        `${method} ${markdown(path)}`,
        request.description ?? ""
      )
    }
  })
  // 发布快照只包含接口描述和去掉主机、查询参数后的路径。
  return sections.filter(Boolean).join("\n\n")
}

export async function publishedDocumentation(id: string) {
  const document = (await configurations("documentation")).find(
    (item) => item.id === id
  )
  if (!document || typeof document.data.snapshot !== "string")
    throw new Error("Documentation not found")
  return document.data.snapshot
}

export async function applyConfig(
  change: Change,
  before: Config | undefined,
  after: Config | undefined
) {
  const { entity, operation, id } = change
  if (entity === "collection" || entity === "request")
    return applyTree(change, before, after)
  if (entity === "environment") {
    const index = environmentsStore.value.environments.findIndex(
      (env) => env.id === id
    )
    const secrets = getService(SecretEnvironmentService)
    const currentValues = getService(CurrentValueService)
    if (!after) {
      deleteEnvironment(index, id)
      secrets.deleteSecretEnvironment(id)
      currentValues.deleteEnvironment(id)
    } else {
      const variables = (after.variables ??
        before?.variables ??
        []) as EnvironmentVariable[]
      const parsed = Environment.safeParse({
        id,
        v: 2,
        name: after.name,
        variables: stripClientLocalValuesForWire(variables),
      })
      if (parsed.type !== "ok") throw new Error("Invalid environment fields")
      if (after.variables) populateLocalStoresFromVariables(id, variables)
      if (index === -1) appendEnvironments([parsed.value])
      else updateEnvironment(index, parsed.value)
    }
    await Promise.all([
      writeLocal(STORE_KEYS.ENVIRONMENTS, environmentsStore.value.environments),
      writeLocal(
        STORE_KEYS.SECRET_ENVIRONMENTS,
        secrets.persistableSecretEnvironments.value
      ),
      writeLocal(
        STORE_KEYS.CURRENT_ENVIRONMENT_VALUE,
        currentValues.persistableEnvironments.value
      ),
    ])
    return
  }
  const list = ((await readLocal<Config[]>(key(entity))) ?? []).filter(
    (item) => item.id !== id
  )
  const saved =
    after && entity === "documentation"
      ? {
          ...after,
          snapshot: documentationSnapshot(
            String(after.title),
            String(after.description ?? ""),
            String(after.collectionID)
          ),
        }
      : after
  await writeLocal(key(entity), saved ? [...list, saved] : list)
}
