<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex items-center justify-between gap-4 border-b border-divider p-4"
    >
      <p class="text-secondaryLight">{{ t("workbench.request_docs_hint") }}</p>
      <HoppButtonSecondary
        :icon="IconSave"
        :label="t('request.save')"
        @click="invokeAction('request-response.save')"
      />
    </div>
    <CollectionsDocumentationRequestPreview
      v-model:documentation-description="description"
      :request="request"
      :inherited-properties="inherited"
      :environment-variables="environmentVariables"
      embedded
      class="p-5"
      @open-request="$emit('debug')"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useVModel } from "@vueuse/core";
import type { Environment, HoppRESTRequest } from "@apirequest/data";
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties";
import { useI18n } from "~/composables/i18n";
import { invokeAction } from "~/helpers/actions";
import IconSave from "~icons/lucide/save";

const props = defineProps<{
  modelValue: HoppRESTRequest
  inherited?: HoppInheritedProperty
  environmentVariables: Environment["variables"]
}>()
const emit = defineEmits<{
  (event: "update:modelValue", request: HoppRESTRequest): void
  (event: "debug"): void
}>()
const request = useVModel(props, "modelValue", emit)
const description = computed({
  get: () => request.value.description ?? "",
  set: (value: string) => {
    request.value.description = value
  },
})
const t = useI18n()
</script>
