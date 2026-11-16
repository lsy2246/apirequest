import { describe, expect, it } from "vitest"
import { runnerEnvironmentLabel } from "../environment"
describe("automation environment label", () => {
  it("shows none for no selected environment and the previous Global marker", () => {
    expect(runnerEnvironmentLabel(undefined, null, "无")).toBe("无")
    expect(runnerEnvironmentLabel("Global", undefined, "无")).toBe("无")
    expect(runnerEnvironmentLabel(undefined, undefined, "None")).toBe("None")
  })
  it("preserves named environments, including one actually named Global", () => {
    expect(runnerEnvironmentLabel("Development", "env-dev", "无")).toBe(
      "Development"
    )
    expect(runnerEnvironmentLabel("Global", "env-global", "无")).toBe("Global")
    expect(runnerEnvironmentLabel("—", undefined, "无")).toBe("—")
  })
})
