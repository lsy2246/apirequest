<template>
  <div class="space-y-2">
    <div
      class="flex min-w-0 flex-wrap items-center gap-3 rounded border border-dashed border-divider bg-primaryLight p-3 focus-within:ring-2 focus-within:ring-accent"
    >
      <IconFile class="shrink-0 text-secondaryLight" />
      <span class="min-w-0 flex-1 break-all text-secondaryDark">{{
        file?.name || t("request_case.file_empty")
      }}</span>
      <label :for="id" class="case-add shrink-0 cursor-pointer">{{
        reading
          ? t("state.loading")
          : file
            ? t("request_case.replace_file")
            : t("action.choose_file")
      }}</label>
      <input
        :id="id"
        type="file"
        class="sr-only"
        :aria-label="t('request_case.file')"
        :disabled="reading"
        @change="select"
      />
    </div>
    <p v-if="error" role="alert" class="text-tiny text-red-500">{{ error }}</p>
    <p class="text-tiny text-secondaryLight">
      {{ t("request_case.file_limit") }}
    </p>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "~/composables/i18n";
import { readCaseFile, type CaseFile } from "~/helpers/request-cases/model";
import IconFile from "~icons/lucide/file";
const file = defineModel<CaseFile>()
const emit = defineEmits<{ busy: [boolean] }>()
const id = `case-file-${crypto.randomUUID()}`
const t = useI18n(),
  reading = ref(false),
  error = ref("")
async function select(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  if (!selected) return
  reading.value = true
  emit("busy", true)
  error.value = ""
  try {
    file.value = await readCaseFile(selected)
  } catch (e) {
    error.value = t(
      `request_case.${(e as Error).message === "case_file_too_large" ? "file_too_large" : "file_failed"}`
    )
  } finally {
    reading.value = false
    emit("busy", false)
    input.value = ""
  }
}
</script>
