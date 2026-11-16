<template>
  <HoppSmartTabs
    v-if="isGQLTab"
    v-model="selectedTab"
    styles="sticky overflow-x-auto flex-shrink-0 bg-primary z-10 top-0"
    render-inactive-tabs
  >
    <HoppSmartTab
      id="collections"
      :icon="IconFolder"
      :label="t('tab.collections')"
    >
      <Collections />
    </HoppSmartTab>
    <HoppSmartTab
      id="docs"
      :icon="IconBookOpen"
      :label="t('tab.documentation')"
    >
      <GqlDocExplorer :key="activeGQLTabId" />
    </HoppSmartTab>
    <HoppSmartTab id="schema" :icon="IconBox" :label="t('tab.schema')">
      <GqlSchema :key="activeGQLTabId" />
    </HoppSmartTab>
  </HoppSmartTabs>
  <Collections v-else />
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { useService } from "dioc/vue"
import { useI18n } from "@composables/i18n"
import { GQLTabConnectionService } from "~/services/gql-tab-connection.service"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import IconBookOpen from "~icons/lucide/book-open"
import IconBox from "~icons/lucide/box"
import IconFolder from "~icons/lucide/folder"

const t = useI18n()
const tabs = useService(WorkspaceTabsService)
const activeGQLTabId = useService(GQLTabConnectionService).activeGQLTabId
const isGQLTab = computed(
  () => tabs.currentActiveTab.value?.document.type === "gql-request"
)
const selectedTab = ref("collections")
</script>
