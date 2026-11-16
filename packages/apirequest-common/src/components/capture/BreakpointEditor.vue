<template>
  <div class="space-y-2 rounded border border-amber-500 p-3">
    <p class="font-semibold text-accent">
      {{ t("workbench_capture.paused") }} ·
      {{ t(`workbench_capture.${phase}`) }}
    </p>
    <label v-if="phase === 'response'" class="block"
      >{{ t("workbench_capture.status")
      }}<input
        v-model.number="status"
        type="number"
        min="200"
        max="599"
        class="ml-2 rounded border border-divider bg-primary p-1"
    /></label>
    <label v-else class="block"
      >URL<input
        v-model="url"
        class="mt-1 w-full rounded border border-divider bg-primary p-2"
    /></label>
    <div v-for="(header, index) in headers" :key="index" class="flex gap-2">
      <input
        v-model="header[0]"
        :placeholder="t('workbench_capture.header_name')"
        class="min-w-0 flex-1 rounded border border-divider bg-primary p-1"
      /><input
        v-model="header[1]"
        :placeholder="t('workbench_capture.header_value')"
        class="min-w-0 flex-1 rounded border border-divider bg-primary p-1"
      /><button
        :aria-label="t('action.delete')"
        @click="headers.splice(index, 1)"
      >
        ×
      </button>
    </div>
    <HoppButtonSecondary
      :label="t('workbench_capture.add_header')"
      @click="headers.push(['', ''])"
    />
    <WorkbenchToggle class="flex items-center gap-2" v-model="replaceBody">{{
      t("workbench_capture.replace_body")
    }}</WorkbenchToggle>
    <textarea
      v-if="replaceBody"
      v-model="body"
      rows="4"
      :aria-label="t('workbench_capture.replace_body')"
      class="w-full rounded border border-divider bg-primary p-2 font-mono"
    />
    <HoppButtonPrimary
      :label="t('workbench_capture.resume')"
      :disabled="busy"
      @click="submit"
    />
  </div>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { ref } from "vue";
import { useI18n } from "~/composables/i18n";
const props = defineProps<{
  phase: "request" | "response"
  originalURL: string
  originalStatus?: number
  busy: boolean
}>()
const emit = defineEmits<{ (e: "resume", patch: object): void }>()
const t = useI18n(),
  url = ref(props.originalURL),
  status = ref(props.originalStatus ?? 200),
  replaceBody = ref(false),
  body = ref(""),
  headers = ref<[string, string][]>([])
function submit() {
  emit("resume", {
    ...(props.phase === "request"
      ? { url: url.value }
      : { status: status.value }),
    headers: Object.fromEntries(headers.value.filter(([key]) => key.trim())),
    ...(replaceBody.value ? { body: body.value } : {}),
  })
}
</script>
