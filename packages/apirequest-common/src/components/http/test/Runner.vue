<template>
  <AppPaneLayout layout-id="test-runner-primary">
    <template #primary>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div class="flex shrink-0 flex-col bg-primary">
          <div class="flex flex-wrap items-center gap-4 px-4 pt-4">
            <HttpTestRunnerMeta
              class="min-w-0 flex-1"
              :heading="t('collection.title')"
              :text="collectionName"
            />
            <div class="flex items-center gap-2 flex-shrink-0">
              <HoppButtonPrimary
                v-if="showResult && tab.document.status === 'running'"
                :label="t('test.stop')"
                @click="stopTests()"
              />
              <HoppButtonPrimary
                v-else-if="!readonly"
                :label="t('test.run_again')"
                @click="runAgain()"
              />
              <HoppButtonSecondary
                v-if="canExport"
                :icon="IconDownload"
                :label="t('collection_runner.export_results')"
                filled
                outline
                @click="exportResults('all')"
              />
            </div>
          </div>

          <!-- Hidden on a restored tab: a row of zeroes would crowd out the
               empty placeholder. -->
          <div
            v-if="
              showResult && (hasResults || tab.document.status === 'running')
            "
            class="flex gap-8 px-4 py-4 overflow-x-auto"
          >
            <HttpTestRunnerMeta
              :heading="t('response.status')"
              :text="
                tab.document.status === 'completed'
                  ? t('workbench_live.completed')
                  : tab.document.status === 'stopped'
                    ? t('workbench.report_stopped')
                    : tab.document.status === 'error'
                      ? t('workbench.report_error_runner')
                      : t('workbench_live.running')
              "
            />
            <HttpTestRunnerMeta
              :heading="t('environment.heading')"
              :text="runEnvironmentName"
            />
            <HttpTestRunnerMeta
              :heading="t('test.iterations')"
              :text="iterationResults.length.toString()"
            />
            <!-- The values tick while a run is live; reserve width so the
                 rest of the meta row doesn't shift with every request. -->
            <HttpTestRunnerMeta
              class="min-w-24 tabular-nums"
              :heading="t('test.duration')"
              :text="msToHumanReadable(duration)"
            />
            <HttpTestRunnerMeta
              class="min-w-24 tabular-nums"
              :heading="t('test.avg_resp')"
              :text="msToHumanReadable(avgResponseTime)"
            />
            <HttpTestRunnerMeta
              v-if="iterationResults.length > 1"
              class="ml-auto"
              :heading="t('collection_runner.jump_to_iteration')"
            >
              <div class="flex items-center -ml-2">
                <HoppButtonSecondary
                  v-tippy="{ theme: 'tooltip' }"
                  :title="t('collection_runner.previous_iteration')"
                  :icon="IconChevronLeft"
                  :disabled="viewedIteration <= 1"
                  class="!p-1"
                  @click="jumpTo(viewedIteration - 1)"
                />
                <!-- The visible face is the counter; the transparent select on
                     top of it provides direct jumps without a second control. -->
                <span
                  class="relative flex items-center rounded focus-within:ring-1 focus-within:ring-accent"
                >
                  <span
                    class="whitespace-nowrap px-1 text-sm font-bold tabular-nums text-secondaryDark"
                  >
                    {{ viewedIteration }} / {{ iterationResults.length }}
                  </span>
                  <select
                    v-tippy="{ theme: 'tooltip' }"
                    :title="t('collection_runner.jump_to_iteration')"
                    :aria-label="t('collection_runner.jump_to_iteration')"
                    class="absolute inset-0 cursor-pointer opacity-0"
                    :value="viewedIteration"
                    @change="onIterationSelect"
                  >
                    <option
                      v-for="{ iteration } in iterationAdapters"
                      :key="iteration"
                      :value="iteration"
                    >
                      {{
                        t("collection_runner.iteration", { count: iteration })
                      }}
                    </option>
                  </select>
                </span>
                <HoppButtonSecondary
                  v-tippy="{ theme: 'tooltip' }"
                  :title="t('collection_runner.next_iteration')"
                  :icon="IconChevronRight"
                  :disabled="viewedIteration >= iterationResults.length"
                  class="!p-1"
                  @click="jumpTo(viewedIteration + 1)"
                />
              </div>
            </HttpTestRunnerMeta>
          </div>
        </div>

        <div
          class="min-h-0 flex-1 overflow-auto"
          style="--upper-runner-sticky-fold: 0px"
        >
          <HttpTestRunnerResult
            v-if="showResult"
            :tab="tab"
            :iteration-adapters="iterationAdapters"
            :is-running="tab.document.status === 'running'"
            :selected-request-path="selectedRequestPath"
            :jump-to-iteration="jumpToIteration"
            @on-change-tab="
              changeResultFilter($event as 'all' | 'passed' | 'failed')
            "
            @on-select-request="onSelectRequest"
            @request-path="onChangeRequestPath"
            @jumped="jumpToIteration = 0"
            @visible-iteration="onVisibleIteration"
          />
        </div>
      </div>
    </template>
    <template #secondary>
      <div
        v-if="tab.document.status === 'running'"
        class="flex flex-col items-center gap-4 justify-center h-full"
      >
        <HoppSmartSpinner />
        <span> {{ t("collection_runner.running_collection") }}... </span>
      </div>
      <HttpTestResponse
        v-else-if="selectedRequest && selectedRequest.response"
        :key="`${tab.id}:${selectedRequestPath}`"
        :document="selectedRequest"
        :show-response="tab.document.config.persistResponses"
        :tab-id="tab.id"
      />

      <HoppSmartPlaceholder
        v-else-if="
          !testRunnerConfig.persistResponses && !selectedRequest?.response
        "
        :src="`/images/states/${colorMode.value}/add_files.svg`"
        :alt="`${t('collection_runner.no_response_persist')}`"
        :text="`${t('collection_runner.no_response_persist')}`"
      >
        <template #body>
          <HoppButtonPrimary
            :label="t('test.new_run')"
            @click="showCollectionsRunnerModal = true"
          />
        </template>
      </HoppSmartPlaceholder>

      <!-- Selected row without a response — restored runner tabs lose
           response bodies (ArrayBuffers don't survive the JSON round-trip),
           so a row click after refresh lands here instead of a blank pane. -->
      <HoppSmartPlaceholder
        v-else-if="selectedRequest && !selectedRequest.response"
        :src="`/images/states/${colorMode.value}/pack.svg`"
        :alt="`${t('collection_runner.response_body_lost_rerun')}`"
        :text="`${t('collection_runner.response_body_lost_rerun')}`"
      >
        <template #body>
          <HoppButtonPrimary
            :label="t('test.new_run')"
            @click="showCollectionsRunnerModal = true"
          />
        </template>
      </HoppSmartPlaceholder>

      <HoppSmartPlaceholder
        v-else-if="!selectedRequest"
        :src="`/images/states/${colorMode.value}/pack.svg`"
        :alt="`${t('collection_runner.response_body_lost_rerun')}`"
        :text="`${t('collection_runner.response_body_lost_rerun')}`"
      >
      </HoppSmartPlaceholder>
    </template>
  </AppPaneLayout>

  <HttpTestRunnerModal
    v-if="showCollectionsRunnerModal"
    :same-tab="!readonly"
    :collection-runner-data="
      tab.document.collectionType === 'my-collections'
        ? {
            type: 'my-collections',
            collectionID: tab.document.collectionID,
          }
        : {
            type: 'team-collections',
            collectionID: tab.document.collectionID,
          }
    "
    :prev-config="testRunnerConfig"
    :prev-selection="tab.document.selectedRequestRefIds"
    @hide-modal="showCollectionsRunnerModal = false"
  />
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { HoppCollection, HoppCollectionVariable } from "@apirequest/data"
import { SmartTreeAdapter } from "@apirequest/ui"
import { useVModel } from "@vueuse/core"
import { useService } from "dioc/vue"

import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useColorMode } from "~/composables/theming"
import { useToast } from "~/composables/toast"

