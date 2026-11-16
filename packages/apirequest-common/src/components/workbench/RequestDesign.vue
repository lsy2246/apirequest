<template>
  <section class="flex flex-col gap-5 p-5">
    <label class="flex flex-col gap-2"
      ><span class="font-semibold text-secondaryDark">{{
        t("workbench.request_name")
      }}</span
      ><input
        v-model="request.name"
        class="rounded border border-divider bg-primary px-3 py-2"
    /></label>
    <div>
      <h3 class="mb-3 font-semibold text-secondaryDark">
        {{ t("documentation.description") }}
      </h3>
      <CollectionsDocumentationMarkdownEditor v-model="description" />
    </div>
    <div class="flex items-center justify-between border-b border-divider pb-3">
      <h3 class="font-semibold text-secondaryDark">
        {{ t("workbench.request_definition") }}
      </h3>
      <HoppButtonSecondary
        :icon="IconSave"
        :label="t('request.save')"
        @click="invokeAction('request-response.save')"
      />
    </div>
    <HttpRequestOptions
      v-model="request"
      v-model:option-tab="optionTab"
      :inherited-properties="inherited"
      :envs="envs"
    />
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useVModel } from "@vueuse/core";
import type { HoppRESTRequest } from "@apirequest/data";
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties";
import type { AggregateEnvironment } from "~/newstore/environments";
import type { RESTOptionTabs } from "~/components/http/RequestOptions.vue";
import { useI18n } from "~/composables/i18n";
import { invokeAction } from "~/helpers/actions";
import IconSave from "~icons/lucide/save";
const props = defineProps<{
  modelValue: HoppRESTRequest
  inherited?: HoppInheritedProperty
  envs: AggregateEnvironment[]
}>()
const emit = defineEmits<{
  (event: "update:modelValue", request: HoppRESTRequest): void
}>()
const request = useVModel(props, "modelValue", emit)
const description = computed({
  get: () => request.value.description ?? "",
  set: (value) => {
    request.value.description = value
  },
})
const optionTab = ref<RESTOptionTabs>("params")
const t = useI18n()
</script>
