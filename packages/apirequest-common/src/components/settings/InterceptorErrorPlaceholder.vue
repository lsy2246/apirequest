<template>
  <HoppSmartPlaceholder
    :src="`/images/states/${colorMode.value}/upload_error.svg`"
    :alt="t('error.network_fail')"
    :heading="t('error.network_fail')"
    :text="t('helpers.network_fail')"
  />
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n";
import { useColorMode } from "@composables/theming";

// 请求错误沿用通用展示，不再注入已移除的扩展服务或提供安装入口。
const colorMode = useColorMode()
const t = useI18n()
</script>
