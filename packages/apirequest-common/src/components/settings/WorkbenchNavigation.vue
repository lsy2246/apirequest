<template>
  <section class="space-y-3">
    <div>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold text-secondaryDark">
          {{ t("settings.navigation_layout") }}
        </h4>
        <HoppButtonSecondary
          :label="t('settings.navigation_restore_default')"
          :aria-label="t('settings.navigation_restore_default')"
          outline
          @click="saveNavigation([])"
        />
      </div>
      <p class="mt-1 text-secondaryLight">
        {{ t("settings.navigation_layout_description") }}
      </p>
    </div>

    <draggable
      :model-value="navigation"
      item-key="to"
      tag="ul"
      handle=".navigation-drag-handle"
      :animation="150"
      ghost-class="opacity-40"
      class="max-w-lg divide-y divide-dividerLight rounded border border-divider"
      @update:model-value="saveNavigation"
    >
      <template #item="{ element: item, index }">
        <li class="flex min-w-0 items-center gap-2 px-2 py-2 sm:gap-3">
          <span
            class="navigation-drag-handle inline-flex shrink-0 cursor-grab p-1 text-secondaryLight active:cursor-grabbing"
            aria-hidden="true"
          >
            <IconGripVertical class="svg-icons" />
          </span>
          <label class="flex min-w-0 flex-1 items-center gap-2">
            <input
              v-if="!item.required"
              type="checkbox"
              class="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent-color)]"
              :checked="item.visible"
              @change="toggleVisibility(item.to)"
            />
            <IconLock
              v-else
              class="svg-icons shrink-0 text-secondaryLight"
              aria-hidden="true"
            />
            <component
              :is="item.icon"
              class="svg-icons shrink-0 text-secondaryLight"
              aria-hidden="true"
            />
            <span class="min-w-0 truncate">{{ t(item.label) }}</span>
          </label>
          <span
            v-if="item.required"
            class="shrink-0 text-tiny text-secondaryLight"
          >
            {{ t("settings.navigation_required") }}
          </span>
          <div class="flex shrink-0">
            <button
              type="button"
              class="rounded p-1.5 text-secondary hover:bg-primaryLight disabled:opacity-50"
              :disabled="index === 0"
              :title="t('settings.navigation_move_up', { name: t(item.label) })"
              :aria-label="
                t('settings.navigation_move_up', { name: t(item.label) })
              "
              @click="move(index, -1)"
            >
              <IconChevronUp class="svg-icons" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="rounded p-1.5 text-secondary hover:bg-primaryLight disabled:opacity-50"
              :disabled="index === navigation.length - 1"
              :title="
                t('settings.navigation_move_down', { name: t(item.label) })
              "
              :aria-label="
                t('settings.navigation_move_down', { name: t(item.label) })
              "
              @click="move(index, 1)"
            >
              <IconChevronDown class="svg-icons" aria-hidden="true" />
            </button>
          </div>
        </li>
      </template>
    </draggable>
  </section>
</template>

<script setup lang="ts">
import draggable from "vuedraggable-es"
import { useI18n } from "~/composables/i18n"
import { useWorkbenchNavigation } from "~/composables/workbenchNavigation"
import IconChevronDown from "~icons/lucide/chevron-down"
import IconChevronUp from "~icons/lucide/chevron-up"
import IconGripVertical from "~icons/lucide/grip-vertical"
import IconLock from "~icons/lucide/lock"

const t = useI18n()
const { navigation, saveNavigation } = useWorkbenchNavigation()

const toggleVisibility = (path: string) => {
  saveNavigation(
    navigation.value.map((item) =>
      item.to === path ? { ...item, visible: !item.visible } : item
    )
  )
}

const move = (index: number, offset: number) => {
  const next = index + offset
  const ordered = [...navigation.value]
  if (next < 0 || next >= ordered.length) return
  const [item] = ordered.splice(index, 1)
  ordered.splice(next, 0, item)
  saveNavigation(ordered)
}
</script>
