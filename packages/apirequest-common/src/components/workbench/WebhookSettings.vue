<template>
  <section class="workbench-panel p-5 sm:p-8" data-testid="webhook-settings">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="heading">{{ t("automation_webhook.settings_title") }}</h3>
      <HoppButtonSecondary
        v-if="!draft"
        :label="t('automation_webhook.add_channel')"
        :disabled="busy || loading || loadFailed"
        outline
        @click="edit()"
      />
    </div>
    <p class="mt-2 text-secondaryLight">
      {{ t("automation_webhook.settings_help") }}
    </p>
    <p v-if="loading" class="mt-4" role="status">{{ t("state.loading") }}</p>
    <template v-else-if="!loadFailed">
      <p v-if="!channels.length && !draft" class="mt-5 text-secondaryLight">
        {{ t("automation_webhook.no_channels") }}
      </p>
      <div class="mt-5 space-y-3" data-testid="notification-channel-list">
        <div
          v-for="channel in channels"
          :key="channel.id"
          class="rounded-lg border border-divider p-4"
          :data-channel-id="channel.id"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <strong class="break-words text-secondaryDark">{{
                channel.name
              }}</strong
              ><span class="ml-3 text-xs text-secondaryLight">{{
                channel.format === "feishu"
                  ? t("automation_webhook.feishu")
                  : "Webhook"
              }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <WorkbenchToggle
                :model-value="channel.enabled"
                :disabled="busy || !!draft"
                :aria-label="`${t('automation_webhook.channel_enabled')} · ${channel.name}`"
                @update:model-value="setEnabled(channel, $event)"
                >{{ t("automation_webhook.channel_enabled") }}</WorkbenchToggle
              >
              <HoppButtonSecondary
                :label="t('action.edit')"
                :aria-label="`${t('action.edit')} · ${channel.name}`"
                :disabled="busy || !!draft"
                @click="edit(channel)"
              />
              <HoppButtonSecondary
                :label="t('automation_webhook.test')"
                :aria-label="`${t('automation_webhook.test')} · ${channel.name}`"
                :disabled="busy || !!draft"
                @click="test(channel)"
              />
              <HoppButtonSecondary
                :label="t('action.delete')"
                :aria-label="`${t('action.delete')} · ${channel.name}`"
                :disabled="busy || !!draft"
                @click="deleteID = channel.id"
              />
            </div>
          </div>
          <div
            v-if="deleteID === channel.id"
            class="mt-3 space-y-3 border-t border-divider pt-3"
            role="alertdialog"
            :aria-label="t('automation_webhook.delete_channel')"
          >
            <p class="text-secondaryLight">
              {{ t("automation_webhook.delete_help") }}
            </p>
            <div class="flex gap-3">
              <HoppButtonSecondary
                :label="t('automation_webhook.confirm_delete')"
                :disabled="busy"
                @click="remove(channel.id)"
              /><HoppButtonSecondary
                :label="t('action.cancel')"
                :disabled="busy"
                @click="deleteID = ''"
              />
            </div>
          </div>
        </div>
      </div>
      <form
        v-if="draft"
        class="mt-5 max-w-2xl space-y-4 rounded-lg border border-divider p-4"
        @submit.prevent="save"
      >
        <h4 class="font-semibold text-secondaryDark">
          {{
            t(
              draft.id
                ? "automation_webhook.edit_channel"
                : "automation_webhook.add_channel"
            )
          }}
        </h4>
        <fieldset :disabled="busy" class="space-y-4">
          <label class="block space-y-2"
            ><span>{{ t("automation_webhook.channel_name") }}</span
            ><input
              v-model.trim="draft.name"
              class="input w-full"
              maxlength="100"
              required
          /></label>
          <label class="block space-y-2"
            ><span>{{ t("automation_webhook.format") }}</span
            ><WorkbenchSelect
              v-model="draft.format"
              :label="t('automation_webhook.format')"
              :options="[
                { value: 'json', label: 'Webhook' },
                { value: 'feishu', label: t('automation_webhook.feishu') },
              ]"
          /></label>
          <label class="block space-y-2"
            ><span>{{ t("automation_webhook.url") }}</span
            ><input
              v-model.trim="draft.url"
              type="url"
              class="input w-full"
              :placeholder="
                draft.format === 'feishu'
                  ? 'https://open.feishu.cn/open-apis/bot/v2/hook/…'
                  : 'https://example.com/webhook'
              "
              required
          /></label>
          <p class="text-xs text-secondaryLight">
            {{
              t(
                draft.format === "feishu"
                  ? "automation_webhook.format_feishu"
                  : "automation_webhook.format_json"
              )
            }}
          </p>
          <label class="block space-y-2"
            ><span>{{ t("automation_webhook.secret") }}</span
            ><input
              v-model="draft.secret"
              type="password"
              class="input w-full"
              autocomplete="new-password"
              :placeholder="
                draft.hasSecret
                  ? t('automation_webhook.secret_saved')
                  : t('automation_webhook.optional')
              "
          /></label>
          <p class="text-xs text-secondaryLight">
            {{
              t(
                draft.format === "feishu"
                  ? "automation_webhook.feishu_secret_help"
                  : "automation_webhook.secret_help"
              )
            }}
          </p>
          <WorkbenchToggle
            v-if="draft.hasSecret"
            v-model="draft.removeSecret"
            >{{ t("automation_webhook.remove_secret") }}</WorkbenchToggle
          >
          <WorkbenchToggle v-model="draft.enabled">{{
            t("automation_webhook.channel_enabled")
          }}</WorkbenchToggle>
        </fieldset>
        <div class="flex gap-3">
          <HoppButtonPrimary
            type="submit"
            :label="t('action.save')"
            :loading="busy"
            :disabled="busy"
          /><HoppButtonSecondary
            type="button"
            :label="t('action.cancel')"
            :disabled="busy"
            @click="draft = undefined"
          />
        </div>
      </form>
    </template>
    <p v-if="error" role="alert" class="mt-4 text-red-500">{{ error }}</p>
    <HoppButtonSecondary
      v-if="loadFailed"
      :label="t('action.retry')"
      @click="load"
    />
    <p v-if="message" role="status" class="mt-4 text-green-600">
      {{ message }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import { workbenchMcpAPI } from "~/helpers/workbench-mcp"
import type { NotificationChannel } from "~/helpers/notification-channels"
import WorkbenchToggle from "./Toggle.vue"
import WorkbenchSelect from "./Select.vue"
const t = useI18n(),
  loading = ref(true),
  busy = ref(false),
  loadFailed = ref(false),
  error = ref(""),
  message = ref(""),
  deleteID = ref("")
const channels = ref<NotificationChannel[]>([])
const draft = ref<{
  id?: string
  name: string
  format: "json" | "feishu"
  url: string
  secret: string
  hasSecret: boolean
  removeSecret: boolean
  enabled: boolean
}>()
const controller = new AbortController(),
  endpoint = "automation/notification-channels"
async function load() {
  loading.value = true
  loadFailed.value = false
  try {
    channels.value = await workbenchMcpAPI<NotificationChannel[]>(
      endpoint,
      undefined,
      controller.signal
    )
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = (failure as Error).message
      loadFailed.value = true
    }
  } finally {
    loading.value = false
  }
}
function edit(channel?: NotificationChannel) {
  error.value = message.value = deleteID.value = ""
  draft.value = {
    id: channel?.id,
    name: channel?.name ?? "",
    format: channel?.format ?? "json",
    url: channel?.url ?? "",
    enabled: channel?.enabled ?? true,
    hasSecret: channel?.hasSecret ?? false,
    secret: "",
    removeSecret: false,
  }
}
async function operation(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = message.value = ""
  try {
    await task()
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    busy.value = false
  }
}
async function save() {
  const value = draft.value
  if (!value) return
  await operation(async () => {
    await workbenchMcpAPI(
      value.id ? `${endpoint}/${encodeURIComponent(value.id)}` : endpoint,
      {
        name: value.name,
        format: value.format,
        url: value.url,
        enabled: value.enabled,
        ...(value.removeSecret
          ? { secret: "" }
          : value.secret
            ? { secret: value.secret }
            : {}),
      },
      controller.signal
    )
    draft.value = undefined
    await load()
    message.value = t("automation_webhook.saved")
  })
}
async function setEnabled(channel: NotificationChannel, enabled: boolean) {
  await operation(async () => {
    await workbenchMcpAPI(
      `${endpoint}/${encodeURIComponent(channel.id)}`,
      { enabled },
      controller.signal
    )
    await load()
  })
}
async function remove(id: string) {
  await operation(async () => {
    await workbenchMcpAPI(
      `${endpoint}/${encodeURIComponent(id)}/delete`,
      {},
      controller.signal
    )
    deleteID.value = ""
    await load()
  })
}
async function test(channel: NotificationChannel) {
  await operation(async () => {
    await workbenchMcpAPI(
      `${endpoint}/${encodeURIComponent(channel.id)}/test`,
      {},
      controller.signal
    )
    message.value = `${channel.name} · ${t(channel.format === "feishu" ? "automation_webhook.test_sent_feishu" : "automation_webhook.test_sent")}`
  })
}
void load()
onBeforeUnmount(() => controller.abort())
</script>
