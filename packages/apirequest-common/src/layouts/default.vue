<template>
  <div class="api-workbench flex h-screen w-screen">
    <WorkbenchDataSyncAuto
      v-if="!localConnectionBlocked && isLocalWorkbench()"
    />
    <Splitpanes class="no-splitter" :dbl-click-splitter="false" horizontal>
      <Pane v-if="bannerContent" style="height: auto">
        <AppBanner :banner="bannerContent" @dismiss="dismissBanner" />
      </Pane>
      <Pane :class="spacerClass" class="flex flex-1 !overflow-hidden md:mb-0">
        <Splitpanes
          class="no-splitter min-w-0 flex-1"
          :dbl-click-splitter="false"
          :horizontal="!mdAndLarger"
        >
          <Pane
            style="width: auto; height: auto"
            class="hidden !overflow-auto md:flex md:flex-col"
          >
            <AppSidenav />
          </Pane>
          <Pane class="flex flex-1 !overflow-auto">
            <Splitpanes
              class="no-splitter"
              :dbl-click-splitter="false"
              horizontal
            >
              <Pane class="flex flex-1 !overflow-hidden">
                <main
                  class="workbench-main flex min-h-0 min-w-0 w-full flex-1 overflow-hidden"
                  role="main"
                >
                  <div
                    v-if="localConnectionBlocked"
                    class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-secondaryLight"
                  >
                    <HoppSmartSpinner v-if="localState === 'initializing'" />
                    <h2 class="font-semibold text-secondaryDark">
                      {{
                        t(
                          localState === "initializing"
                            ? "workbench.connecting_local"
                            : "workbench.local_unavailable"
                        )
                      }}
                    </h2>
                    <p>{{ t("workbench.local_connection_description") }}</p>
                    <HoppButtonPrimary
                      v-if="localState === 'unavailable'"
                      :label="t('workbench.reconnect_local')"
                      @click="platform.auth.performAuthInit()"
                    />
                  </div>
                  <RouterView
                    v-else
                    v-slot="{ Component }"
                    class="flex min-w-0 flex-1"
                  >
                    <Transition name="fade" mode="out-in" appear>
                      <component :is="Component" />
                    </Transition>
                  </RouterView>
                  <!-- 环境编辑动作由同一个实例处理，切换页面时仍可从请求中打开编辑弹窗。 -->
                  <Teleport
                    v-if="!localConnectionBlocked"
                    :to="environmentManagerTarget ?? 'body'"
                    :disabled="!environmentManagerTarget"
                  >
                    <div v-show="environmentManagerTarget">
                      <Environments />
                    </div>
                  </Teleport>
                </main>
              </Pane>
            </Splitpanes>
          </Pane>
        </Splitpanes>
        <AichatAssistant v-if="hasAIChat" />
      </Pane>
      <Pane
        v-if="!mdAndLarger"
        style="height: auto"
        class="fixed inset-x-0 bottom-0 z-10 flex flex-col !overflow-auto"
      >
        <AppSidenav />
      </Pane>
    </Splitpanes>
    <AppActionHandler />
    <AppSpotlight :show="showSearch" @hide-modal="showSearch = false" />

    <!-- Let additional stuff be registered -->
    <template
      v-for="(component, index) in rootExtensionComponents"
      :key="index"
    >
      <component :is="component" />
    </template>
  </div>
</template>

<script setup lang="ts">
import WorkbenchDataSyncAuto from "~/components/workbench/DataSyncAuto.vue";
import { useSetting } from "@composables/settings";
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
import { useService } from "dioc/vue";
import { Pane, Splitpanes } from "splitpanes";
import "splitpanes/dist/splitpanes.css"
import { computed, onBeforeMount, provide, ref, shallowRef, watch } from "vue";
import { RouterView, useRouter } from "vue-router";

import { environmentManagerTargetKey } from "~/composables/environmentManagerTarget";
import { useI18n } from "~/composables/i18n";
import { InvocationTriggers, defineActionHandler } from "~/helpers/actions";
import { hookKeybindingsListener } from "~/helpers/keybindings";
import { applySetting, toggleSetting } from "~/newstore/settings";
import { isLocalWorkbench, platform } from "~/platform";
import { HoppSpotlightSessionEventData } from "~/platform/analytics";
import { BannerService } from "~/services/banner.service";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
import { SpotlightService } from "~/services/spotlight";
import { UIExtensionService } from "~/services/ui-extension.service";

