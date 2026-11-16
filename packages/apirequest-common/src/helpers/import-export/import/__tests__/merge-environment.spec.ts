import { describe, expect, it } from "vitest"
import { mergeEnvironmentVariables } from "../merge-environment"

const variable = (key: string, initialValue: string, secret = false) => ({
  key,
  initialValue,
  currentValue: "",
  secret,
})

describe("import into an existing environment", () => {
  it("updates matching keys and appends new keys without removing other variables", () => {
    const existing = [variable("keep", "local"), variable("update", "old")]
    const incoming = [variable("update", "new"), variable("add", "added")]
    const result = mergeEnvironmentVariables(existing, incoming)
    expect(result.map(({ key, initialValue }) => [key, initialValue])).toEqual([
      ["keep", "local"],
      ["update", "new"],
      ["add", "added"],
    ])
    expect(result[1].currentValue).toBe("new")
    expect(existing[1].initialValue).toBe("old")
    expect(incoming[0].currentValue).toBe("")
  })

  it("keeps existing local secret values when an export omits them", () => {
    const secret = {
      ...variable("token", "local-secret", true),
      currentValue: "current-secret",
    }
    expect(
      mergeEnvironmentVariables([secret], [variable("token", "", true)])
    ).toEqual([secret])
  })

  it("imports new secret values and deliberate empty non-secret defaults", () => {
    expect(
      mergeEnvironmentVariables(
        [variable("clear", "old")],
        [variable("token", "imported-secret", true), variable("clear", "")]
      )
    ).toEqual([
      variable("clear", ""),
      {
        ...variable("token", "imported-secret", true),
        currentValue: "imported-secret",
      },
    ])
  })

  it("uses the final value if an imported key appears more than once", () => {
    const result = mergeEnvironmentVariables(
      [],
      [variable("key", "one"), variable("key", "two")]
    )
    expect(result).toHaveLength(1)
    expect(result[0].initialValue).toBe("two")
  })
})
