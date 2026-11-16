<template>
  <div class="shrink-0">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <HoppButtonSecondary
        :label="t('history_results.cleanup')"
        :disabled="!policy"
        outline
        @click="showCleanup = true"
      />
    </div>
    <p v-if="error" role="alert" class="mt-2 text-red-500">
      {{ t("history_results.error") }}
      <button class="underline" @click="loadPolicy">
        {{ t("action.retry") }}
      </button>
    </p>

    <HoppSmartModal
      v-if="showCleanup && policy"
      dialog
      :title="t('history_results.cleanup')"
      styles="sm:max-w-xl"
      @close="showCleanup = false"
    >
      <template #body>
        <div class="flex flex-col gap-5">
          <section class="flex flex-col gap-3">
            <h3 class="font-semibold text-secondaryDark">
              {{ t("history_results.automatic") }}
            </h3>
            <div class="flex flex-wrap items-center gap-4">
              <WorkbenchToggle v-model="autoCleanup" :disabled="busy">
                {{ t("history_results.enable_auto") }}
              </WorkbenchToggle>
              <label class="flex items-center gap-2">
                {{ t("history_results.retention_days") }}
                <input
                  v-model.number="retentionDays"
                  type="number"
                  min="1"
                  max="36500"
                  list="history-retention-days"
                  class="w-20 rounded border border-divider bg-primary px-2 py-1"
                />
              </label>
              <datalist id="history-retention-days">
                <option value="7" />
                <option value="30" />
                <option value="90" />
              </datalist>
            </div>
            <label class="flex flex-col gap-2">
              <span class="font-medium">{{
                t("history_results.excluded_requests")
              }}</span>
              <input
                v-model="search"
                type="search"
                class="rounded border border-divider bg-primary px-2 py-1"
                :placeholder="t('action.search')"
              />
            </label>
            <div class="max-h-36 overflow-y-auto rounded border border-divider">
              <label
                v-for="item in matchingRequests"
                :key="item.key"
                class="flex items-center gap-2 border-b border-dividerLight px-2 py-1.5 last:border-0"
              >
                <input
                  type="checkbox"
                  class="accent-accent"
                  :checked="item.ids.some((id) => excluded.includes(id))"
                  @change="
                    toggleExclusion(
                      item.ids,
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                <span class="truncate" :title="item.name">{{ item.name }}</span>
              </label>
              <p
                v-if="matchingRequests.length === 0"
                class="px-2 py-2 text-secondaryLight"
              >
                {{ t("state.nothing_found") }}
              </p>
            </div>
            <p
              v-if="policy.lastCleanup && policy.lastCleanupAt"
              class="text-secondaryLight"
            >
              {{
                t("history_results.last_cleanup", {
                  time: new Date(policy.lastCleanupAt).toLocaleString(),
                  count: policy.lastCleanup.count,
                  size: formatBytes(policy.lastCleanup.bytes),
                })
              }}
            </p>
            <div>
              <HoppButtonPrimary
                :label="t('action.save')"
                :disabled="busy || !validDays(retentionDays)"
                @click="saveCleanupPolicy"
              />
            </div>
          </section>
          <section class="flex flex-col gap-3 border-t border-divider pt-4">
            <h3 class="font-semibold text-secondaryDark">
              {{ t("history_results.manual") }}
            </h3>
            <div class="flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-2">
                {{ t("history_results.older_than_days") }}
                <input
                  v-model.number="days"
                  type="number"
                  min="1"
                  max="36500"
                  class="w-20 rounded border border-divider bg-primary px-2 py-1"
                />
              </label>
              <select
                v-model="kind"
                :aria-label="t('history_results.result_type')"
                class="rounded border border-divider bg-primary px-2 py-1"
              >
                <option value="">{{ t("filter.all") }}</option>
                <option v-for="type in kinds" :key="type" :value="type">
                  {{ t(`history_results.kinds.${type}`) }}
                </option>
              </select>
              <HoppButtonSecondary
                :label="t('history_results.preview_cleanup')"
                :disabled="busy || policyDirty || !validDays(days)"
                outline
                @click="previewCleanup"
              />
            </div>
            <p v-if="policyDirty" class="text-secondaryLight">
              {{ t("history_results.save_policy_first") }}
            </p>
            <p v-if="preview" role="status">
              {{
                t("history_results.preview_report", {
                  count: preview.count,
                  size: formatBytes(preview.bytes),
                })
              }}
            </p>
            <div v-if="preview?.count">
              <HoppButtonPrimary
                :label="t('history_results.confirm_cleanup')"
                :disabled="busy || policyDirty"
                @click="executeCleanup"
              />
            </div>
            <p v-if="completed" role="status">
              {{
                t("history_results.cleaned_report", {
                  count: completed.count,
                  size: formatBytes(completed.bytes),
                })
              }}
            </p>
            <p v-if="error" role="alert" class="text-red-500">
              {{ t("history_results.error") }}
            </p>
          </section>
        </div>
      </template>
    </HoppSmartModal>
  </div>
</template>

<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { computed, onMounted, ref, watch } from "vue"
import type { HoppCollection } from "@apirequest/data"
import { useI18n } from "~/composables/i18n"

import { useWorkbenchCollections } from "~/composables/workbenchCollections"

import {
  formatBytes,
  historyResultAPI,
  type HistoryCleanupReport,
  type HistoryResultKind,
  type HistoryResultPolicy,
} from "~/helpers/workbench-history-results"

const t = useI18n()
const { entries } = useWorkbenchCollections()

const policy = ref<HistoryResultPolicy>()
const busy = ref(false)
const error = ref(false)
const showCleanup = ref(false)
const autoCleanup = ref(false)
const retentionDays = ref(30)
const excluded = ref<string[]>([])
const search = ref("")
const days = ref(30)
const kind = ref<HistoryResultKind | "">("")
const kinds: HistoryResultKind[] = ["json", "text", "image", "video", "file"]
const preview = ref<HistoryCleanupReport>()
const completed = ref<HistoryCleanupReport>()
const policyDirty = computed(() => {
  const saved = policy.value
  return (
    !!saved &&
    (autoCleanup.value !== saved.autoCleanup ||
      retentionDays.value !== saved.retentionDays ||
      JSON.stringify(excluded.value) !==
        JSON.stringify(saved.excludedRequestIds))
  )
})

const matchingRequests = computed(() => {
  const requests = new Map<
    string,
    { key: string; name: string; ids: string[] }
  >()
  const add = (folder: HoppCollection, path: string) => {
    for (const request of folder.requests) {
      const key = request.id ?? request._ref_id
      if (!key) continue
      requests.set(key, {
        key,
        name: `${path} / ${request.name}`,
        ids: [
          ...new Set(
            [request.id, request._ref_id].filter((id): id is string => !!id)
          ),
        ],
      })
    }
  }
  for (const { collection, title } of entries.value) add(collection, title)
  return [...requests.values()].filter(({ name }) =>
    name.toLowerCase().includes(search.value.trim().toLowerCase())
  )
})

const validDays = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 36500

function toggleExclusion(ids: string[], checked: boolean) {
  const next = new Set(excluded.value)
  ids.forEach((id) => (checked ? next.add(id) : next.delete(id)))
  excluded.value = [...next]
}

function syncPolicy(value: HistoryResultPolicy) {
  policy.value = value
  autoCleanup.value = value.autoCleanup
  retentionDays.value = value.retentionDays
  excluded.value = [...value.excludedRequestIds]
}

async function execute(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = false
  try {
    await action()
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

function loadPolicy() {
  return execute(async () => {
    const value = await historyResultAPI<HistoryResultPolicy>("policy")
    syncPolicy(value)
    days.value = value.retentionDays
  })
}

function saveCleanupPolicy() {
  void execute(async () => {
    syncPolicy(
      await historyResultAPI<HistoryResultPolicy>(
        "policy",
        json("PUT", {
          autoCleanup: autoCleanup.value,
          retentionDays: retentionDays.value,
          excludedRequestIds: excluded.value,
        })
      )
    )
    preview.value = undefined
  })
}

const criteria = () => ({ days: days.value, kind: kind.value || undefined })

function previewCleanup() {
  void execute(async () => {
    completed.value = undefined
    const selected = criteria()
    const report = await historyResultAPI<HistoryCleanupReport>(
      "cleanup/preview",
      json("POST", selected)
    )
    if (
      selected.days === days.value &&
      selected.kind === (kind.value || undefined) &&
      !policyDirty.value
    ) {
      preview.value = report
    }
  })
}

function executeCleanup() {
  const expected = preview.value
  if (!expected?.count || policyDirty.value) return
  void execute(async () => {
    completed.value = await historyResultAPI<HistoryCleanupReport>(
      "cleanup",
      json("POST", { ...criteria(), expected })
    )
    preview.value = undefined
    policy.value = await historyResultAPI<HistoryResultPolicy>("policy")
  })
}

watch([days, kind, policyDirty], () => {
  preview.value = undefined
})
watch(showCleanup, (visible) => {
  if (visible) void loadPolicy()
})
onMounted(loadPolicy)
</script>
