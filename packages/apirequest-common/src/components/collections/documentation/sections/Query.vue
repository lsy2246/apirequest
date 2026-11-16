<template>
  <div v-if="query" class="w-full space-y-2">
    <h2
      class="text-sm font-semibold text-secondaryDark flex items-end justify-between px-4 p-2 border-b border-divider"
    >
      <span>{{ t("documentation.query.title") }}</span>
      <HoppSmartItem
        :icon="copied ? IconCheck : IconCopy"
        :title="t('documentation.copy_to_clipboard')"
        @click="copyToClipboard"
      />
    </h2>
    <div class="px-4 py-2">
      <pre
        class="bg-primaryLight p-3 rounded my-2 overflow-auto max-h-96 text-xs font-mono text-secondaryLight whitespace-pre"
        >{{ query }}</pre>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useClipboard } from "~/composables/clipboard"
import IconCopy from "~icons/lucide/copy"
import IconCheck from "~icons/lucide/check"
import { useI18n } from "~/composables/i18n"

const { copy: copyText, copied } = useClipboard()
const t = useI18n()

const props = defineProps<{
  query?: string
}>()

const copyToClipboard = () => {
  if (props.query !== undefined) return copyText(props.query)
}
</script>
