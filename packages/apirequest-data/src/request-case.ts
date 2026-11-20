import { z } from "zod"
import { cloneDeep, isEqual, toPath } from "lodash"
import type { HoppRESTRequest } from "./rest"
import type { HoppGQLAuth } from "./graphql"
import { MAX_CASE_TIMEOUT_MS } from "./case-execution"

// Structural subset shared by the browser and background runners.
export type CaseInheritedProperty = {
  auth?: { inheritedAuth: HoppRESTRequest["auth"] | HoppGQLAuth }
  headers: { inheritedHeader: HoppRESTRequest["headers"][number] }[]
}

export const CASE_FILE_LIMIT = 10 * 1024 * 1024
export const CaseFileSchema = z.object({
  name: z.string().min(1),
  contentType: z.string(),
  data: z.string(),
})
const PatchSchema = z.object({
  key: z.string(),
  value: z.string(),
  remove: z.boolean(),
})
export const AssertionSchema = z.object({
  id: z.string(),
  target: z.enum(["status", "json", "header", "body", "duration"]),
  path: z.string(),
  operator: z.enum([
    "eq",
    "ne",
    "contains",
    "exists",
    "not_exists",
    "lt",
    "lte",
    "gt",
    "gte",
  ]),
  expected: z.string(),
})
export const CaseBodySchema = z.object({
  mode: z.enum([
    "inherit",
    "none",
    "json",
    "text",
    "urlencoded",
    "multipart",
    "binary",
  ]),
  text: z.string(),
  fields: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      value: z.string(),
      kind: z.enum(["text", "file"]),
      file: CaseFileSchema.optional(),
    })
  ),
  file: CaseFileSchema.optional(),
})
const OverridesSchema = z.object({
  method: z.string(),
  endpoint: z.string(),
  params: z.array(PatchSchema),
  headers: z.array(PatchSchema),
  auth: z.enum(["inherit", "none", "bearer", "basic"]),
  token: z.string(),
  username: z.string(),
  password: z.string(),
  body: CaseBodySchema,
})
export const emptyOverrides = () => ({
  method: "",
  endpoint: "",
  params: [],
  headers: [],
  auth: "inherit" as const,
  token: "",
  username: "",
  password: "",
  body: { mode: "inherit" as const, text: "", fields: [] },
})
export const CaseSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    variables: z.record(z.string()),
    environmentID: z.string().nullable().optional(),
    timeoutMs: z.number().int().min(1).max(MAX_CASE_TIMEOUT_MS).optional(),
    expectedStatus: z.number().int().min(100).max(599).optional(),
    overrides: OverridesSchema.optional(),
    scripts: z.enum(["inherit", "disabled", "custom"]).optional(),
    preRequestScript: z.string().default(""),
    testScript: z.string().default(""),
    assertions: z.array(AssertionSchema).min(1).optional(),
  })
  .transform((entry) => ({
    ...entry,
    overrides: entry.overrides ?? emptyOverrides(),
    // 旧用例一直跳过脚本，迁移时保留原行为。
    scripts: entry.scripts ?? ("disabled" as const),
    assertions: entry.assertions ?? [
      {
        id: `${entry.id}-status`,
        target: "status" as const,
        path: "",
        operator: "eq" as const,
        expected: String(entry.expectedStatus ?? 200),
      },
    ],
  }))
export const CaseMapSchema = z.record(z.array(CaseSchema))
export type RequestCase = z.infer<typeof CaseSchema>
export type CaseMap = z.infer<typeof CaseMapSchema>
export type CaseAssertion = z.infer<typeof AssertionSchema>
export type CaseFile = z.infer<typeof CaseFileSchema>
export type CaseBody = z.infer<typeof CaseBodySchema>
export type CasePatch = z.infer<typeof PatchSchema>
export type CaseVariableChoice = {
  key: string
  source: string
  scope: "case" | "environment" | "global"
}

export function newRequestCase(): RequestCase {
  return CaseSchema.parse({
    id: crypto.randomUUID(),
    name: "New case",
    variables: {},
    scripts: "inherit",
  })
}

