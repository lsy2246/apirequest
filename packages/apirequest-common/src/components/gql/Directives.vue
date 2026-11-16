<template>
  <GqlExplorerSection
    v-if="directives.length > 0"
    :title="t('graphql.directives')"
  >
    <div
      v-for="directive in directives"
      :key="directive.name.value"
      class="px-4 py-2"
    >
      <span class="text-sm font-medium text-secondaryDark">
        @{{ directive?.name?.value }}
      </span>
    </div>
  </GqlExplorerSection>
</template>

<script setup lang="ts">
import { useI18n } from "~/composables/i18n";

import { ExplorerFieldDef } from "~/helpers/graphql/explorer";
import { computed } from "vue";

const t = useI18n()

const props = defineProps<{
  field: ExplorerFieldDef
}>()

const directives = computed(() => props.field.astNode?.directives || [])
</script>
