<template>
  <div class="min-w-0">
    <h4 v-if="label" class="mb-2 text-tiny font-medium text-secondaryLight">
      {{ label }}
    </h4>
    <pre class="log-payload">{{ formatted }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "~/composables/i18n"

const props = defineProps<{ label?: string; value?: unknown }>()
const t = useI18n()
const formatted = computed(() => {
  let value = props.value
  if (value === null || value === undefined || value === "")
    return t("mock_tools.empty_body")
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
})
</script>

<style scoped>
.log-payload {
  @apply m-0 min-w-0 w-full max-w-full rounded border border-divider bg-primaryLight p-3 font-mono text-tiny text-secondaryDark;
  max-height: 18rem;
  overflow: auto;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  white-space: break-spaces;
  word-break: break-all;
  text-overflow: clip;
  line-height: 1.6;
  user-select: text;
}
</style>
