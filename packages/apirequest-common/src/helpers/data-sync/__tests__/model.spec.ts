import { describe, it, expect, beforeAll } from "vitest"
import { webcrypto } from "node:crypto"
import { reactive } from "vue"
import {
  compare,
  decodePackage,
  encodePackage,
  fingerprint,
  makePackage,
  restoreOmitted,
  sanitizeEntry,
  withDependencies,
  type Entry,
} from "../model"
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: webcrypto.subtle,
    configurable: true,
  })
})
const entry = (id = "environment:dev", value = "one"): Entry => ({
  id,
  kind: "environment",
  name: "Dev",
  data: {
    variables: [
      { key: "token", secret: true, initialValue: value, currentValue: value },
    ],
  },
  dependencies: [],
  omitted: [],
})
describe("selective configuration packages", () => {
  it("requires missing Mock response files instead of serving empty placeholders", async () => {
    const source: Entry = {
      ...entry("mock:file"),
      kind: "mock",
      data: {
        file: { name: "a.txt", contentType: "text/plain", data: "ZmlsZQ==" },
      },
    }
    const omitted = sanitizeEntry(source, false, false)
    await expect(encodePackage(makePackage([omitted]))).rejects.toThrow(
      "勾选文件附件"
    )
    expect(() => restoreOmitted(omitted)).toThrow("缺少响应文件")
    expect(restoreOmitted(omitted, source).data).toEqual(source.data)
  })
  it("does not silently drop temporary runtime files", async () => {
    await expect(
      encodePackage(
        makePackage([{ ...entry(), data: { upload: new Blob(["binary"]) } }])
      )
    ).rejects.toThrow("临时上传文件")
  })
  it("preserves secrets by variable key when the imported order changes", () => {
    const original = entry()
    original.data.variables = [
      { key: "host", secret: false, initialValue: "server", currentValue: "" },
      {
        key: "token",
        secret: true,
        initialValue: "PRIVATE",
        currentValue: "PRIVATE",
      },
    ]
    const incoming = entry()
    const omitted = sanitizeEntry(incoming, false, true)
    expect(
      (restoreOmitted(omitted, original).data.variables as any[])[0]
        .initialValue
    ).toBe("PRIVATE")
  })
  it("round trips encrypted attachments and rejects a wrong password", async () => {
    const pack = makePackage([
      {
        ...entry(),
        data: {
          file: {
            name: "a.pdf",
            contentType: "application/pdf",
            data: "aGVsbG8=",
          },
        },
      },
    ])
    const encoded = await encodePackage(pack, "correct horse")
    expect(encoded).not.toContain("aGVsbG8=")
    expect(await decodePackage(encoded, "correct horse")).toEqual(pack)
    await expect(decodePackage(encoded, "wrong")).rejects.toThrow("密码错误")
  })
  it("rejects duplicate IDs and unsupported versions", async () => {
    await expect(
      decodePackage(JSON.stringify(makePackage([entry(), entry()])))
    ).rejects.toThrow()
    await expect(
      decodePackage(JSON.stringify({ ...makePackage([]), version: 99 }))
    ).rejects.toThrow()
  })
  it("includes selected dependencies without including unrelated requests", () => {
    const parent: Entry = { ...entry("collection:parent"), kind: "collection" },
      child: Entry = {
        ...entry("request:a"),
        kind: "request",
        dependencies: [parent.id],
      }
    const unrelated = { ...child, id: "request:b" }
    expect(
      withDependencies([parent, child, unrelated], [child.id]).map((e) => e.id)
    ).toEqual([parent.id, child.id])
  })
  it("redacts reactive values and restores omitted local secrets", () => {
    const source = reactive(entry()),
      redacted = sanitizeEntry(source, false, true)
    expect(redacted.data.variables).toEqual([
      { key: "token", secret: true, initialValue: "", currentValue: "" },
    ])
    const local = entry(undefined, "local-secret")
    expect(restoreOmitted(redacted, local).data).toEqual(local.data)
    expect(source.data).toEqual(entry().data)
  })
  it("omits file content while retaining file metadata", () => {
    const source = {
      ...entry(),
      data: {
        file: {
          name: "a.pdf",
          contentType: "application/pdf",
          data: "aGVsbG8=",
        },
      },
    }
    const result = sanitizeEntry(source, true, false)
    expect(result.data.file).toEqual({
      name: "a.pdf",
      contentType: "application/pdf",
      data: "",
    })
    expect(restoreOmitted(result, source).data).toEqual(source.data)
  })
  it("compares changes in both directions and stops concurrent edits", async () => {
    const original = entry(),
      base = { [original.id]: await fingerprint(original) }
    expect(
      (
        await compare(
          [entry(undefined, "local")],
          [original],
          [original.id],
          base
        )
      )[0].status
    ).toBe("upload")
    expect(
      (
        await compare(
          [original],
          [entry(undefined, "remote")],
          [original.id],
          base
        )
      )[0].status
    ).toBe("download")
    expect(
      (
        await compare(
          [entry(undefined, "local")],
          [entry(undefined, "remote")],
          [original.id],
          base
        )
      )[0].status
    ).toBe("conflict")
    expect((await compare([], [original], [original.id], base))[0].status).toBe(
      "conflict"
    )
  })
})
