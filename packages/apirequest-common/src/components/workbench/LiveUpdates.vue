<template>
  <div
    class="flex shrink-0 flex-wrap items-center gap-2 text-tiny"
    data-testid="live-updates"
  >
    <span
      role="status"
      class="flex items-center gap-1.5 text-secondaryLight"
      :title="t('workbench_live.title')"
    >
      <span
        class="h-1.5 w-1.5 rounded-full"
        :class="
          status === 'live'
            ? 'bg-green-500'
            : status === 'reconnecting'
              ? 'bg-amber-500'
              : 'bg-dividerDark'
        "
        aria-hidden="true"
      />
      {{ t(`workbench_live.${status}`) }}
    </span>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "~/composables/i18n";
import { liveSourceKey, liveStatus, type LiveSource } from "~/services/workbench-realtime.service";
const props = withDefaults(defineProps<{ source?: LiveSource }>(), {
  source: "backend",
})
const t = useI18n()
const status = computed(
  () =>
    liveStatus[liveSourceKey(props.source)] ??
    liveStatus[liveSourceKey("backend")] ??
    "connecting"
)
</script>
