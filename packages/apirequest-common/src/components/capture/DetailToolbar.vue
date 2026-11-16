<template>
  <div
    ref="toolbar"
    class="capture-detail-toolbar"
    data-testid="capture-detail-toolbar"
  >
    <div class="capture-request-heading">
      <strong class="capture-method">{{ detail?.method }}</strong>
      <span
        v-if="detail?.status"
        class="capture-status"
        :class="
          detail.status >= 400
            ? 'text-red-500'
            : detail.status < 300
              ? 'text-green-600'
              : 'text-secondary'
        "
        >{{ detail.status }}</span
      >
      <span class="capture-request-url" :title="detail?.url">{{
        detail?.url
      }}</span>
      <span
        v-if="isBaseline"
        class="capture-baseline"
        :title="t('workbench_capture.baseline_selected')"
        >{{ t("workbench_capture.baseline") }}</span
      >
    </div>
    <div class="capture-detail-actions">
      <button
        v-if="detail"
        type="button"
        class="capture-toolbar-button capture-open-request"
        :disabled="!canOpen"
        @click="emit('openRequest')"
      >
        <IconOpen class="h-3.5 w-3.5" />{{
          t("workbench_capture.open_request")
        }}
      </button>
      <button
        v-if="detail && canReplay && !compact"
        type="button"
        class="capture-toolbar-button"
        :disabled="busy"
        @click="emit('replay')"
      >
        <IconReplay class="h-3.5 w-3.5" />{{ t("workbench_capture.replay") }}
      </button>
      <DropdownMenuRoot v-if="detail" v-model:open="menuOpen" :modal="false">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="capture-toolbar-button capture-icon-button"
            :aria-label="t('action.more')"
            :title="t('action.more')"
          >
            <IconMore class="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="capture-action-menu"
            align="end"
            :side-offset="6"
            :collision-padding="8"
            :aria-label="t('action.more')"
            @escape-key-down="onEscape"
          >
            <DropdownMenuItem
              v-if="compact && canReplay"
              class="capture-action-item"
              :disabled="busy"
              @select="run('replay')"
              ><IconReplay />{{
                t("workbench_capture.replay")
              }}</DropdownMenuItem
            >
            <DropdownMenuItem
              class="capture-action-item"
              :disabled="!canOpen"
              @select="run('copyCurl')"
              ><IconCopy />{{
                t("workbench_capture.copy_curl")
              }}</DropdownMenuItem
            >
            <DropdownMenuItem
              class="capture-action-item"
              @select="run('downloadHar')"
              ><IconDownload />{{
                t("workbench_capture.export_har")
              }}</DropdownMenuItem
            >
            <DropdownMenuSeparator class="my-1 border-t border-dividerLight" />
            <DropdownMenuItem
              v-if="!isBaseline"
              class="capture-action-item"
              @select="run('markComparison')"
              ><IconBaseline />{{
                t("workbench_capture.mark_compare")
              }}</DropdownMenuItem
            >
            <DropdownMenuItem
              v-else
              class="capture-action-item"
              @select="run('clearComparison')"
              ><IconBaseline />{{
                t("workbench_capture.clear_compare")
              }}</DropdownMenuItem
            >
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <button
        type="button"
        class="capture-toolbar-button capture-icon-button"
        :aria-label="t('workbench_capture.close_detail')"
        :title="t('workbench_capture.close_detail')"
        @click="emit('close')"
      >
        <IconClose class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useElementSize, useEventListener } from "@vueuse/core"
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "reka-ui"
import { useI18n } from "~/composables/i18n"
import type { CaptureEntry } from "~/helpers/workbench-capture"
import IconOpen from "~icons/lucide/arrow-up-right"
import IconReplay from "~icons/lucide/rotate-cw"
import IconMore from "~icons/lucide/ellipsis"
import IconClose from "~icons/lucide/x"
import IconCopy from "~icons/lucide/copy"
import IconDownload from "~icons/lucide/download"
import IconBaseline from "~icons/lucide/flag"
const props = defineProps<{
  detail?: Pick<CaptureEntry, "id" | "method" | "status" | "url">
  comparison?: Pick<CaptureEntry, "id">
  canOpen: boolean
  canReplay: boolean
  busy: boolean
}>()
type MenuAction =
  "replay" | "copyCurl" | "downloadHar" | "markComparison" | "clearComparison"
const emit = defineEmits<{
  (event: MenuAction | "openRequest" | "close"): void
}>()
const t = useI18n()
const toolbar = ref<HTMLElement>()
const { width } = useElementSize(toolbar)
const compact = computed(() => width.value < 640)
const menuOpen = ref(false)
const isBaseline = computed(
  () => !!props.detail && props.comparison?.id === props.detail.id
)
watch(
  () => props.detail?.id,
  () => {
    menuOpen.value = false
  }
)
async function run(action: MenuAction) {
  menuOpen.value = false
  await nextTick()
  emit(action)
}
function onEscape(event: KeyboardEvent) {
  event.stopPropagation()
}
useEventListener(
  window,
  "keydown",
  (event) => {
    if (!menuOpen.value || event.key !== "Escape") return
    event.preventDefault()
    event.stopImmediatePropagation()
    menuOpen.value = false
  },
  { capture: true }
)
</script>
<style scoped>
.capture-detail-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 48px;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--divider-color);
}
.capture-request-heading {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.capture-method,
.capture-status {
  flex-shrink: 0;
  font-size: var(--font-size-tiny);
}
.capture-method {
  color: var(--secondary-dark-color);
}
.capture-status {
  font-variant-numeric: tabular-nums;
}
.capture-request-url {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}
.capture-baseline {
  flex-shrink: 0;
  border-radius: 4px;
  padding: 2px 5px;
  background: var(--primary-light-color);
  color: var(--accent-color);
  font-size: 10px;
  white-space: nowrap;
}
.capture-detail-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}
.capture-toolbar-button {
  display: inline-flex;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  font-weight: 500;
  white-space: nowrap;
}
.capture-toolbar-button:hover {
  background: var(--primary-light-color);
  color: var(--secondary-dark-color);
}
.capture-toolbar-button:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
.capture-toolbar-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.capture-open-request {
  border-color: var(--accent-color);
  color: var(--accent-color);
}
.capture-open-request:hover {
  color: var(--accent-color);
}
.capture-icon-button {
  width: 30px;
  padding: 0;
}
:global(.capture-action-menu) {
  z-index: 70;
  min-width: 176px;
  max-width: calc(100vw - 16px);
  padding: 4px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--primary-color);
  color: var(--secondary-color);
  box-shadow: 0 8px 24px #00000018;
}
.capture-action-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
  padding: 7px 9px;
  border-radius: 4px;
  font-size: var(--font-size-tiny);
  outline: none;
  cursor: pointer;
  user-select: none;
}
.capture-action-item > svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.capture-action-item[data-highlighted] {
  background: var(--primary-light-color);
  color: var(--secondary-dark-color);
}
.capture-action-item[data-disabled] {
  opacity: 0.4;
  pointer-events: none;
}
</style>
