<template>
  <section class="space-y-4" data-testid="workspace-backup">
    <p class="text-secondaryLight">
      {{
        t(
          mode === "export"
            ? "workbench.workspace_backup_description"
            : "workbench.workspace_restore_description"
        )
      }}
    </p>
    <div class="flex flex-wrap gap-3">
      <HoppButtonPrimary
        v-if="mode === 'export'"
        :label="t('workbench.workspace_backup_action')"
        :disabled="busy || disabled"
        :loading="operation === 'export'"
        :aria-busy="operation === 'export'"
        @click="backup(false)"
      />
      <HoppButtonPrimary
        v-else
        :label="t('workbench.workspace_restore_action')"
        :disabled="busy || disabled"
        :loading="operation === 'restore'"
        :aria-busy="operation === 'restore'"
        @click="confirm = true"
      />
    </div>
    <p v-if="busy" role="status" class="mt-3 text-secondary">
      {{ t("state.loading") }}
    </p>
    <p v-if="error" role="alert" class="mt-3 text-red-500">
      {{ error }}
    </p>
    <p v-if="savedPath" role="status" class="mt-3 break-all text-secondary">
      {{ savedPath }}
    </p>
    <HoppSmartConfirmModal
      :show="confirm"
      :title="t('workbench.workspace_restore_confirm')"
      @hide-modal="confirm = false"
      @resolve="restore"
    />
  </section>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core"
import { computed, ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"

const props = defineProps<{ mode: "export" | "restore"; disabled?: boolean }>()
const emit = defineEmits<{ busyChange: [busy: boolean] }>()
const t = useI18n()
const toast = useToast()
const operation = ref<"export" | "restore" | null>(null)
const busy = computed(() => operation.value !== null)
watch(busy, (value) => emit("busyChange", value), { flush: "sync" })
const error = ref("")
const confirm = ref(false)
const savedPath = ref("")

function restore() {
  confirm.value = false
  void backup(true)
}

async function backup(restore: boolean) {
  if (busy.value || props.disabled) return
  operation.value = restore ? "restore" : "export"
  error.value = ""
  savedPath.value = ""
  try {
    const path = await invoke<string | null>("workbench_backup", { restore })
    if (path) {
      savedPath.value = path
      toast.success(t("workbench.backup_completed"))
    }
  } catch {
    error.value = t("workbench.backup_failed")
  } finally {
    operation.value = null
  }
}
</script>
