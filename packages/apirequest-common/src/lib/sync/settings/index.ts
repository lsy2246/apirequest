import * as E from "fp-ts/Either"
import { runGQLSubscription } from "~/helpers/backend/GQLClient"
import { bulkApplySettings, getDefaultSettings } from "~/newstore/settings"
import { platform } from "~/platform"
import { SettingsPlatformDef } from "~/platform/settings"
import { runDispatchWithOutSyncing } from ".."
import {
  createUserSettings,
  getUserSettings,
  runUserSettingsUpdatedSubscription,
} from "./api"
import { settingsSyncer } from "./sync"

// 首次创建设置时，订阅缓存可能暂时只含记录 ID；缺少有效 JSON 时保留设备现有配置。
function applySyncedSettings(properties: unknown) {
  if (typeof properties !== "string") return
  try {
    const parsed = JSON.parse(properties)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
    // 侧栏开关属于当前浏览器的布局，保留已从本地加载的选择。
    delete parsed.RECORD_HISTORY
    delete parsed.SIDEBAR
    // 新版脚本沙盒已常驻，旧开关无需写回同步设置。
    delete parsed.EXPERIMENTAL_SCRIPTING_SANDBOX
    runDispatchWithOutSyncing(() => bulkApplySettings(parsed))
  } catch {
    console.error("Invalid synchronized workspace settings")
  }
}

function initSettingsSync() {
  const authEvents$ = platform.auth.getAuthEventsStream()
  const currentUser$ = platform.auth.getCurrentUserStream()
  settingsSyncer.startStoreSync()
  settingsSyncer.setupSubscriptions(setupSubscriptions)

  currentUser$.subscribe(async (user) => {
    if (user) {
      // load the settings
      loadUserSettings()
    }
  })

  authEvents$.subscribe((event) => {
    if (event.event == "login" || event.event == "token_refresh") {
      settingsSyncer.startListeningToSubscriptions()
    }

    if (event.event == "logout") {
      settingsSyncer.stopListeningToSubscriptions()
    }
  })
}

async function loadUserSettings() {
  const res = await getUserSettings()

  // create user settings if it doesn't exist
  if (E.isLeft(res) && res.left.error == "user_settings/not_found") {
    const createRes = await createUserSettings(
      JSON.stringify(getDefaultSettings())
    )

    if (E.isRight(createRes)) {
      applySyncedSettings(createRes.right.createUserSettings.properties)
    }
  } else if (E.isRight(res)) {
    applySyncedSettings(res.right.me.settings?.properties)
  }
}

function setupSubscriptions() {
  let subs: ReturnType<typeof runGQLSubscription>[1][] = []

  const userSettingsUpdatedSub = setupUserSettingsUpdatedSubscription()

  subs = [userSettingsUpdatedSub]

  return () => {
    subs.forEach((sub) => sub.unsubscribe())
  }
}

function setupUserSettingsUpdatedSubscription() {
  const [userSettingsUpdated$, userSettingsUpdatedSub] =
    runUserSettingsUpdatedSubscription()

  userSettingsUpdated$.subscribe((res) => {
    if (E.isRight(res)) {
      applySyncedSettings(res.right.userSettingsUpdated.properties)
    }
  })

  return userSettingsUpdatedSub
}

export const def: SettingsPlatformDef = {
  initSettingsSync,
}
