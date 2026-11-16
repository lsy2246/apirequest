import { z } from "zod"
import { cloneDeep } from "lodash-es"

export const kinds = [
  "collection",
  "request",
  "environment",
  "mock",
  "automation",
  "load_test",
  "websocket",
  "preference",
  "capture",
] as const
export const EntrySchema = z
  .object({
    id: z.string().min(1).max(512),
    kind: z.enum(kinds),
    name: z.string().max(1000),
    parent: z.string().optional(),
    dependencies: z.array(z.string()).default([]),
    data: z.record(z.unknown()),
    omitted: z.array(z.array(z.union([z.string(), z.number()]))).default([]),
    deleted: z.boolean().optional(),
  })
  .strict()
export type Entry = z.infer<typeof EntrySchema>
export const PackageSchema = z
  .object({
    format: z.literal("apirequest.config"),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    entries: z.array(EntrySchema).max(20000),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const ids = new Set<string>()
    for (const entry of pack.entries) {
      if (ids.has(entry.id))
        ctx.addIssue({ code: "custom", message: "配置 ID 重复" })
      ids.add(entry.id)
      if (!entry.id.startsWith(`${entry.kind}:`))
        ctx.addIssue({ code: "custom", message: "配置类型与 ID 不匹配" })
    }
  })
export type ConfigPackage = z.infer<typeof PackageSchema>
export const makePackage = (entries: Entry[]): ConfigPackage => ({
  format: "apirequest.config",
  version: 1,
  createdAt: new Date().toISOString(),
  entries,
})
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024

