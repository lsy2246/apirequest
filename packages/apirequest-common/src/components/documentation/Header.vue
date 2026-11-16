<template>
  <header class="border-b border-divider bg-primary">
    <div class="px-3 py-4 sm:px-6">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <span
            class="!font-bold uppercase tracking-wide !text-secondaryDark pr-1"
          >
            {{ instanceDisplayName }}
          </span>
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-3">
          <span
            class="text-md font-bold text-secondaryDark break-words py-1 rounded-full"
          >
            {{
              publishedDoc?.title || t("documentation.publish.untitled_project")
            }}
          </span>

          <span
            v-if="publishedDoc?.version"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-accent/10 text-accent border border-dividerDark"
          >
            <IconGlobe class="w-3.5 h-3.5" aria-hidden="true" />
            {{ publishedDoc.version }}
          </span>

          <span
            v-if="environmentName"
            class="inline-flex min-w-0 items-center gap-2 text-secondary"
          >
            <IconLayers class="svg-icons shrink-0" aria-hidden="true" />
            <span class="break-words">
              {{ t("documentation.publish.environment") }} ·
              {{ environmentName }}
            </span>
          </span>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useI18n } from "~/composables/i18n"
import type { PropType } from "vue"
import type { PublishedDocs } from "~/helpers/backend/graphql"
import IconGlobe from "~icons/lucide/globe"
import IconLayers from "~icons/lucide/layers"

const t = useI18n()

defineProps({
  publishedDoc: {
    type: Object as PropType<Partial<PublishedDocs> | null>,
    default: null,
  },
  instanceDisplayName: {
    type: String,
    default: "apirequest",
  },
  environmentName: {
    type: String as PropType<string | null>,
    default: null,
  },
})
</script>
