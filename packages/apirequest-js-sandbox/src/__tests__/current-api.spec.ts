import { describe, expect, it } from "vitest"
import { runPreRequest, runTest } from "~/utils/test-helpers"

describe("current scripting API", () => {
  it("exposes hopp without retired namespace aliases", async () => {
    const result = await runPreRequest(`
      if (typeof pw !== "undefined" || typeof pm !== "undefined") throw new Error("retired alias");
      hopp.env.set("checked", "yes");
    `, { global: [], selected: [] })()
    expect(result._tag).toBe("Right")
    if(result._tag === "Right") expect(result.right.selected[0].currentValue).toBe("yes")
  })
  it("runs current assertions after a response", async () => {
    const result = await runTest(`hopp.test("response", () => hopp.expect(hopp.response.statusCode).toBe(200))`, { global: [], selected: [] })()
    expect(result._tag).toBe("Right")
    if(result._tag === "Right") expect(result.right[0].children[0].expectResults[0].status).toBe("pass")
  })
})
