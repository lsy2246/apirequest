<template>
  <HoppButtonSecondary
    v-if="isLocalWorkbench()"
    v-tippy="{ theme: 'tooltip' }"
    :icon="IconPanelLeft"
    :title="t(sidebar ? 'hide.collection' : 'show.collection')"
    :aria-label="t(sidebar ? 'hide.collection' : 'show.collection')"
    :aria-expanded="sidebar"
    class="shrink-0 !rounded-none border-r border-dividerLight"
    @click="sidebar = !sidebar"
  />
</template>

<script setup lang="ts">
import IconPanelLeft from "~icons/lucide/panel-left";
import { useI18n } from "@composables/i18n";
import { useSetting } from "@composables/settings";
import { isLocalWorkbench } from "~/platform";

const t = useI18n()
const sidebar = useSetting("SIDEBAR")
</script>
