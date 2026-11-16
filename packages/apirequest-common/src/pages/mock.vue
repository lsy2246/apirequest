<template>
  <WorkbenchPage>
    <header class="workbench-page-header">
      <div>
        <h1 class="text-xl font-semibold text-secondaryDark">
          {{ t("workbench.mock") }}
        </h1>
        <p class="mt-2 text-secondaryLight">
          {{ t("mock_list.description") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <WorkbenchToggle
          :on="isMockServerVisible"
          @change="isMockServerVisible = !isMockServerVisible"
        >
          {{ t("workbench.enable_mock_management") }}
        </WorkbenchToggle>
      </div>
    </header>
    <div
      v-if="!isMockServerVisible"
      class="rounded-lg border border-divider bg-primary p-6 text-secondaryLight"
      role="status"
    >
      {{ t("workbench.mock_management_disabled") }}
    </div>
    <div
      v-else-if="!currentUser && !nativeWorkbench"
      class="flex min-h-64 flex-col items-center justify-center rounded-lg border border-divider bg-primary p-8"
    >
      <IconServer class="mb-4 h-12 w-12 text-secondaryLight" />
      <p class="mb-4 text-secondaryLight">{{ t("workbench.mock_login") }}</p>
      <HoppButtonPrimary
        :label="t('workbench.reconnect_local')"
        @click="invokeAction('workspace.reconnect')"
      />
    </div>
    <MockRuleWorkbench v-else />
  </WorkbenchPage>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { provideWorkbenchLive } from "~/composables/workbenchLive"
import WorkbenchPage from "~/components/workbench/Page.vue"
import MockRuleWorkbench from "~/components/mockServer/RuleWorkbench.vue"
import { useI18n } from "~/composables/i18n"
import { useMockServerVisibility } from "~/composables/mockServerVisibility"
import { useReadonlyStream } from "~/composables/stream"
import { invokeAction } from "~/helpers/actions"
import { platform } from "~/platform"
import IconServer from "~icons/lucide/server"
provideWorkbenchLive()
const t = useI18n()
const { isMockServerVisible } = useMockServerVisibility()
const nativeWorkbench = window.__APIREQUEST_NATIVE__ === true
const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)
</script>