export function readCaseFile(file: File): Promise<CaseFile> {
  if (file.size > CASE_FILE_LIMIT)
    return Promise.reject(new Error("case_file_too_large"))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        name: file.name,
        contentType: file.type || "application/octet-stream",
        data: String(reader.result).split(",")[1],
      })
    reader.onerror = reader.onabort = () =>
      reject(new Error("case_file_failed"))
    reader.readAsDataURL(file)
  })
}
function restoreFile(file: CaseFile) {
  const raw = atob(file.data)
  return new File(
    [Uint8Array.from(raw, (character) => character.charCodeAt(0))],
    file.name,
    { type: file.contentType }
  )
}
export function caseBody(body: CaseBody): HoppRESTRequest["body"] | undefined {
  switch (body.mode) {
    case "inherit":
      return undefined
    case "none":
      return { contentType: null, body: null }
    case "binary":
      if (!body.file) throw new Error("case_file_required")
      return {
        contentType: "application/octet-stream",
        body: restoreFile(body.file),
      }
    case "multipart":
      return {
        contentType: "multipart/form-data",
        body: body.fields
          .filter((field) => field.key.trim())
          .map((field) => {
            if (field.kind === "file") {
              if (!field.file) throw new Error("case_file_required")
              return {
                key: field.key,
                value: [restoreFile(field.file)],
                isFile: true as const,
                active: true,
              }
            }
            return {
              key: field.key,
              value: field.value,
              isFile: false as const,
              active: true,
            }
          }),
      }
    default:
      return {
        contentType:
          body.mode === "json"
            ? "application/json"
            : body.mode === "urlencoded"
              ? "application/x-www-form-urlencoded"
              : "text/plain",
        body: body.text,
      }
  }
}
function patchEntries<
  T extends { key: string; value: string; active: boolean },
>(entries: T[], patches: CasePatch[], ignoreCase = false) {
  const key = (value: string) => (ignoreCase ? value.toLowerCase() : value)
  const edited = new Set(
    patches.filter((p) => p.key.trim()).map((p) => key(p.key))
  )
  return [
    ...entries.filter((entry) => !edited.has(key(entry.key))),
    ...patches
      .filter((p) => p.key.trim() && !p.remove)
      .map((p) => ({
        key: p.key,
        value: p.value,
        active: true,
        description: "",
      })),
  ]
}
export function buildCaseRequest(
  base: HoppRESTRequest,
  entry: RequestCase,
  inherited?: CaseInheritedProperty
): HoppRESTRequest {
  const request = cloneDeep(base)
  const overrides = entry.overrides
  request.endpoint = overrides.endpoint.trim() || request.endpoint
  request.method = overrides.method || request.method
  // URL 中已有的查询参数也参加覆盖和删除，不能仅修改 params 表格。
  const queryIndex = request.endpoint.indexOf("?")
  let inlineParams: {
    key: string
    value: string
    active: boolean
    description: string
  }[] = []
  if (queryIndex >= 0 && overrides.params.some((p) => p.key.trim())) {
    const hashIndex = request.endpoint.indexOf("#", queryIndex)
    const query = request.endpoint.slice(
      queryIndex + 1,
      hashIndex < 0 ? undefined : hashIndex
    )
    inlineParams = Array.from(new URLSearchParams(query), ([key, value]) => ({
      key,
      value,
      active: true,
      description: "",
    }))
    request.endpoint =
      request.endpoint.slice(0, queryIndex) +
      (hashIndex < 0 ? "" : request.endpoint.slice(hashIndex))
  }
  request.params = patchEntries(
    [...inlineParams, ...request.params],
    overrides.params
  )
  request.headers = [
    ...(inherited?.headers.map((item) => cloneDeep(item.inheritedHeader)) ??
      []),
    ...request.headers,
  ]
  if (overrides.auth !== "inherit") {
    request.headers = request.headers.filter(
      (header) =>
        header.key.toLowerCase() !== "authorization" &&
        (overrides.auth !== "none" || header.key.toLowerCase() !== "cookie")
    )
    request.auth =
      overrides.auth === "bearer"
        ? { authType: "bearer", authActive: true, token: overrides.token }
        : overrides.auth === "basic"
          ? {
              authType: "basic",
              authActive: true,
              username: overrides.username,
              password: overrides.password,
            }
          : { authType: "none", authActive: false }
  } else if (request.auth.authType === "inherit" && request.auth.authActive) {
    request.auth = cloneDeep(
      inherited?.auth?.inheritedAuth ?? { authType: "none", authActive: false }
    ) as HoppRESTRequest["auth"]
  }
  request.headers = patchEntries(request.headers, overrides.headers, true)
  // 认证字段由用例的请求头控制，移除后不能被原接口的鉴权配置重新生成。
  const authHeaderName =
    request.auth.authType === "api-key" && request.auth.addTo === "HEADERS"
      ? request.auth.key.toLowerCase()
      : "authorization"
  if (
    overrides.headers.some(
      (header) => header.key.toLowerCase() === authHeaderName
    )
  )
    request.auth = { authType: "none", authActive: false }
  request.body = caseBody(overrides.body) ?? request.body
  if (overrides.body.mode !== "inherit") {
    const explicitContentType = overrides.headers.some(
      (header) => !header.remove && header.key.toLowerCase() === "content-type"
    )
    request.headers = request.headers.filter(
      (header) =>
        (header.key.toLowerCase() !== "content-type" || explicitContentType) &&
        header.key.toLowerCase() !== "content-length"
    )
  }
  request.requestVariables = [
    ...Object.entries(entry.variables).map(([key, value]) => ({
      key,
      value,
      active: true,
    })),
    ...request.requestVariables.filter(
      ({ key }) => !Object.hasOwn(entry.variables, key)
    ),
  ]
  if (entry.scripts === "disabled") {
    request.preRequestScript = ""
    request.testScript = ""
  }
  if (entry.scripts === "custom") {
    request.preRequestScript = entry.preRequestScript
    request.testScript = entry.testScript
  }
  return request
}

