import { describe, expect, it } from "vitest"
import {
  normalizeModules,
  selectModules,
  groupRows,
  resolveModuleConflicts,
} from "../modules"
import {
  sanitizeEntry,
  restoreOmitted,
  type Entry,
  type SyncRow,
} from "../model"
const entry = (id: string, dependencies: string[] = []): Entry => ({
  id,
  kind: id.split(":")[0] as Entry["kind"],
  name: id,
  dependencies,
  data: {},
  omitted: [],
})
describe("module-level data scope", () => {
  it("migrates old per-entry scopes and includes newly created records", () => {
    expect(
      normalizeModules([
        "request:a",
        "collection:b",
        "environment:old",
        "unknown",
      ])
    ).toEqual(["interfaces", "environments"])
    const entries = [
      entry("collection:b"),
      entry("request:new"),
      entry("environment:new"),
      entry("capture:rules"),
    ]
    expect(
      selectModules(entries, ["interfaces"]).map((item) => item.id)
    ).toEqual(["collection:b", "request:new"])
  })
  it("never exports an unchecked module via a dependency", () => {
    expect(
      selectModules(
        [
          entry("request:a", ["environment:secret"]),
          entry("environment:secret"),
        ],
        ["interfaces"]
      ).map((item) => item.id)
    ).toEqual(["request:a"])
  })
  it("groups previews and changes only conflicts when applying a module policy", () => {
    const rows: SyncRow[] = [
      {
        id: "request:a",
        local: entry("request:a"),
        remote: entry("request:a"),
        status: "conflict",
      },
      {
        id: "request:new",
        local: entry("request:new"),
        status: "upload",
        choice: "local",
      },
      {
        id: "environment:e",
        remote: entry("environment:e"),
        status: "download",
        choice: "remote",
      },
    ]
    const groups = groupRows(rows)
    expect(groups.map((group) => group.label)).toEqual(["接口", "环境"])
    resolveModuleConflicts(groups[0].rows, "remote")
    expect(rows.map((row) => row.choice)).toEqual(["remote", "local", "remote"])
  })
  it("redacts captured credentials and requires complete capture attachments", () => {
    const captured = {
      ...entry("capture:session-abc"),
      data: {
        entries: [
          {
            entry: {
              requestHeaders: [
                ["Authorization", "Bearer PRIVATE"],
                ["Accept", "application/json"],
              ],
            },
          },
        ],
      },
    }
    const redacted = sanitizeEntry(captured, false, true)
    expect(JSON.stringify(redacted)).not.toContain("PRIVATE")
    expect(JSON.stringify(redacted)).toContain("application/json")
    expect(() => sanitizeEntry(captured, false, false)).toThrow("抓包")
    expect(JSON.stringify(captured)).toContain("PRIVATE")
  })
  it("restores capture credentials by request identity and header name after reordering", () => {
    const source = {
      ...entry("capture:session-a"),
      data: {
        entries: [
          {
            entry: {
              id: "a",
              requestHeaders: [
                ["Authorization", "Bearer A"],
                ["Accept", "*/*"],
              ],
            },
          },
          {
            entry: { id: "b", requestHeaders: [["Authorization", "Bearer B"]] },
          },
        ],
      },
    }
    const redacted = sanitizeEntry(source, false, true)
    const local = structuredClone(source)
    local.data.entries.reverse()
    local.data.entries[1].entry.requestHeaders.reverse()
    const restored = restoreOmitted(redacted, local)
    expect(
      (restored.data.entries as typeof source.data.entries)[0].entry
        .requestHeaders[0][1]
    ).toBe("Bearer A")
    expect(
      (restored.data.entries as typeof source.data.entries)[1].entry
        .requestHeaders[0][1]
    ).toBe("Bearer B")
  })
})
