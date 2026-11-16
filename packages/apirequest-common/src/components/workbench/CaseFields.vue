<template>
  <div class="space-y-2">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="grid min-w-0 grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
    >
      <input
        v-model="row.key"
        :aria-label="`${label} ${index + 1} ${t('request_case.key')}`"
        :placeholder="t('request_case.key')"
        class="case-field min-w-0 w-full"
      />
      <CaseVariableInput
        v-model="row.value"
        :label="`${label} ${index + 1} ${t('request_case.value')}`"
        :variables="
          (variables || []).filter(
            (variable) => !excludeSelf || variable.key !== row.key
          )
        "
        :placeholder="
          row.remove ? t('request_case.remove_field') : t('request_case.value')
        "
        :disabled="row.remove"
      />
      <div class="flex items-center gap-2">
        <CaseSelect
          v-if="allowRemove"
          :model-value="row.remove ? 'remove' : 'set'"
          :options="operations"
          :label="`${label} ${index + 1} ${t('request_case.operation')}`"
          class="w-32"
          @update:model-value="row.remove = $event === 'remove'"
        />
        <button
          type="button"
          class="case-icon"
          :aria-label="`${t('action.delete')} ${label} ${index + 1}`"
          @click="rows.splice(index, 1)"
        >
          <IconTrash />
        </button>
      </div>
    </div>
    <button
      type="button"
      class="case-add"
      @click="rows.push({ key: '', value: '', remove: false })"
    >
      <IconPlus />{{ t("request_case.add_field") }}
    </button>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "~/composables/i18n";
import CaseSelect from "./Select.vue";
import CaseVariableInput from "./CaseVariableInput.vue";
import IconTrash from "~icons/lucide/trash-2";
import IconPlus from "~icons/lucide/plus";
import type { CasePatch, CaseVariableChoice } from "~/helpers/request-cases/model";
defineProps<{
  label: string
  allowRemove?: boolean
  variables?: CaseVariableChoice[]
  excludeSelf?: boolean
}>()
const rows = defineModel<CasePatch[]>({ required: true })
const t = useI18n()
const operations = computed(() => [
  { value: "set", label: t("request_case.set_field") },
  { value: "remove", label: t("request_case.remove_field") },
])
</script>
