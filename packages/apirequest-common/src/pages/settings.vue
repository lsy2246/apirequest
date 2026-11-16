<template>
  <WorkbenchPage>
    <header class="workbench-page-header">
      <h1 class="text-xl font-semibold text-secondaryDark">
        {{ t("navigation.settings") }}
      </h1>
    </header>
    <div class="workbench-settings-sections">
      <div class="workbench-settings-section md:grid md:grid-cols-3 md:gap-4">
        <div class="p-8 md:col-span-1">
          <h3 class="heading">
            {{ t("settings.general") }}
          </h3>
          <p class="my-1 text-secondaryLight">
            {{ t("settings.general_description") }}
          </p>
        </div>
        <div class="space-y-8 p-8 md:col-span-2">
          <section>
            <h4 class="font-semibold text-secondaryDark">
              {{ t("settings.language") }}
            </h4>
            <div class="mt-4">
              <SmartChangeLanguage />
            </div>
          </section>

          <section v-if="isLocalWorkbench()">
            <HoppButtonSecondary
              :label="t('app.keyboard_shortcuts')"
              :icon="IconKeyboard"
              outline
              @click="invokeAction('flyouts.keybinds.toggle')"
            />
          </section>

          <section>
            <div class="space-y-4">
              <div v-if="hasPlatformTelemetry" class="flex items-center">
                <WorkbenchToggle
                  :on="TELEMETRY_ENABLED"
                  @change="showConfirmModal"
                >
                  {{ t("settings.telemetry") }}
                </WorkbenchToggle>
              </div>
              <div v-if="!isLocalWorkbench()" class="flex items-center">
                <WorkbenchToggle
                  :on="EXPAND_NAVIGATION"
                  @change="toggleSetting('EXPAND_NAVIGATION')"
                >
                  {{ t("settings.expand_navigation") }}
                </WorkbenchToggle>
              </div>
              <div v-if="!isLocalWorkbench()" class="flex items-center">
                <WorkbenchToggle
                  :on="SIDEBAR_ON_LEFT"
                  @change="toggleSetting('SIDEBAR_ON_LEFT')"
                >
                  {{ t("settings.sidebar_on_left") }}
                </WorkbenchToggle>
              </div>
              <div v-if="hasAIExperimentsSupport" class="flex items-center">
                <WorkbenchToggle
                  :on="ENABLE_AI_EXPERIMENTS"
                  @change="toggleSetting('ENABLE_AI_EXPERIMENTS')"
                >
                  {{ t("settings.ai_experiments") }}
                </WorkbenchToggle>
              </div>
              <div v-if="hasAIRequestNaming" class="flex items-center">
                <div class="flex flex-col space-y-2 w-full">
                  <label class="text-secondaryLight">{{
                    t("settings.ai_request_naming_style")
                  }}</label>
                  <div class="flex flex-col space-y-4">
                    <div class="flex">
                      <WorkbenchSelect
                        v-model="AI_REQUEST_NAMING_STYLE"
                        :options="supportedNamingStyles"
                        :label="t('settings.ai_request_naming_style')"
                        class="w-full"
                      />
                    </div>
                    <div
                      v-if="AI_REQUEST_NAMING_STYLE === 'CUSTOM'"
                      class="flex"
                    >
                      <textarea
                        v-model="CUSTOM_NAMING_STYLE"
                        class="flex flex-1 bg-primaryLight px-4 py-2 rounded border border-dividerLight focus:border-divider transition resize-none"
                        :placeholder="
                          t(
                            'settings.ai_request_naming_style_custom_placeholder'
                          )
                        "
                        rows="4"
                      >
                      </textarea>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="!isLocalWorkbench()" class="flex items-center">
                <WorkbenchToggle
                  :on="ENABLE_GQL_IN_REST_WORKSPACE"
                  @change="toggleSetting('ENABLE_GQL_IN_REST_WORKSPACE')"
                >
                  {{ t("settings.enable_gql_in_rest_workspace") }}
                </WorkbenchToggle>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="workbench-settings-section md:grid md:grid-cols-3 md:gap-4">
        <div class="p-8 md:col-span-1">
          <h3 class="heading">
            {{ t("settings.theme") }}
          </h3>
          <p class="my-1 text-secondaryLight">
            {{ t("settings.theme_description") }}
          </p>
        </div>
        <div class="space-y-8 p-8 md:col-span-2">
          <SettingsWorkbenchNavigation v-if="isLocalWorkbench()" />
          <section>
            <h4 class="font-semibold text-secondaryDark">
              {{ t("settings.background") }}
            </h4>
            <div class="my-1 text-secondaryLight">
              {{ t(getColorModeName(colorMode.preference)) }}
              <span v-if="colorMode.preference === 'system'">
                ({{ t(getColorModeName(colorMode.value)) }})
              </span>
            </div>
            <div class="mt-4">
              <SmartColorModePicker />
            </div>
          </section>
          <section v-if="!isLocalWorkbench()">
            <h4 class="font-semibold text-secondaryDark">
              {{ t("settings.accent_color") }}
            </h4>
            <div class="my-1 text-secondaryLight">
              {{ ACCENT_COLOR.charAt(0).toUpperCase() + ACCENT_COLOR.slice(1) }}
            </div>
            <div class="mt-4">
              <SmartAccentModePicker />
            </div>
          </section>
        </div>
      </div>

      <template v-if="platform.ui?.additionalSettingsSections?.length">
        <template
          v-for="item in platform.ui?.additionalSettingsSections"
          :key="item.id"
        >
          <component :is="item" />
        </template>
      </template>
      <section v-if="!platform.localDesktop" class="workbench-panel p-8">
        <h3 class="heading">{{ t("settings.access_tokens") }}</h3>
        <p class="my-3 text-secondaryLight">
          {{ t("settings.access_tokens_description") }}
        </p>
        <HoppButtonSecondary
          to="/access-tokens"
          :label="t('settings.access_tokens')"
          outline
        />
      </section>
      <WorkbenchDataSync v-if="isLocalWorkbench()" />
    </div>
    <HoppSmartConfirmModal
      :show="confirmRemove"
      :title="`${t('confirm.remove_telemetry')} ${t(
        'settings.telemetry_helps_us'
      )}`"
      @hide-modal="confirmRemove = false"
      @resolve="
        () => {
          toggleSetting('TELEMETRY_ENABLED')
          confirmRemove = false
        }
      "
    />
  </WorkbenchPage>
</template>

<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import WorkbenchPage from "~/components/workbench/Page.vue"
import WorkbenchDataSync from "~/components/workbench/DataSync.vue"
import { ref, computed } from "vue"
import { toggleSetting } from "~/newstore/settings"
import { useSetting } from "@composables/settings"
import { useI18n } from "@composables/i18n"
import { useColorMode } from "@composables/theming"
import { usePageHead } from "@composables/head"
import { isLocalWorkbench, platform } from "~/platform"
import { invokeAction } from "@helpers/actions"
import SettingsWorkbenchNavigation from "~/components/settings/WorkbenchNavigation.vue"
import IconKeyboard from "~icons/lucide/keyboard"
import WorkbenchSelect from "~/components/workbench/Select.vue"
import {
  useAIExperiments,
  useAIExperimentsSupport,
} from "~/composables/ai-experiments"

const t = useI18n()
const colorMode = useColorMode()

usePageHead({
  title: computed(() => t("navigation.settings")),
})

const ACCENT_COLOR = useSetting("THEME_COLOR")
const TELEMETRY_ENABLED = useSetting("TELEMETRY_ENABLED")
const EXPAND_NAVIGATION = useSetting("EXPAND_NAVIGATION")
const SIDEBAR_ON_LEFT = useSetting("SIDEBAR_ON_LEFT")
const ENABLE_AI_EXPERIMENTS = useSetting("ENABLE_AI_EXPERIMENTS")
const AI_REQUEST_NAMING_STYLE = useSetting("AI_REQUEST_NAMING_STYLE")
const CUSTOM_NAMING_STYLE = useSetting("CUSTOM_NAMING_STYLE")

const ENABLE_GQL_IN_REST_WORKSPACE = useSetting("ENABLE_GQL_IN_REST_WORKSPACE")

const supportedNamingStyles = computed(() => [
  {
    value: "DESCRIPTIVE_WITH_SPACES" as const,
    label: t("settings.ai_request_naming_style_descriptive_with_spaces"),
  },
  {
    value: "camelCase" as const,
    label: t("settings.ai_request_naming_style_camel_case"),
  },
  {
    value: "snake_case" as const,
    label: t("settings.ai_request_naming_style_snake_case"),
  },
  {
    value: "PascalCase" as const,
    label: t("settings.ai_request_naming_style_pascal_case"),
  },
  {
    value: "CUSTOM" as const,
    label: t("settings.ai_request_naming_style_custom"),
  },
])

const hasPlatformTelemetry = Boolean(platform.platformFeatureFlags.hasTelemetry)

const confirmRemove = ref(false)

const hasAIExperimentsSupport = useAIExperimentsSupport()

// Shown wherever the generate-name button is: same capability, same gate.
const { shouldEnableAIFeatures: hasAIRequestNaming } = useAIExperiments(
  "generateRequestName"
)

const showConfirmModal = () => {
  if (TELEMETRY_ENABLED.value) confirmRemove.value = true
  else toggleSetting("TELEMETRY_ENABLED")
}

const getColorModeName = (colorMode: string) => {
  switch (colorMode) {
    case "system":
      return "settings.system_mode"
    case "light":
      return "settings.light_mode"
    case "dark":
      return "settings.dark_mode"
    case "black":
      return "settings.black_mode"
    default:
      return "settings.system_mode"
  }
}
</script>
