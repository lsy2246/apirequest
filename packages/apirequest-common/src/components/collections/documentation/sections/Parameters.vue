<template>
  <div v-if="rows.length" class="max-w-2xl space-y-2">
    <h2
      class="text-sm font-semibold text-secondaryDark flex items-end px-4 p-2 border-b border-divider"
    >
      {{ t("documentation.parameters.title") }}
    </h2>
    <div class="parameter-list space-y-3 px-4 py-2">
      <div v-for="(param, index) in rows" :key="index" class="parameter-row">
        <span class="font-medium text-secondaryDark [overflow-wrap:anywhere]">
          {{ param.key }}
        </span>
        <span
          class="font-mono [overflow-wrap:anywhere]"
          :class="{ 'text-secondaryLight': param.placeholder }"
          :title="param.placeholder"
        >
          {{ param.value }}
        </span>
        <span
          class="parameter-status justify-self-end px-2 py-0.5 text-xs rounded"
          :class="
            param.active
              ? 'bg-green-500/20 text-green-500'
              : 'bg-red-500/20 text-red-500'
          "
        >
          {{ param.active ? t("documentation.yes") : t("documentation.no") }}
        </span>
        <span
          v-if="param.description"
          class="parameter-description text-xs text-secondaryLight [overflow-wrap:anywhere]"
        >
          {{ param.description }}
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { Environment, HoppRESTParam, parseTemplateString } from "@apirequest/data";
import { useI18n } from "~/composables/i18n";

const t = useI18n()

const props = defineProps<{
  params: HoppRESTParam[]
  publishedEnvironment?: Environment
}>()

const rows = computed(() => {
  const variables = props.publishedEnvironment?.variables
  return props.params.map((param) => {
    if (!variables) return { ...param, placeholder: undefined }

    const value = parseTemplateString(param.value, variables, false, true, true)
    const placeholder = /^<<([^<>]+)>>$/.exec(value)
    const secret = placeholder
      ? variables.find(({ key }) => key === placeholder[1])?.secret
      : false

    return {
      ...param,
      key: parseTemplateString(param.key, variables, false, true, true),
      value: placeholder
        ? secret
          ? "••••••••"
          : t("documentation.not_set")
        : value,
      placeholder: placeholder?.[0],
    }
  })
})
</script>

<style scoped>
.parameter-list {
  container-type: inline-size;
}

.parameter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.25rem 0.75rem;
}

.parameter-description {
  grid-column: 1 / -1;
}

@container (min-width: 30rem) {
  .parameter-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr) auto;
  }

  .parameter-description {
    grid-column: 3;
    grid-row: 1;
  }

  .parameter-status {
    grid-column: 4;
    grid-row: 1;
  }
}
</style>
