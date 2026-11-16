<template>
  <Splitpanes
    :rtl="sidebarOnLeft && mdAndLarger"
    :class="{
      '!flex-row-reverse': sidebarOnLeft && mdAndLarger,
      'smart-splitter': SIDEBAR && hasSidebar,
      'no-splitter': !(SIDEBAR && hasSidebar),
    }"
    :horizontal="!mdAndLarger"
    @resized="setPaneEvent($event, 'vertical')"
  >
    <Pane
      :size="SIDEBAR && hasSidebar ? PANE_MAIN_SIZE : 100"
      min-size="65"
      class="flex flex-col overflow-hidden"
    >
      <Splitpanes
        class="smart-splitter"
        :horizontal="COLUMN_LAYOUT || forceColumnLayout"
        @resize="setPaneEvent($event, 'horizontal')"
      >
        <Pane
          :size="PANE_MAIN_TOP_SIZE"
          class="flex flex-col overflow-auto"
          :min-size="isEmbed ? 12 : 25"
        >
          <slot name="primary" />
        </Pane>
        <Pane
          v-if="hasSecondary"
          :size="PANE_MAIN_BOTTOM_SIZE"
          class="flex flex-col overflow-auto"
          min-size="25"
        >
          <slot name="secondary" />
        </Pane>
      </Splitpanes>
    </Pane>
    <Pane
      v-if="hasSidebar"
      :size="SIDEBAR ? PANE_SIDEBAR_SIZE : 0"
      :min-size="isWorkspace ? 16 : 25"
      class="flex flex-col !overflow-auto bg-primaryContrast"
    >
      <slot name="sidebar" />
    </Pane>
  </Splitpanes>
</template>

<script setup lang="ts">
import { Pane, Splitpanes } from "splitpanes";

import "splitpanes/dist/splitpanes.css"

import { useSetting } from "@composables/settings";
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
import { useService } from "dioc/vue";
import { computed, onMounted, ref, useSlots } from "vue";
import { PersistenceService } from "~/services/persistence";

const SIDEBAR_ON_LEFT = useSetting("SIDEBAR_ON_LEFT")

const breakpoints = useBreakpoints(breakpointsTailwind)
const mdAndLarger = breakpoints.greaterOrEqual("md")

const COLUMN_LAYOUT = useSetting("COLUMN_LAYOUT")

const SIDEBAR = useSetting("SIDEBAR")

const slots = useSlots()

const persistenceService = useService(PersistenceService)

const hasSidebar = computed(() => !!slots.sidebar)
const hasSecondary = computed(() => !!slots.secondary)

const props = defineProps({
  layoutId: {
    type: String,
    default: null,
  },
  isEmbed: {
    type: Boolean,
    default: false,
  },
  forceColumnLayout: {
    type: Boolean,
    default: false,
  },
})

type PaneEvent = {
  max: number
  min: number
  size: number
}

// 工作台目录固定在左侧；请求/响应内层布局继续复用原有拖动与持久化逻辑。
const isWorkspace = props.layoutId === "http" || props.layoutId === "graphql"
const sidebarOnLeft = computed(() => isWorkspace || SIDEBAR_ON_LEFT.value)
const PANE_MAIN_SIZE = ref(isWorkspace ? 78 : 70)
const PANE_SIDEBAR_SIZE = ref(isWorkspace ? 22 : 30)
const PANE_MAIN_TOP_SIZE = ref(50)
const PANE_MAIN_BOTTOM_SIZE = ref(50)

if (!COLUMN_LAYOUT.value) {
  PANE_MAIN_TOP_SIZE.value = 50
  PANE_MAIN_BOTTOM_SIZE.value = 50
}

async function setPaneEvent(
  event: PaneEvent[],
  type: "vertical" | "horizontal"
) {
  if (!props.layoutId) return
  if (type === "vertical" && (!SIDEBAR.value || !applySidebarSizes(event))) {
    return
  }
  const storageKey = `${props.layoutId}-pane-config-${type}`
  await persistenceService.set(storageKey, JSON.stringify(event))
}

function applySidebarSizes(event: PaneEvent[]) {
  const size = event[1]?.size
  if (typeof size !== "number" || !(size > 0 && size < 100)) return false
  PANE_MAIN_SIZE.value = 100 - size
  PANE_SIDEBAR_SIZE.value = size
  return true
}

async function populatePaneEvent() {
  if (!props.layoutId) return

  const verticalPaneData = await getPaneData("vertical")
  if (verticalPaneData && Array.isArray(verticalPaneData)) {
    applySidebarSizes(verticalPaneData)
  }

  const horizontalPaneData = await getPaneData("horizontal")
  if (horizontalPaneData && Array.isArray(horizontalPaneData)) {
    const [mainTopPane, mainBottomPane] = horizontalPaneData
    PANE_MAIN_TOP_SIZE.value = mainTopPane?.size
    PANE_MAIN_BOTTOM_SIZE.value = mainBottomPane?.size
  }
}

async function getPaneData(
  type: "vertical" | "horizontal"
): Promise<PaneEvent[] | null> {
  const storageKey = `${props.layoutId}-pane-config-${type}`
  const paneEvent = await persistenceService.getNullable<string>(storageKey)
  if (!paneEvent) return null
  try {
    return JSON.parse(paneEvent)
  } catch {
    return null
  }
}

onMounted(async () => {
  await populatePaneEvent()
})
</script>
