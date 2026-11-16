import { describe, expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({
  current: {
    id: "debug",
    name: "Debug",
    v: 2,
    variables: [
      {
        key: "host",
        initialValue: "debug",
        currentValue: "debug",
        secret: false,
      },
    ],
  },
  selected: {
    id: "chosen",
    name: "Chosen",
    v: 2,
    variables: [
      { key: "host", initialValue: "initial", currentValue: "", secret: false },
      { key: "token", initialValue: "", currentValue: "", secret: true },
    ],
  },
}))
vi.mock("~/newstore/environments", () => ({
  environmentsStore: { value: { environments: [fixture.selected] } },
  getCurrentEnvironment: () => fixture.current,
}))
vi.mock("~/helpers/RequestRunner", () => ({
  captureInitialEnvironmentState: () => ({
    initialEnvs: {
      global: [
        {
          key: "global",
          initialValue: "global",
          currentValue: "global",
          secret: false,
        },
      ],
      selected: fixture.current.variables,
      temp: [{ key: "debug-only", currentValue: "value" }],
    },
  }),
}))
vi.mock("~/services/current-environment-value.service", () => ({
  CurrentValueService: class {},
}))
vi.mock("~/services/secret-environment.service", () => ({
  SecretEnvironmentService: class {},
}))
vi.mock("~/modules/dioc", () => ({
  getService: () => ({
    getEnvironmentVariableValue: () => "current",
    getSecretEnvironmentVariableValue: () => ({
      value: "secret-current",
      initialValue: "secret-initial",
    }),
  }),
}))
import { caseEnvironmentState } from "../environments"
describe("case environment selection", () => {
  it("uses and clones the current environment when inherited", () => {
    const state = caseEnvironmentState()
    expect(state.selected[0].currentValue).toBe("debug")
    state.selected[0].currentValue = "changed"
    expect(fixture.current.variables[0].currentValue).toBe("debug")
  })
  it("resolves current and secret values from a selected environment without switching debug state", () => {
    const state = caseEnvironmentState("chosen")
    expect(state.selected[0].currentValue).toBe("current")
    expect(state.selected[1].currentValue).toBe("secret-current")
    expect(state.global).toHaveLength(1)
    expect(state.temp).toEqual([])
    expect(fixture.current.id).toBe("debug")
    expect(fixture.selected.variables[1].currentValue).toBe("")
  })
  it("supports no selected environment and rejects deleted environments", () => {
    expect(caseEnvironmentState(null).selected).toEqual([])
    expect(() => caseEnvironmentState("deleted")).toThrow(
      "case_environment_missing"
    )
  })
})