import {
  HoppTestRunnerDocument,
  TestRunnerIterationResult,
} from "~/helpers/tab/document"
import {
  CollectionNode,
  TestRunnerCollectionsAdapter,
} from "~/helpers/runner/adapter"

import { collectRequestIDs } from "~/helpers/runner/selection"
import {
  getRESTCollectionByRefId,
  getRESTCollectionInheritedProps,
  restCollectionStore,
} from "~/newstore/collections"
import {
  getCurrentEnvironment,
  getSelectedEnvironmentType,
} from "~/newstore/environments"
import { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import {
  TestRunnerRequest,
  TestRunnerService,
} from "~/services/test-runner/test-runner.service"
import IconDownload from "~icons/lucide/download"
import IconChevronLeft from "~icons/lucide/chevron-left"
import IconChevronRight from "~icons/lucide/chevron-right"
import {
  exportRunnerResults,
  RunnerExportScope,
} from "~/helpers/import-export/export/runnerResults"
import * as E from "fp-ts/Either"
import {
  requestHasResult,
  requestFailed,
  resultRequests,
} from "~/helpers/runner/outcome"
import { runnerEnvironmentLabel } from "~/helpers/runner/environment"
import { collectReportSteps } from "~/helpers/test-runner/report"
import {
  downloadWorkbenchReport,
  useWorkbenchReports,
} from "~/composables/workbenchReports"
const { add: saveWorkbenchReport } = useWorkbenchReports()
const t = useI18n()
const toast = useToast()
const colorMode = useColorMode()
const props = defineProps<{
  modelValue: HoppTab<HoppTestRunnerDocument>
  readonly?: boolean
  report?: import("~/composables/workbenchReports").WorkbenchReport
}>()
const emit = defineEmits<{
  (e: "update:modelValue", val: HoppTab<HoppTestRunnerDocument>): void
}>()
const tabs = useService(WorkspaceTabsService)
const tab = useVModel(props, "modelValue", emit)
// RunnerResult's prop is a required string; the document field is undefined
// until a request is selected.
const selectedRequestPath = computed(
  () => tab.value.document.selectedRequestPath ?? ""
)
const duration = computed(() => tab.value.document.testRunnerMeta.totalTime)
const avgResponseTime = computed(() =>
  calculateAverageTime(
    tab.value.document.testRunnerMeta.totalTime,
    tab.value.document.testRunnerMeta.completedRequests
  )
)
function msToHumanReadable(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const milliseconds = ms % 1000
  let result = ""
  if (seconds > 0) {
    result += `${seconds}s `
  }
  result += `${milliseconds}ms`
  return result.trim()
}
const selectedRequest = computed(() => tab.value.document.request)
const onSelectRequest = (request: TestRunnerRequest) => {
  tab.value.document.request = request
}
const onChangeRequestPath = (path: string) => {
  tab.value.document.selectedRequestPath = path
}
const collectionName = computed(() =>
  props.modelValue.document.type === "test-runner"
    ? props.modelValue.document.collection.name
    : ""
)
const runEnvironmentName = computed(() =>
  runnerEnvironmentLabel(
    tab.value.document.environmentName,
    tab.value.document.environmentID,
    t("filter.none")
  )
)
const testRunnerConfig = computed(() => tab.value.document.config)
const iterationResults = computed(
  () => tab.value.document.iterationResults ?? []
)
const hasResults = computed(() => iterationResults.value.length > 0)
watch(
  () => tab.value.document.status,
  (status) => {
    if (status === "running" || tab.value.document.request) return
    const iteration = iterationResults.value.find(
      (result) => result.resultCollection?.requests.length
    )
    const first = iteration?.resultCollection?.requests[0] as
      TestRunnerRequest | undefined
    if (first) {
      tab.value.document.request = first
      tab.value.document.selectedRequestPath = `${iteration!.iteration}::request-folder-0/0`
    }
  },
  { immediate: true }
)
const collection = computed(() => {
  return tab.value.document.collection
})
// for re-run config
const showCollectionsRunnerModal = ref(false)
const testRunnerStopRef = ref(false)
const showResult = computed(() => {
  return (
    tab.value.document.status === "running" ||
    tab.value.document.status === "stopped" ||
    tab.value.document.status === "completed" ||
    tab.value.document.status === "error"
  )
})
const runTests = async () => {
  const { collectionID, collectionType } = tab.value.document
  const noEnvironment = getSelectedEnvironmentType() === "NO_ENV_SELECTED"
  tab.value.document.environmentID = noEnvironment
    ? null
    : getCurrentEnvironment().id
  tab.value.document.environmentName = noEnvironment
    ? undefined
    : getCurrentEnvironment().name
  const collections = restCollectionStore.value.state
  const collectionInheritedProps = getRESTCollectionInheritedProps(
    collectionID,
    collections,
    collectionType
  )
  let resolvedCollection: HoppCollection = collection.value
  // Scripts declared on ancestors above the selected run-start node — must be
  // seeded into the runner so partial-scope runs still honor the documented
  // Root → Parent → Child → Request inheritance chain.
  let ancestorPreRequestScripts: string[] = []
  let ancestorTestScripts: string[] = []
  // Ancestor collection variables, already resolved under their owning
  // collections — passed separately from the run root's own variables so the
  // runner never re-resolves a merged array under a single ID.
  let ancestorVariables: HoppCollectionVariable[] = []
  {
    const {
      auth,
      headers,
      ancestorVariables: varAncestors,
      ancestorPreRequestScripts: preAncestors,
      ancestorTestScripts: testAncestors,
    } = collectionInheritedProps ?? {
      auth: { authActive: true, authType: "none" },
      headers: [],
      ancestorVariables: [],
      ancestorPreRequestScripts: [],
      ancestorTestScripts: [],
    }
    ancestorPreRequestScripts = preAncestors
    ancestorTestScripts = testAncestors
    ancestorVariables = varAncestors
    resolvedCollection = {
      ...collection.value,
      auth,
      headers,
      // The run root keeps its own RAW variable list — the plan walk resolves
      // it; ancestors travel separately, already resolved.
      variables: collection.value.variables ?? [],
    }
  }
  testRunnerStopRef.value = false // when testRunnerStopRef is false, the test runner will start running
  // 固定本轮标签引用；关闭或切换标签后完成回调仍能保存正确的统计。
  const runningTab = ref(tab.value)
  const reportID = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const started = performance.now()
  await testRunnerService.runTests(
    runningTab,
    resolvedCollection,
    {
      ...testRunnerConfig.value,
      stopRef: testRunnerStopRef,
    },
    ancestorPreRequestScripts,
    ancestorTestScripts,
    ancestorVariables
  )
  const meta = runningTab.value.document.testRunnerMeta
  const steps = collectReportSteps(
    runningTab.value.document.iterationResults ?? []
  )
  await saveWorkbenchReport({
    id: reportID,
    kind: "automation",
    name: resolvedCollection.name,
    environmentName: runningTab.value.document.environmentName,
    environmentID: runningTab.value.document.environmentID,
    source: {
      collectionID: runningTab.value.document.collectionID,
      config: { ...runningTab.value.document.config },
    },
    createdAt: startedAt,
    summary: {
      completed: steps.length,
      failed: steps.filter((step) => !step.passed).length,
      elapsedMs: performance.now() - started,
    },
    steps,
    automation: {
      status: runningTab.value.document.status,
      passedTests: meta.passedTests,
      failedTests: meta.failedTests,
      totalTests: meta.totalTests,
    },
  }).catch((error) => console.error("Failed to save automation report", error))
}
const stopTests = () => {
  if (!testRunnerService.stopRun(tab.value.id)) {
    testRunnerStopRef.value = true
  }
  // when we manually stop the test runner, we need to update the tab document with the current state
  tab.value.document.testRunnerMeta = {
    ...tab.value.document.testRunnerMeta,
  }
}
const runAgain = async () => {
  tab.value.document.request = null
  tab.value.document.resultCollection = undefined
  await nextTick()
  resetRunnerState()
  const updatedCollection = await refetchCollectionTree()
  if (updatedCollection) {
    if (checkIfCollectionIsEmpty(updatedCollection)) {
      tabs.closeTab(tab.value.id)
      toast.error(t("collection_runner.empty_collection"))
      return
    }
    tab.value.document.collection = updatedCollection
    reconcileRequestSelection(updatedCollection)
    await nextTick()
    runTests()
  } else {
    tabs.closeTab(tab.value.id)
    toast.error(t("collection_runner.collection_not_found"))
  }
}
/**
 * Re-resolves the stored request selection against a freshly fetched tree —
 * positional IDs shift when the collection is edited, and team `_ref_id`s
 * regenerate on every fetch. Keeps whatever still resolves; if nothing does,
 * falls back to running the full collection and says so.
 */
const reconcileRequestSelection = (collection: HoppCollection) => {
  const stored = tab.value.document.selectedRequestRefIds
  if (!Array.isArray(stored)) return
  const available = new Set(collectRequestIDs(collection))
  const stillValid = stored.filter((id) => available.has(id))
  if (stillValid.length === stored.length) return
  if (stillValid.length === 0) {
    tab.value.document.selectedRequestRefIds = undefined
    toast.info(t("collection_runner.selection_reset"))
    return
  }
  tab.value.document.selectedRequestRefIds = stillValid
  toast.info(t("collection_runner.selection_partially_reset"))
}
const resetRunnerState = () => {
  tab.value.document.testRunnerMeta = {
    failedTests: 0,
    passedTests: 0,
    totalTests: 0,
    totalRequests: 0,
    totalTime: 0,
    completedRequests: 0,
  }
}
onMounted(() => {
  if (!props.readonly && tab.value.document.status === "idle") runTests()
})
function calculateAverageTime(
  totalTime: number,
  completedRequests: number
): number {
  return completedRequests > 0 ? Math.round(totalTime / completedRequests) : 0
}
// Restored iterations carry only their summary; require at least one that
// still has rows, rather than offering an empty report.
const canExport = computed(
  () =>
    props.report ||
    (showResult.value &&
      tab.value.document.status !== "running" &&
      iterationResults.value.some(({ resultCollection }) => resultCollection))
)
const exportResults = async (scope: RunnerExportScope) => {
  if (props.report) return downloadWorkbenchReport(props.report)
  const result = await exportRunnerResults(tab.value.document, scope)
  if (E.isRight(result)) toast.success(t(result.right))
  else toast.error(t(result.left))
}
const testRunnerService = useService(TestRunnerService)
const showTestsType = ref<"all" | "passed" | "failed">("all")
function changeResultFilter(filter: "all" | "passed" | "failed") {
  showTestsType.value = filter
  for (const iteration of iterationResults.value) {
    const requests = resultRequests(iteration.resultCollection)
    const index = requests.findIndex(
      (request) =>
        requestHasResult(request) &&
        (filter === "all" ||
          (filter === "failed"
            ? requestFailed(request)
            : !requestFailed(request)))
    )
    if (index >= 0) {
      tab.value.document.request = requests[index]
      tab.value.document.selectedRequestPath = `${iteration.iteration}::request-folder-0/${index}`
      return
    }
  }
  tab.value.document.request = null
  tab.value.document.selectedRequestPath = undefined
}
// 0 = no pending jump; set to an iteration number to scroll its section into
// view. Reset back to 0 after the result view consumes it so re-selecting the
// same iteration triggers another scroll.
const jumpToIteration = ref(0)
// Keep the document's current iteration in step with the one the user
// navigated to (the "current iteration" export scope reads it).
// `jumpToIteration` is 1-based; `selectedIteration` is an index.
watch(jumpToIteration, (iteration) => {
  if (iteration > 0) tab.value.document.selectedIteration = iteration - 1
})
/** 1-based iteration the user is currently viewing, clamped to the run. */
const viewedIteration = computed(() => {
  const total = iterationResults.value.length
  const current = (tab.value.document.selectedIteration ?? 0) + 1
  return Math.min(Math.max(current, 1), Math.max(total, 1))
})
const jumpTo = (iteration: number) => {
  jumpToIteration.value = Math.min(
    Math.max(iteration, 1),
    iterationResults.value.length
  )
}
const onIterationSelect = (event: Event) => {
  jumpTo(Number((event.target as HTMLSelectElement).value))
}
// Scroll position drives the counter, so it always names the iteration on
// screen — not the last one jumped to.
const onVisibleIteration = (iteration: number) => {
  tab.value.document.selectedIteration = iteration - 1
}
type IterationAdapterEntry = {
  iteration: number
  /**
   * `v-for` key in the result view. `HoppSmartTree` reads its adapter only on
   * mount, so the key must change whenever the adapter is rebuilt to force a
   * remount — keying by iteration number alone left the tree on a dead adapter.
   */
  key: string
  adapter: SmartTreeAdapter<CollectionNode>
}
// Cached per iteration so appending one doesn't rebuild the rest and each
// SmartTree keeps its expansion state; an entry is rebuilt only when the
// backing iteration-result object is replaced.
const adapterCache = new Map<
  number,
  {
    source: TestRunnerIterationResult
    entry: IterationAdapterEntry
  }
>()
let adapterBuildCount = 0
const iterationAdapters = computed<IterationAdapterEntry[]>(() =>
  iterationResults.value.map((iterationResult) => {
    const cached = adapterCache.get(iterationResult.iteration)
    if (cached?.source === iterationResult) return cached.entry
    const entry: IterationAdapterEntry = {
      iteration: iterationResult.iteration,
      key: `${iterationResult.iteration}-${++adapterBuildCount}`,
      adapter: new TestRunnerCollectionsAdapter(
        computed(() =>
          iterationResult.resultCollection
            ? [iterationResult.resultCollection]
            : []
        ),
        showTestsType
      ),
    }
    adapterCache.set(iterationResult.iteration, {
      source: iterationResult,
      entry,
    })
    return entry
  })
)
/**
 * refetches the collection tree from the backend
 * @returns collection tree
 */
const refetchCollectionTree = async () => {
  const id = tab.value.document.collectionID
  return id ? getRESTCollectionByRefId(id) : undefined
}
function checkIfCollectionIsEmpty(collection: HoppCollection): boolean {
  // Check if the collection has requests or if any child collection is non-empty
  return (
    collection.requests.length === 0 &&
    collection.folders.every((folder) => checkIfCollectionIsEmpty(folder))
  )
}
</script>
