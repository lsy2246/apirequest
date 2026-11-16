import { beforeEach, describe, expect, it, vi } from "vitest"
import { settingsSyncDefinition } from "../sync"
import {
  applySetting,
  bulkApplySettings,
  getDefaultSettings,
} from "~/newstore/settings"

const mocks = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock("../api", () => ({ updateUserSettings: mocks.update }))

beforeEach(() => {
  vi.clearAllMocks()
  bulkApplySettings(getDefaultSettings())
})

describe("device history recording preference", () => {
  it("does not update shared settings when the current device pauses recording", () => {
    applySetting("RECORD_HISTORY", false)
    settingsSyncDefinition.applySetting!({
      settingKey: "RECORD_HISTORY",
      value: false,
    })
    settingsSyncDefinition.toggleSetting!({ settingKey: "RECORD_HISTORY" })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("excludes the device preference when other settings are synchronized", () => {
    applySetting("RECORD_HISTORY", false)
    applySetting("BG_COLOR", "dark")
    settingsSyncDefinition.applySetting!({
      settingKey: "BG_COLOR",
      value: "dark",
    })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const shared = JSON.parse(mocks.update.mock.calls[0][0])
    expect(shared.BG_COLOR).toBe("dark")
    expect(shared).not.toHaveProperty("RECORD_HISTORY")
  })
})
