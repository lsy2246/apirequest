<template>
  <WorkbenchPage>
    <header class="workbench-page-header">
      <h1 class="text-xl font-semibold text-secondaryDark">
        {{ t("settings.access_tokens") }}
      </h1>
    </header>
    <section class="workbench-panel"><AccessTokensPanel /></section>
  </WorkbenchPage>
</template>

<script setup lang="ts">
import AccessTokensPanel from "~/components/accessTokens/index.vue"
import WorkbenchPage from "~/components/workbench/Page.vue"
import { useI18n } from "~/composables/i18n"
const t = useI18n()
</script>
