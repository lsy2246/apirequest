<template>
  <div class="match-trace min-w-0 space-y-2">
    <article
      v-for="row in trace"
      :key="row.ruleID"
      class="min-w-0 rounded border border-divider p-3 text-tiny"
    >
      <p
        :class="
          row.matched && !row.reasons.length
            ? 'text-green-600'
            : 'text-secondaryDark'
        "
      >
        {{ row.name }} · {{ row.reasons.length ? "" : t("mock_tools.matched") }}
      </p>
      <div
        v-for="(reason, index) in row.reasons"
        :key="index"
        class="mt-1 break-all text-secondaryLight"
      >
        {{ reasonText(reason.code) }} <code>{{ reason.field }}</code
        ><span v-if="reason.expected !== undefined">
          · {{ display(reason.actual) }} → {{ display(reason.expected) }}</span
        >
      </div>
    </article>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from "~/composables/i18n"
import type { MockTrace } from "~/helpers/mockServer/rules"
defineProps<{ trace: MockTrace[] }>()
const t = useI18n()
function reasonText(code: string) {
  return t(`mock_tools.${code === "scenario" ? "scenario_reason" : code}`)
}
function display(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value)
}
</script>
<style scoped>
.match-trace {
  overflow-wrap: anywhere;
  user-select: text;
}
.match-trace code {
  white-space: pre-wrap;
}
</style>
