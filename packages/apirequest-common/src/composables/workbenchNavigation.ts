import { computed, type Component } from "vue";
import { useSetting } from "~/composables/settings";
import type { WorkbenchNavigationPreference } from "~/newstore/settings";
import { isLocalWorkbench } from "~/platform";
import IconApi from "~icons/lucide/panels-top-left";
import IconLayers from "~icons/lucide/layers";
import IconWorkflow from "~icons/lucide/workflow";
import IconBook from "~icons/lucide/book-open";
import IconServer from "~icons/lucide/server";
import IconClock from "~icons/lucide/history";
import IconBot from "~icons/lucide/bot";
import IconSettings from "~icons/lucide/settings";
import IconRadar from "~icons/lucide/radar";

type NavigationItem = {
  to: string
  icon: Component
  label: string
  required?: boolean
}

const items: NavigationItem[] = [
  { to: "/", icon: IconApi, label: "workbench.api_management" },
  ...(import.meta.env.VITE_WORKBENCH_NATIVE ||
  import.meta.env.VITE_WORKBENCH_CAPTURE
    ? [{ to: "/capture", icon: IconRadar, label: "workbench_capture.title" }]
    : []),
  { to: "/environments", icon: IconLayers, label: "tab.environments" },
  { to: "/automation", icon: IconWorkflow, label: "workbench.automation" },
  { to: "/documentation", icon: IconBook, label: "workbench.documentation" },
  { to: "/mock", icon: IconServer, label: "workbench.mock" },
  { to: "/history", icon: IconClock, label: "tab.history" },
  { to: "/ai-access", icon: IconBot, label: "workbench_mcp.title" },
  {
    to: "/settings",
    icon: IconSettings,
    label: "navigation.settings",
    required: true,
  },
]

export function useWorkbenchNavigation() {
  const preferences = useSetting("WORKBENCH_NAVIGATION")

  const navigation = computed(() => {
    if (!isLocalWorkbench())
      return items.map((item) => ({ ...item, visible: true }))

    const available = new Map(items.map((item) => [item.to, item]))
    const saved = Array.isArray(preferences.value) ? preferences.value : []
    const visibility = new Map<string, boolean>()
    for (const entry of saved) {
      if (typeof entry?.to === "string" && typeof entry.visible === "boolean") {
        visibility.set(entry.to, entry.visible)
      }
    }

    // 按已保存的顺序显示。首次出现的入口默认显示，设置始终可以进入。
    return [...new Set([...visibility.keys(), ...available.keys()])].flatMap(
      (to) => {
        const item = available.get(to)
        if (!item) return []
        return [
          { ...item, visible: item.required || visibility.get(to) !== false },
        ]
      }
    )
  })

  const saveNavigation = (value: WorkbenchNavigationPreference[]) => {
    preferences.value = value.map(({ to, visible }) => ({
      to,
      visible: to === "/settings" || visible,
    }))
  }

  return { navigation, saveNavigation }
}