export function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`
  return JSON.stringify(value)
}
export async function fingerprint(entry: Entry | undefined) {
  if (!entry) return "missing"
  const value = {
    kind: entry.kind,
    name: entry.name,
    parent: entry.parent,
    data: entry.data,
    deleted: entry.deleted || undefined,
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value))
  )
  return Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, "0")
  ).join("")
}
export function withDependencies(entries: Entry[], selected: string[]) {
  const lookup = new Map(entries.map((entry) => [entry.id, entry]))
  const result = new Set(selected)
  const visit = (id: string, visiting = new Set<string>()) => {
    if (visiting.has(id)) throw new Error("配置依赖存在循环")
    visiting.add(id)
    for (const dep of lookup.get(id)?.dependencies ?? []) {
      if (lookup.has(dep)) {
        result.add(dep)
        visit(dep, new Set(visiting))
      }
    }
  }
  selected.forEach((id) => visit(id))
  return entries.filter((entry) => result.has(entry.id))
}

/** Either side can introduce dependencies (for example, an environment used by a new case). */
export function mergeCatalog(local: Entry[], remote: Entry[]) {
  const other = new Map(remote.map((entry) => [entry.id, entry]))
  return [
    ...local.map((entry) => ({
      ...entry,
      dependencies: [
        ...new Set([
          ...entry.dependencies,
          ...(other.get(entry.id)?.dependencies ?? []),
        ]),
      ],
    })),
    ...remote.filter((entry) => !local.some((item) => item.id === entry.id)),
  ]
}

// 被省略的敏感字段在导入时保留本机值，不能用空字符串清掉凭证。
export function restoreOmitted(incoming: Entry, local?: Entry): Entry {
  const result = cloneDeep(incoming)
  for (const path of incoming.omitted) {
    if (
      path.some((part) =>
        ["__proto__", "constructor", "prototype"].includes(String(part))
      )
    )
      throw new Error("非法字段路径")
    let target: any = result.data,
      source: any = local?.data,
      owner: any,
      ownerKey: string | number | undefined
    for (const part of path.slice(0, -1)) {
      owner = target
      ownerKey = part
      const item = target?.[part]
      if (
        Array.isArray(target) &&
        Array.isArray(source) &&
        item &&
        typeof item === "object"
      ) {
        const match = ["key", "id", "name"].find(
          (key) => typeof item[key] === "string"
        )
        source =
          Array.isArray(item) && typeof item[0] === "string"
            ? source.find(
                (candidate) =>
                  Array.isArray(candidate) && candidate[0] === item[0]
              )
            : typeof item.entry?.id === "string"
              ? source.find(
                  (candidate) => candidate?.entry?.id === item.entry.id
                )
              : match
                ? source.find((candidate) => candidate?.[match] === item[match])
                : source[part as number]
      } else source = source?.[part]
      target = item
    }
    const key = path.at(-1)
    if (
      key === "data" &&
      typeof target?.name === "string" &&
      typeof target?.contentType === "string" &&
      source?.data === undefined
    ) {
      if (incoming.kind === "mock" || incoming.kind === "capture")
        throw new Error(
          `“${incoming.name}”缺少响应文件，请勾选文件附件后重新导入或同步`
        )
      if (owner && ownerKey !== undefined) delete owner[ownerKey]
      continue
    }
    if (target && key !== undefined && source?.[key] !== undefined)
      target[key] = cloneDeep(source[key])
  }
  return result
}
export function sanitizeEntry(
  entry: Entry,
  sensitive: boolean,
  attachments: boolean
): Entry {
  if (entry.kind === "capture" && !attachments && entry.id !== "capture:rules")
    throw new Error("配置包缺少抓包正文或附件，请重新导出包含完整文件的配置包")
  const result = cloneDeep(entry)
  const walk = (value: any, path: (string | number)[] = []) => {
    if (!value || typeof value !== "object") return
    // Capture stores HTTP headers as [name, value] pairs.
    if (
      !sensitive &&
      Array.isArray(value) &&
      value.length === 2 &&
      /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(
        String(value[0])
      ) &&
      typeof value[1] === "string"
    ) {
      value[1] = ""
      result.omitted.push([...path, 1])
      return
    }
    for (const key of Object.keys(value)) {
      const next = [...path, Array.isArray(value) ? Number(key) : key]
      const credential =
        /^(password|token|accessToken|refreshToken|clientSecret|secretKey|apiKey|passphrase|PROXY_KEY)$/i.test(
          key
        ) ||
        ((value.secret === true ||
          /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(
            String(value.key ?? "")
          )) &&
          /^(value|initialValue|currentValue)$/.test(key)) ||
        (value.authType === "api-key" && key === "value")
      if (!sensitive && credential && typeof value[key] === "string") {
        value[key] = ""
        result.omitted.push(next)
      } else if (
        !attachments &&
        key === "data" &&
        typeof value.name === "string" &&
        typeof value.contentType === "string" &&
        typeof value.data === "string"
      ) {
        value.data = ""
        result.omitted.push(next)
      } else walk(value[key], next)
    }
  }
  walk(result.data)
  result.omitted = [
    ...new Map(
      result.omitted.map((path) => [JSON.stringify(path), path])
    ).values(),
  ]
  return result
}

export type SyncRow = {
  id: string
  local?: Entry
  remote?: Entry
  status: "same" | "upload" | "download" | "conflict"
  choice?: "local" | "remote" | "skip" | "both"
}
export async function compare(
  local: Entry[],
  remote: Entry[],
  selected: string[],
  baseline: Record<string, string> = {}
): Promise<SyncRow[]> {
  const a = new Map(local.map((e) => [e.id, e])),
    b = new Map(remote.map((e) => [e.id, e]))
  return Promise.all(
    [...new Set(selected)].map(async (id) => {
      const l = a.get(id),
        r = b.get(id),
        lh = await fingerprint(l),
        rh = await fingerprint(r),
        base = baseline[id]
      let status: SyncRow["status"] = "same"
      if (lh !== rh) {
        if (!l || !r) status = base ? "conflict" : l ? "upload" : "download"
        else if (base && lh === base) status = "download"
        else if (base && rh === base) status = "upload"
        else status = "conflict"
      }
      return {
        id,
        local: l,
        remote: r,
        status,
        choice:
          status === "upload"
            ? "local"
            : status === "download"
              ? "remote"
              : undefined,
      }
    })
  )
}

const b64 = (value: Uint8Array) => {
  let text = ""
  for (const byte of value) text += String.fromCharCode(byte)
  return btoa(text)
}
const unb64 = (value: string) =>
  Uint8Array.from(atob(value), (x) => x.charCodeAt(0))
async function key(password: string, salt: Uint8Array) {
  const raw = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt).buffer,
      iterations: 210000,
      hash: "SHA-256",
    },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}
export async function encodePackage(pack: ConfigPackage, password = "") {
  for (const entry of pack.entries.filter((e) => e.kind === "mock"))
    for (const path of entry.omitted) {
      let parent: any = entry.data
      for (const key of path.slice(0, -1)) parent = parent?.[key]
      if (
        path.at(-1) === "data" &&
        typeof parent?.name === "string" &&
        typeof parent?.contentType === "string"
      )
        throw new Error(
          `“${entry.name}”包含文件响应，请勾选文件附件或取消选择此 Mock`
        )
    }
  const hasRuntimeFile = (value: unknown): boolean => {
    if (typeof Blob !== "undefined" && value instanceof Blob) return true
    if (!value || typeof value !== "object") return false
    return Object.values(value).some(hasRuntimeFile)
  }
  for (const entry of pack.entries)
    if (hasRuntimeFile(entry.data))
      throw new Error(
        `“${entry.name}”包含临时上传文件，请先在接口用例中保存文件样本后再导出`
      )
  const text = JSON.stringify(PackageSchema.parse(pack))
  if (new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES)
    throw new Error("配置包超过 64 MB，请缩小范围或去掉文件附件")
  if (!password) return text
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt),
    new TextEncoder().encode(text)
  )
  return JSON.stringify({
    format: "apirequest.encrypted",
    version: 1,
    salt: b64(salt),
    iv: b64(iv),
    data: b64(new Uint8Array(data)),
  })
}
export async function decodePackage(
  text: string,
  password = ""
): Promise<ConfigPackage> {
  if (new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES * 1.4)
    throw new Error("配置包过大")
  let parsed: any
  const parseJSON = (value: string) => {
    try {
      return JSON.parse(value, (key, item) => {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error("配置包含有非法字段")
        return item
      })
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error("配置包不是有效的 JSON 文件")
      throw error
    }
  }
  parsed = parseJSON(text)
  if (parsed?.format === "apirequest.encrypted") {
    if (!password) throw new Error("无法读取加密配置包，请使用未加密的配置包")
    if (parsed.version !== 1) throw new Error("不支持的加密配置包版本")
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(parsed.iv) },
        await key(password, unb64(parsed.salt)),
        unb64(parsed.data)
      )
      parsed = parseJSON(new TextDecoder().decode(plain))
    } catch {
      throw new Error("密码错误或配置包已损坏")
    }
  }
  if (parsed?.format !== "apirequest.config" || parsed.version !== 1)
    throw new Error("不支持的配置包格式或版本")
  const checked = PackageSchema.safeParse(parsed)
  if (!checked.success)
    throw new Error(
      `配置包字段无效：${checked.error.issues[0]?.path.join(".") || checked.error.issues[0]?.message}`
    )
  return checked.data
}