export type CaseResponse = {
  status: number
  headers: Record<string, string>
  body: string
  duration: number
}
export type AssertionResult = {
  assertion: CaseAssertion
  actual: unknown
  expected: unknown
  passed: boolean
  error?: string
}
export function expectedValue(assertion: CaseAssertion) {
  if (["exists", "not_exists"].includes(assertion.operator)) return undefined
  if (
    ["status", "duration"].includes(assertion.target) ||
    ["lt", "lte", "gt", "gte"].includes(assertion.operator)
  ) {
    const value = Number(assertion.expected)
    if (!assertion.expected.trim() || !Number.isFinite(value))
      throw new Error("case_numeric_expected")
    return value
  }
  if (assertion.target === "json") {
    try {
      return JSON.parse(assertion.expected)
    } catch {
      return assertion.expected
    }
  }
  return assertion.expected
}
export function evaluateAssertions(
  assertions: CaseAssertion[],
  response: CaseResponse
): AssertionResult[] {
  let json: unknown
  let validJSON = true
  try {
    json = JSON.parse(response.body)
  } catch {
    validJSON = false
  }
  return assertions.map((assertion) => {
    let actual: unknown,
      exists = true
    try {
      const expected = expectedValue(assertion)
      if (assertion.target === "json") {
        if (!validJSON)
          return {
            assertion,
            actual: undefined,
            expected,
            passed: false,
            error: "case_invalid_json_response",
          }
        const path = assertion.path.trim().replace(/^\$\.?/, "")
        actual = json
        for (const key of path ? toPath(path) : []) {
          if (
            actual === null ||
            typeof actual !== "object" ||
            !Object.hasOwn(actual, key)
          ) {
            exists = false
            actual = undefined
            break
          }
          actual = (actual as Record<string, unknown>)[key]
        }
      } else if (assertion.target === "header") {
        const key = Object.keys(response.headers).find(
          (key) => key.toLowerCase() === assertion.path.trim().toLowerCase()
        )
        exists = key !== undefined
        actual = key === undefined ? undefined : response.headers[key]
      } else actual = response[assertion.target]
      let passed = false
      switch (assertion.operator) {
        case "exists":
          passed = exists
          break
        case "not_exists":
          passed = !exists
          break
        case "eq":
          passed = exists && isEqual(actual, expected)
          break
        case "ne":
          passed = exists && !isEqual(actual, expected)
          break
        case "contains":
          passed =
            exists &&
            (typeof actual === "string"
              ? actual.includes(String(expected))
              : Array.isArray(actual) &&
                actual.some((item) => isEqual(item, expected)))
          break
        default:
          if (
            exists &&
            typeof actual === "number" &&
            typeof expected === "number"
          ) {
            passed =
              assertion.operator === "lt"
                ? actual < expected
                : assertion.operator === "lte"
                  ? actual <= expected
                  : assertion.operator === "gt"
                    ? actual > expected
                    : actual >= expected
          }
      }
      return { assertion, actual, expected, passed }
    } catch (error) {
      return {
        assertion,
        actual,
        expected: assertion.expected,
        passed: false,
        error: (error as Error).message,
      }
    }
  })
}
