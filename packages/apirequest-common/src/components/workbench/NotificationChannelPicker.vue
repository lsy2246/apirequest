<template>
  <div class="space-y-2" data-testid="notification-channel-picker">
    <p class="text-xs text-secondaryLight">
      {{ t("automation_webhook.select_channels") }}
    </p>
    <p v-if="loading" class="text-xs" role="status">{{ t("state.loading") }}</p>
    <template v-else>
      <label
        v-for="channel in channels"
        :key="channel.id"
        class="flex items-center gap-2 text-sm"
      >
        <input
          type="checkbox"
          class="accent-accent"
          :checked="selected.includes(channel.id)"
          :disabled="!channel.enabled && !selected.includes(channel.id)"
          :aria-label="channel.name"
          @change="
            toggle(channel.id, ($event.target as HTMLInputElement).checked)
          "
        />
        <span class="break-words">{{ channel.name }}</span
        ><span class="text-xs text-secondaryLight"
          >{{
            channel.format === "feishu"
              ? t("automation_webhook.feishu")
              : "Webhook"
          }}<template v-if="!channel.enabled">
            · {{ t("automation_webhook.channel_disabled") }}</template
          ></span
        >
      </label>
      <p v-if="!channels.length && !error" class="text-xs text-secondaryLight">
        {{ t("automation_webhook.no_channels") }}
      </p>
      <p v-if="missing.length" class="text-xs text-red-500">
        {{ t("automation_webhook.missing_channels") }}
      </p>
      <HoppButtonSecondary
        v-if="missing.length"
        :label="t('automation_webhook.remove_missing')"
        @click="
          emit(
            'update:modelValue',
            selected.filter((id) => !missing.includes(id))
          )
        "
      />
    </template>
    <p v-if="error" role="alert" class="text-xs text-red-500">{{ error }}</p>
    <HoppButtonSecondary
      v-if="error"
      :label="t('action.retry')"
      @click="load"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import { workbenchMcpAPI } from "~/helpers/workbench-mcp"
import type { NotificationChannel } from "~/helpers/notification-channels"
const props = defineProps<{ modelValue?: string[] }>()
const emit = defineEmits<{ "update:modelValue": [string[]] }>()
const t = useI18n(),
  loading = ref(true),
  error = ref(""),
  channels = ref<NotificationChannel[]>([]),
  controller = new AbortController()
const selected = computed(() => props.modelValue ?? [])
const missing = computed(() =>
  selected.value.filter(
    (id) => !channels.value.some((channel) => channel.id === id)
  )
)
let pending: Promise<void>
async function fetchChannels() {
  loading.value = true
  error.value = ""
  try {
    channels.value = await workbenchMcpAPI<NotificationChannel[]>(
      "automation/notification-channels",
      undefined,
      controller.signal
    )
    if (props.modelValue === undefined)
      emit(
        "update:modelValue",
        channels.value
          .filter((channel) => channel.legacy)
          .map((channel) => channel.id)
      )
  } catch (failure) {
    if (!controller.signal.aborted) error.value = (failure as Error).message
  } finally {
    loading.value = false
  }
}
function load() {
  pending = fetchChannels()
  return pending
}
function toggle(id: string, checked: boolean) {
  emit(
    "update:modelValue",
    checked
      ? [...new Set([...selected.value, id])]
      : selected.value.filter((item) => item !== id)
  )
}
async function validate() {
  await pending
  return !error.value && !!selected.value.length && !missing.value.length
}
void load()
defineExpose({ validate })
onBeforeUnmount(() => controller.abort())
</script>
