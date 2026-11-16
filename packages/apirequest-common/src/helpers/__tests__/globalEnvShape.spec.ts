import { describe, expect, it } from "vitest"
import { parseGlobalEnvironment } from "../globalEnvShape"
describe("parseGlobalEnvironment", () => {
  it("accepts the current wrapper", () => {
    expect(parseGlobalEnvironment({ v: 2, variables: [] })).toEqual({
      v: 2,
      variables: [],
    })
  })
  it.each([[], null, undefined, { v: 1, variables: [] }, { variables: [] }])(
    "rejects unsupported data shapes",
    (value) => {
      expect(() => parseGlobalEnvironment(value)).toThrow()
    }
  )
})
