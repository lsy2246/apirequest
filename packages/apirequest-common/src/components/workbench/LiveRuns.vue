<template>
  <section
    v-if="activeRuns.length || error"
    class="workbench-panel"
    data-testid="live-runs"
  >
    <h3
      class="border-b border-divider px-5 py-3 font-semibold text-secondaryDark"
    >
      {{ t("workbench_live.runs_title") }}
    </h3>
    <p v-if="error" role="alert" class="px-5 py-3 text-secondaryLight">
      {{ t("workbench.refresh_failed") }}
    </p>
    <div
      v-for="run in activeRuns"
      :key="run.id"
      class="border-b border-dividerLight px-5 py-3 last:border-0"
    >
      <div class="flex items-center justify-between gap-3">
        <strong class="min-w-0 truncate text-secondaryDark">{{
          run.name
        }}</strong>
        <span class="shrink-0 text-tiny text-accent">
          {{ t(`workbench_live.${run.status}`) }} · {{ run.completed }} /
          {{ run.total || "—" }}
        </span>
      </div>
      <progress
        class="mt-2 h-1.5 w-full accent-accent"
        :value="run.completed"
        :max="run.total || 1"
        :aria-label="run.name"
      />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import { useWorkbenchLiveQuery } from "~/composables/workbenchLive"
import {
  workbenchMcpAPI,
  workbenchSchedulesAvailable,
} from "~/helpers/workbench-mcp"
const t = useI18n()
const runs = ref<
  {
    id: string
    name: string
    status: string
    completed: number
    total: number
  }[]
>([])
const activeRuns = computed(() =>
  runs.value.filter((run) =>
    ["running", "pausing", "paused"].includes(run.status)
  )
)
const error = ref(false)
const controller = new AbortController()
useWorkbenchLiveQuery(
  ["automation"],
  async () => {
    try {
      const result = await workbenchMcpAPI<typeof runs.value>(
        "automation/runs",
        undefined,
        controller.signal
      )
      if (!controller.signal.aborted) {
        runs.value = result
        error.value = false
      }
    } catch (failure) {
      if (!controller.signal.aborted) error.value = true
      throw failure
    }
  },
  { available: workbenchSchedulesAvailable() }
)
onBeforeUnmount(() => controller.abort())
</script>
