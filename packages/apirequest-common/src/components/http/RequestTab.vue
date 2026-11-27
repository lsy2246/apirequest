<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <WorkbenchRequestModes
      v-model="mode"
      :id-prefix="`request-mode-${tab.id}`"
    />
    <div
      :id="`request-mode-${tab.id}-panel`"
      role="tabpanel"
      :aria-labelledby="`request-mode-${tab.id}-${mode}`"
      class="flex min-h-0 flex-1 flex-col"
    >
      <HttpRequest v-model="tab" />
      <WorkbenchRequestDesign
        v-if="mode === 'design'"
        v-model="tab.document.request"
        :inherited="tab.document.inheritedProperties"
        :envs="resolvedEnvs"
        class="overflow-auto"
      />
      <WorkbenchRequestDocumentation
        v-else-if="mode === 'documentation' && isDocumentationVisible"
        :key="tab.id"
        v-model="tab.document.request"
        :inherited="tab.document.inheritedProperties"
        :environment-variables="envs"
        @debug="mode = 'debug'"
      />
      <WorkbenchRequestCases
        v-else-if="mode === 'cases'"
        :key="tab.id"
        :request="tab.document.request"
        :request-id="
          tab.document.saveContext && !tab.document.saveContext.exampleID
            ? (tab.document.request._ref_id ?? tab.document.request.id)
            : undefined
        "
        :inherited="tab.document.inheritedProperties"
        class="overflow-auto"
      />
      <div v-else-if="mode === 'load'" class="min-h-0 overflow-auto">
        <WorkbenchLoadTestPanel
          :request="tab.document.request"
          :inherited="tab.document.inheritedProperties"
        />
        <WorkbenchReports kind="load" class="mx-5 mb-5" />
      </div>
      <WorkbenchRequestSettings
        v-else-if="mode === 'settings'"
        v-model="tab.document.request"
        class="min-h-0 flex-1 overflow-auto"
      />
      <AppPaneLayout
        v-else
        layout-id="rest-primary"
        class="request-detail-panes"
      >
        <template #primary>
          <HttpRequestOptions
            v-model="tab.document.request"
            v-model:option-tab="tab.document.optionTabPreference!"
            v-model:inherited-properties="tab.document.inheritedProperties"
            sync-query
            :envs="resolvedEnvs"
          />
        </template>
        <template #secondary>
          <HttpResponse
            v-model:document="tab.document"
            :tab-id="tab.id"
            :is-embed="false"
          />
        </template>
      </AppPaneLayout>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, computed } from "vue"
import WorkbenchReports from "~/components/workbench/Reports.vue"
import WorkbenchRequestCases from "~/components/workbench/RequestCases.vue"
import type { RequestMode } from "~/components/workbench/RequestModes.vue"
import { useVModel } from "@vueuse/core"
import { cloneDeep } from "lodash-es"
import { isEqualHoppRESTRequest } from "@apirequest/data"
import { HoppTab } from "~/services/tab"
import { HoppRequestDocument } from "~/helpers/tab/document"
import { useReadonlyStream } from "@composables/stream"
import {
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue,
} from "~/newstore/environments"
import { getEffectiveVariablesForRequest } from "~/helpers/utils/environments"
import { useDocumentationVisibility } from "~/composables/documentationVisibility"

const props = defineProps<{ modelValue: HoppTab<HoppRequestDocument> }>()

const emit = defineEmits<{
  (e: "update:modelValue", val: HoppTab<HoppRequestDocument>): void
}>()

const tab = useVModel(props, "modelValue", emit)
const mode = computed<RequestMode>({
  get: () => tab.value.document.requestModePreference ?? "debug",
  set: (value) => {
    tab.value.document.requestModePreference = value
  },
})
const { isDocumentationVisible } = useDocumentationVisibility()
watch(
  [isDocumentationVisible, () => tab.value.id],
  ([visible]) => {
    if (!visible && mode.value === "documentation") mode.value = "debug"
  },
  { immediate: true }
)

const envs = useReadonlyStream(
  aggregateEnvsWithCurrentValue$,
  getAggregateEnvsWithCurrentValue()
)

const resolvedEnvs = computed(() => {
  // `showSecretCollectionValues = false` keeps inherited collection secrets
  // masked in this display list (consumed by the headers/auth preview and the
  // request field editors), matching the other display/preview consumers.
  // Execution/resolution callers (codegen, auth request builder) keep the
  // default `true` because they need the resolved value, not a mask.
  return getEffectiveVariablesForRequest(
    tab.value.document.request.requestVariables,
    tab.value.document.inheritedProperties?.variables,
    envs.value,
    false
  )
})

// TODO: Come up with a better dirty check
let oldRequest = cloneDeep(tab.value.document.request)
watch(
  () => tab.value.document.request,
  (updatedValue) => {
    if (
      !tab.value.document.isDirty &&
      !isEqualHoppRESTRequest(oldRequest, updatedValue)
    ) {
      tab.value.document.isDirty = true
    }

    oldRequest = cloneDeep(updatedValue)
  },
  { deep: true }
)
</script>

<style scoped>
/* 请求地址已移到分栏外，内层滚动区从选项标签开始，不能继续预留原来的地址栏高度。 */
.request-detail-panes {
  --upper-primary-sticky-fold: 0px;
  --upper-mobile-primary-sticky-fold: 0px;
  --upper-secondary-sticky-fold: 2.063rem;
  --upper-mobile-secondary-sticky-fold: 2.063rem;
  --upper-tertiary-sticky-fold: 4.126rem;
  --upper-fourth-sticky-fold: 6.189rem;
  --upper-mobile-sticky-fold: 4.126rem;
  --upper-mobile-tertiary-sticky-fold: 4.126rem;
}
</style>
