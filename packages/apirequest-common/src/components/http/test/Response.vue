<template>
  <div class="relative flex flex-1 flex-col">
    <div
      class="border-b border-divider px-4 py-2 text-tiny text-secondaryDark"
      data-testid="selected-run-request"
    >
      {{ doc.name }}
    </div>
    <p
      v-if="doc.error && !doc.reportResponse?.detailsRecorded"
      class="border-b border-divider px-4 py-2 text-tiny text-secondaryLight"
    >
      {{ t("workbench.report_original_missing") }}
    </p>
    <div
      v-if="doc.response?.type === 'network_fail'"
      class="sticky top-0 z-50 flex-none flex-shrink-0 items-center justify-center whitespace-nowrap bg-primary p-4"
    >
      <span class="text-secondary">
        {{ t("response.status") }}:
        <span class="text-red-500">{{ doc.error }}</span>
      </span>
    </div>
    <p
      v-if="doc.reportResponse?.response?.bodyTruncated"
      class="border-b border-divider p-3 text-secondaryLight"
    >
      {{ t("workbench.report_body_truncated") }}
    </p>
    <pre
      v-if="
        doc.reportResponse?.errorDetails?.length ||
        doc.testResults?.scriptErrorDetails
      "
      data-testid="request-error-details"
      class="whitespace-pre-wrap break-words border-b border-divider p-3 text-red-500"
      >{{
        JSON.stringify(
          doc.reportResponse?.errorDetails?.length
            ? doc.reportResponse.errorDetails
            : doc.testResults?.scriptErrorDetails,
          null,
          2
        )
      }}</pre>
    <HttpResponseMeta
      v-if="!doc.reportResponse?.response?.bodyTruncated"
      :response="doc.response"
      :is-embed="false"
      :is-loading="loading"
      :show-inspections="false"
    />
    <LensesResponseBodyRenderer
      v-if="!loading && lensDocument"
      :document="lensDocument"
      :is-editable="false"
      :is-test-runner="true"
      :show-response="showResponse"
      :tab-id="tabId"
    />
    <HoppSmartPlaceholder
      v-else
      :src="`/images/states/${colorMode.value}/add_files.svg`"
      :alt="`${t('collection_runner.response_body_lost_rerun')}`"
      :text="`${t('collection_runner.response_body_lost_rerun')}`"
    >
    </HoppSmartPlaceholder>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "~/composables/i18n"
import { useColorMode } from "~/composables/theming"
import type { HoppRequestDocument } from "~/helpers/tab/document"
import { TestRunnerRequest } from "~/services/test-runner/test-runner.service"

const t = useI18n()
const colorMode = useColorMode()

const props = defineProps<{
  showResponse: boolean
  document: TestRunnerRequest
  /** Owning runner tab — the lens renderers key their state by tab. */
  tabId: string
}>()

const doc = computed(() => props.document)

const lensDocument = computed<HoppRequestDocument | undefined>(() => {
  const response = doc.value.response
  if (!response || !("req" in response)) return undefined
  return {
    type: "request",
    isDirty: false,
    request: response.req,
    response,
    testResults: doc.value.testResults,
  }
})

const loading = computed(
  // Check both response type AND testResults to ensure we stay in loading state
  // during test execution (when testResults is null)
  () => doc.value.response?.type === "loading" || doc.value.testResults === null
)
</script>
