<template>
  <aside class="workbench-nav">
    <nav :aria-label="t('workbench.navigation')">
      <HoppSmartLink
        v-for="item in visibleItems"
        :key="item.to"
        :to="item.to"
        class="workbench-nav-link"
        :class="{ selected: isSelected(item.to) }"
        :aria-current="isSelected(item.to) ? 'page' : undefined"
      >
        <component :is="item.icon" class="h-[19px] w-[19px]" />
        <span>{{ t(item.label) }}</span>
      </HoppSmartLink>
    </nav>
    <div class="workbench-nav-foot">
      <WorkbenchLiveUpdates :source="liveSource" />
    </div>
  </aside>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "~/composables/i18n";
import { useWorkbenchNavigation } from "~/composables/workbenchNavigation";
import WorkbenchLiveUpdates from "~/components/workbench/LiveUpdates.vue";
import { isLocalWorkbench } from "~/platform";
import { subscribeWorkbench } from "~/services/workbench-realtime.service";

const t = useI18n()
const route = useRoute()
const liveSource = computed(() =>
  route.path.startsWith("/capture") ? "capture" : "backend"
)
let stopLiveConnection: (() => void) | undefined
onMounted(() => {
  if (!isLocalWorkbench()) return
  // Keep one shared owner connection across page navigation, without fetching data.
  stopLiveConnection = subscribeWorkbench("backend", [], () => {})
})
onBeforeUnmount(() => stopLiveConnection?.())
const { navigation } = useWorkbenchNavigation()
const visibleItems = computed(() =>
  navigation.value.filter(({ visible }) => visible)
)
const isSelected = (path: string) =>
  path === "/" ? route.path === "/" : route.path.startsWith(path)
</script>
<style scoped>
.workbench-nav {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  width: 76px;
  background: var(--primary-light-color);
  border-right: 1px solid var(--divider-color);
}
.workbench-nav nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 6px;
}
.workbench-nav-link {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  min-height: 60px;
  border-radius: 8px;
  color: var(--secondary-color);
  font-size: 11px;
  position: relative;
}
.workbench-nav-link:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}
.workbench-nav-link.selected {
  color: var(--accent-color);
  background: var(--primary-color);
  box-shadow: 0 1px 4px #00000008;
}
.workbench-nav-link.selected::before {
  content: "";
  position: absolute;
  inset: 19px auto 19px -6px;
  width: 2px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-color);
}
.workbench-nav-foot {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  padding: 12px 0;
  font-size: 11px;
  color: var(--secondary-color);
}
@media (max-width: 767px) {
  .workbench-nav {
    flex-direction: row;
    align-items: center;
    width: 100%;
    height: 54px;
    overflow-x: auto;
  }
  .workbench-nav nav {
    flex-shrink: 0;
    flex-direction: row;
    padding: 0;
    gap: 0;
  }
  .workbench-nav-link {
    min-width: 70px;
    min-height: 54px;
    gap: 3px;
    border-radius: 0;
  }
  .workbench-nav-foot {
    flex-shrink: 0;
    min-width: 70px;
    margin-left: auto;
    padding: 0 12px;
  }
  .workbench-nav-link.selected::before {
    inset: auto 15px 0;
    width: auto;
    height: 2px;
  }
}
</style>
