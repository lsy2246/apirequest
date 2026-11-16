<template>
  <div class="space-y-3">
    <p class="text-tiny text-secondaryLight">
      {{ t("mock_tools.script_hint") }}
    </p>
    <label class="block"
      >JavaScript<textarea
        v-model="model.code"
        rows="12"
        spellcheck="false"
        class="mock-field mt-1 w-full font-mono"
      />
    </label>
    <label class="block"
      >{{ t("mock_tools.timeout")
      }}<input
        v-model.number="model.timeoutMs"
        type="number"
        min="10"
        max="5000"
        required
        class="mock-field mt-1 w-full"
    /></label>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from "~/composables/i18n"
const model = defineModel<{ code: string; timeoutMs: number }>({
  required: true,
})
const t = useI18n()
</script>
