<template>
  <HoppButtonSecondary
    v-if="folderOnly"
    :icon="IconPlus"
    :label="t('collection.new')"
    @click="emit('new-folder')"
  />
  <tippy
    v-else
    interactive
    trigger="click"
    theme="popover"
    :class="{ '!flex-none': compact }"
  >
    <HoppButtonSecondary
      :icon="IconPlus"
      :label="compact ? undefined : t('action.new')"
      :aria-label="t('action.new')"
      :title="t('action.new')"
      :class="{ '!px-2 !text-accent hover:!text-accentDark': compact }"
    />
    <template #content="{ hide }">
      <div class="flex min-w-48 flex-col" @click="hide()">
        <HoppSmartItem
          :icon="IconGlobe"
          :label="`HTTP ${t('request.new')}`"
          @click="newRequest('request')"
        />
        <HoppSmartItem
          :icon="IconGraphql"
          :label="`GraphQL ${t('request.new')}`"
          @click="newRequest('gql-request')"
        />
        <HoppSmartItem
          :icon="IconFolderPlus"
          :label="t('collection.new')"
          @click="emit('new-folder')"
        />
        <HoppSmartItem
          :icon="IconTerminal"
          :label="t('shortcut.request.import_curl')"
          @click="openWorkbenchCurlImport(router)"
        />
      </div>
    </template>
  </tippy>
</template>

<script setup lang="ts">
import { nextTick } from "vue";
import { useRouter } from "vue-router";
import { useService } from "dioc/vue";
import { useI18n } from "~/composables/i18n";
import { getDefaultRESTRequest } from "~/helpers/rest/default";
import { getDefaultGQLRequest } from "@apirequest/data";
import { openWorkbenchCurlImport } from "~/helpers/workbench";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
import IconPlus from "~icons/lucide/plus";
import IconGlobe from "~icons/lucide/globe";
import IconGraphql from "~icons/hopp/graphql";
import IconFolderPlus from "~icons/lucide/folder-plus";
import IconTerminal from "~icons/lucide/terminal";

defineProps<{ folderOnly?: boolean; compact?: boolean }>()
const emit = defineEmits<{ (event: "new-folder"): void }>()
const t = useI18n()
const router = useRouter()
const tabs = useService(WorkspaceTabsService)

const newRequest = async (type: "request" | "gql-request") => {
  // 保存弹窗复用目录树，但不应创建标签或切换页面；该入口只在正常目录中展示。
  if (router.currentRoute.value.path !== "/") await router.push("/")
  await nextTick()
  const tab = tabs.createNewTab(
    type === "request"
      ? { type, request: getDefaultRESTRequest(), isDirty: false }
      : {
          type,
          request: getDefaultGQLRequest(),
          isDirty: false,
          cursorPosition: 0,
        }
  )
  tabs.setActiveTab(tab.id)
}
</script>
