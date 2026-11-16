import { settingsStore } from "~/newstore/settings"
import { getSyncInitFunction, StoreSyncDefinitionOf } from ".."
import { updateUserSettings } from "./api"

function sharedSettings() {
  const { RECORD_HISTORY: _recordHistory, ...settings } = settingsStore.value
  return JSON.stringify(settings)
}

export const settingsSyncDefinition: StoreSyncDefinitionOf<
  typeof settingsStore
> = {
  toggleSetting({ settingKey }) {
    if (settingKey !== "RECORD_HISTORY") updateUserSettings(sharedSettings())
  },
  toggleNestedSetting() {
    updateUserSettings(sharedSettings())
  },
  applySetting({ settingKey }) {
    if (settingKey !== "RECORD_HISTORY") updateUserSettings(sharedSettings())
  },
  applyNestedSetting() {
    updateUserSettings(sharedSettings())
  },
}

export const settingsSyncer = getSyncInitFunction(
  settingsStore,
  settingsSyncDefinition,
  () => true
)