const router = useRouter()
const environmentManagerTarget = shallowRef<HTMLElement | null>(null)
provide(environmentManagerTargetKey, environmentManagerTarget)
// 顶栏移除后，实例公告仍由布局持有，避免丢失独立于导航的通知。
const banner = useService(BannerService)
const bannerContent = computed(() => banner.content.value?.content)
const dismissBanner = () => {
  if (banner.content.value) banner.removeBanner(banner.content.value.id)
}
const localState = computed(() => platform.auth.localSessionState?.value)
const localConnectionBlocked = computed(
  () =>
    localState.value === "initializing" || localState.value === "unavailable"
)

const showSearch = ref(false)

const expandNavigation = useSetting("EXPAND_NAVIGATION")
const columnLayout = useSetting("COLUMN_LAYOUT")

const breakpoints = useBreakpoints(breakpointsTailwind)
const mdAndLarger = breakpoints.greaterOrEqual("md")

const t = useI18n()

const spotlightService = useService(SpotlightService)
const uiExtensionService = useService(UIExtensionService)

const rootExtensionComponents = uiExtensionService.rootUIExtensionComponents

const HAS_OPENED_SPOTLIGHT = useSetting("HAS_OPENED_SPOTLIGHT")

// Fixed per platform; a platform that can't chat skips the assistant entirely.
const hasAIChat = !!platform.experiments?.aiExperiments?.chat

onBeforeMount(() => {
  if (!mdAndLarger.value) {
    columnLayout.value = true
  }
})

watch(mdAndLarger, (wide) => {
  if (!wide) columnLayout.value = true
})
const spacerClass = computed(() => {
  // 单人工作台的窄屏导航高度固定，内容区按实际高度预留空间。
  if (isLocalWorkbench()) return "mb-[54px]"
  return expandNavigation.value ? "spacer-small" : "spacer-expand"
})

defineActionHandler("modals.search.toggle", (_, trigger) => {
  const triggerMethodMap: Record<
    InvocationTriggers,
    HoppSpotlightSessionEventData["method"]
  > = {
    keypress: "keyboard-shortcut",
    mouseclick: "click-spotlight-bar",
  }
  spotlightService.setAnalyticsData({
    method: triggerMethodMap[trigger as InvocationTriggers],
  })

  showSearch.value = !showSearch.value
  !HAS_OPENED_SPOTLIGHT.value && toggleSetting("HAS_OPENED_SPOTLIGHT")
})

defineActionHandler("navigation.jump.rest", () => {
  router.push({ path: "/" })
})

const requestTabs = useService(WorkspaceTabsService)
defineActionHandler("navigation.jump.graphql", () => {
  requestTabs.focusRequestProtocol("graphql")
  router.push("/")
})

defineActionHandler("navigation.jump.realtime", async () => {
  await requestTabs.openWebSocketTab()
  await router.push("/")
})

defineActionHandler("navigation.jump.settings", () => {
  router.push({ path: "/settings" })
})

defineActionHandler("settings.theme.system", () => {
  applySetting("BG_COLOR", "system")
})

defineActionHandler("settings.theme.light", () => {
  applySetting("BG_COLOR", "light")
})

defineActionHandler("settings.theme.dark", () => {
  applySetting("BG_COLOR", "dark")
})

defineActionHandler("settings.theme.black", () => {
  applySetting("BG_COLOR", "black")
})

hookKeybindingsListener()
</script>

<style lang="scss" scoped>
.spacer-small {
  margin-bottom: 4.2rem;
}

.spacer-medium {
  margin-bottom: 4.8rem;
}

.spacer-large {
  margin-bottom: 5.5rem;
}

.spacer-expand {
  margin-bottom: 2.9rem;
}

@media screen and (min-width: 768px) {
  .spacer-small {
    margin-bottom: 0;
  }

  .spacer-medium {
    margin-bottom: 0;
  }

  .spacer-large {
    margin-bottom: 0;
  }

  .spacer-expand {
    margin-bottom: 0;
  }
}
</style>
