<template>
  <HoppSmartModal
    v-if="!autoRun || collectionLoadFailed || autoRunFailed"
    dialog
    :title="
      settingsPlan
        ? `${t('workbench_schedule.settings')} · ${settingsPlan.name}`
        : t('collection_runner.run_collection')
    "
    :full-width-body="true"
    :styles="
      settingsPlan
        ? 'sm:max-w-2xl'
        : 'sm:max-w-6xl xl:max-w-7xl 2xl:max-w-[80vw]'
    "
    @close="!savingSettings && closeModal()"
  >
    <template #body>
      <div
        class="flex min-w-0 w-full flex-col bg-primary"
        :class="{
          'lg:flex-row lg:h-[calc(60vh_-_2.0625rem)] lg:min-h-0': !settingsPlan,
        }"
        :inert="savingSettings"
        :aria-busy="savingSettings"
      >
        <div
          class="flex-1 min-w-0 p-4 overflow-y-auto border-divider"
          :class="{ 'lg:border-r': !settingsPlan }"
        >
          <section>
            <h4 class="font-semibold text-secondaryDark">
              {{ t("collection_runner.run_config") }}
            </h4>
            <div class="mt-4">
              <HoppSmartInput
                v-model="config.iterations as any"
                type="number"
                :label="t('collection_runner.iterations')"
                :disabled="!!config.dataset"
                class="!rounded-r-none !border-r-0"
                :class="{ 'border-red-500': config.iterations < 1 }"
                input-styles="floating-input !rounded-r-none !border-r-0"
              >
                <template #button>
                  <span
                    class="px-4 py-2 font-semibold border rounded-r bg-primaryLight border-divider text-secondaryLight"
                  >
                    {{
                      Number(config.iterations) === 1
                        ? t("collection_runner.time")
                        : t("collection_runner.times")
                    }}
                  </span>
                </template>
              </HoppSmartInput>
              <p v-if="config.iterations < 1" class="text-xs text-red-500 mt-1">
                {{ t("collection_runner.invalid_iterations") }}
              </p>
              <p
                v-else-if="config.dataset"
                class="text-xs text-secondaryLight mt-1"
              >
                {{ t("collection_runner.iterations_locked_to_dataset") }}
              </p>
            </div>
          </section>

          <section v-if="!settingsPlan" class="mt-6">
            <h4 class="font-semibold text-secondaryDark">
              {{ t("collection_runner.data_feed") }}
            </h4>
            <template v-if="config.dataset">
              <div
                class="mt-4 p-4 rounded border border-divider bg-primaryLight"
              >
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-secondaryDark">
                    {{ config.dataset.fileName }}
                  </span>
                  <span class="text-secondaryLight">•</span>
                  <span class="font-semibold text-secondaryLight uppercase">
                    {{ config.dataset.type }}
                  </span>
                  <span class="text-secondaryLight">•</span>
                  <span class="text-accent">
                    {{
                      t(
                        config.dataset.rows.length === 1
                          ? "collection_runner.dataset_row"
                          : "collection_runner.dataset_rows",
                        { count: config.dataset.rows.length }
                      )
                    }}
                  </span>
                  <span class="flex-1"></span>
                  <HoppButtonSecondary
                    v-tippy="{ theme: 'tooltip' }"
                    :title="t('collection_runner.data_preview')"
                    :icon="IconEye"
                    outline
                    @click="showDataPreview = true"
                  />
                  <HoppButtonSecondary
                    v-tippy="{ theme: 'tooltip' }"
                    :title="t('collection_runner.remove_file')"
                    :icon="IconTrash"
                    outline
                    @click="removeDataset"
                  />
                </div>
                <p class="mt-2 text-accent">
                  {{
                    t("collection_runner.dataset_iterations_info", {
                      rows: config.dataset.rows.length,
                      total: config.iterations,
                    })
                  }}
                </p>
              </div>
            </template>
            <template v-else>
              <p class="mt-1 text-secondaryLight">
                {{ t("collection_runner.data_feed_help") }}
              </p>
              <div
                class="flex flex-col mt-3 border border-dashed rounded border-dividerDark"
              >
                <input
                  ref="dataFileInput"
                  type="file"
                  class="p-4 cursor-pointer transition file:transition file:cursor-pointer text-secondary hover:text-secondaryDark file:mr-2 file:py-2 file:px-4 file:rounded file:border-0 file:text-secondary hover:file:text-secondaryDark file:bg-primaryLight hover:file:bg-primaryDark"
                  accept=".csv,.json,text/csv,application/json"
                  :aria-label="t('collection_runner.select_data_file')"
                  @change="handleDatasetFile"
                />
              </div>
            </template>
          </section>

          <section class="mt-6">
            <div>
              <!-- TODO: fix input component types. so that it accepts number -->
              <HoppSmartInput
                v-model="config.delay as any"
                type="number"
                :label="t('collection_runner.delay')"
                class="!rounded-r-none !border-r-0"
                :class="{ 'border-red-500': config.delay < 0 }"
                input-styles="floating-input !rounded-r-none !border-r-0"
              >
                <template #button>
                  <span
                    class="px-4 py-2 font-semibold border rounded-r bg-primaryLight border-divider text-secondaryLight"
                  >
                    ms
                  </span>
                </template>
              </HoppSmartInput>
              <p v-if="config.delay < 0" class="text-xs text-red-500 mt-1">
                {{ t("collection_runner.negative_delay") }}
              </p>
            </div>
          </section>

          <section class="mt-6">
            <span class="text-xs text-secondaryLight">
              {{ t("collection_runner.advanced_settings") }}
            </span>

            <div class="flex flex-col gap-4 mt-4 items-start">
              <WorkbenchToggle
                class="pr-2"
                :on="config.stopOnError"
                @change="config.stopOnError = !config.stopOnError"
              >
                <span>
                  {{ t("collection_runner.stop_on_error") }}
                </span>
              </WorkbenchToggle>

              <WorkbenchToggle
                class="pr-2"
                :on="config.persistResponses"
                @change="config.persistResponses = !config.persistResponses"
              >
                <span>
                  {{ t("collection_runner.persist_responses") }}
                </span>
              </WorkbenchToggle>

              <WorkbenchToggle
                class="pr-2"
                :on="config.executeScripts !== false"
                @change="config.executeScripts = config.executeScripts === false"
              >
                <span>
                  {{ t("collection_runner.execute_scripts") }}
                </span>
              </WorkbenchToggle>
            </div>
          </section>
          <section
            v-if="settingsPlan"
            class="mt-6 border-t border-divider pt-5"
          >
            <h4
              v-if="schedulingAvailable"
              class="mb-4 font-semibold text-secondaryDark"
            >
              {{ t("workbench_schedule.title") }}
            </h4>
            <AutomationScheduleEditor
              ref="settingsEditor"
              embedded
              :plan="settingsPlan"
              :schedule="schedule"
            />
          </section>
        </div>

        <div
          v-if="!settingsPlan"
          class="flex flex-col flex-1 min-w-0 min-h-0 p-4"
        >
          <div class="flex items-center justify-between flex-shrink-0">
            <h4 class="font-semibold text-secondaryDark">
              {{ t("collection_runner.run_sequence") }}
            </h4>
            <div v-if="collectionTree" class="flex items-center gap-2">
              <span class="text-xs text-secondaryLight">
                {{
                  t("collection_runner.selected_requests_count", {
                    selected: selectedRequestIDs.size,
                    total: allRequestIDs.length,
                  })
                }}
              </span>
              <HoppButtonSecondary
                :label="
                  allSelected
                    ? t('collection_runner.deselect_all')
                    : t('collection_runner.select_all')
                "
                outline
                filled
                @click="toggleSelectAll"
              />
              <HoppButtonSecondary
                :label="t('collection_runner.reset_run_order')"
                :disabled="requestOrder.length === 0"
                outline
                filled
                @click="resetRunOrder"
              />
            </div>
          </div>

          <div v-if="loadingCollection" class="flex justify-center mt-4 py-4">
            <HoppSmartSpinner />
          </div>
          <div
            v-else-if="collectionLoadFailed"
            class="flex items-center justify-between gap-4 mt-4 p-4 rounded border border-divider bg-primaryLight"
          >
            <span class="text-secondaryLight">
              {{ t("collection_runner.collection_load_failed") }}
            </span>
            <HoppButtonSecondary
              :label="t('action.retry')"
              outline
              filled
              @click="loadCollectionTree"
            />
          </div>
          <template v-else-if="collectionTree">
            <HoppSmartInput
              v-model="requestFilter"
              class="mt-4 flex-shrink-0"
              :placeholder="t('collection_runner.filter_requests')"
            />
            <div
              class="flex-1 min-h-0 mt-2 max-h-64 lg:max-h-none overflow-auto rounded border border-divider bg-primaryLight px-3 py-2"
            >
              <HttpTestRunnerRequestSelector
                :collection="collectionTree"
                :selected-i-ds="selectedRequestIDs"
                :order="requestOrder"
                :filter="requestFilter"
                @toggle="toggleRequestSelection"
                @reorder="requestOrder = $event"
              />
            </div>
          </template>
          <p
            v-if="collectionTree && selectedRequestIDs.size === 0"
            class="flex-shrink-0 text-xs text-red-500 mt-1"
          >
            {{ t("collection_runner.no_requests_selected") }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex space-x-2">
        <HoppButtonSecondary
          v-if="settingsPlan"
          :label="t('action.save')"
          :disabled="savingSettings || loadingCollection"
          :loading="savingSettings"
          outline
          @click="saveSettings()"
        />
        <HoppButtonPrimary
          v-if="!settingsPlan"
          :label="t('test.run')"
          :disabled="
            savingSettings ||
            config.delay < 0 ||
            config.iterations < 1 ||
            !collectionTree ||
            selectedRequestIDs.size === 0
          "
          :loading="loadingCollection || savingSettings"
          :icon="IconPlay"
          outline
          @click="runTests"
        />
        <HoppButtonSecondary
          :label="`${t('action.close')}`"
          :disabled="savingSettings"
          outline
          filled
          @click="closeModal"
        />
      </div>
    </template>
  </HoppSmartModal>

  <HoppSmartModal
    v-if="showDataPreview && config.dataset"
    dialog
    :title="t('collection_runner.data_preview')"
    @close="showDataPreview = false"
  >
    <template #body>
      <div class="p-4">
        <div class="flex items-center gap-2 mb-4">
          <span class="font-semibold text-secondaryDark">
            {{ config.dataset.fileName }}
          </span>
          <span class="text-secondaryLight">•</span>
          <span class="font-semibold text-secondaryLight uppercase">
            {{ config.dataset.type }}
          </span>
          <span class="text-secondaryLight">•</span>
          <span class="text-accent">
            {{
              t(
                config.dataset.rows.length === 1
                  ? "collection_runner.dataset_row"
                  : "collection_runner.dataset_rows",
                { count: config.dataset.rows.length }
              )
            }}
          </span>
        </div>
        <div class="overflow-auto rounded border border-divider">
          <table class="w-full text-left border-collapse">
            <thead class="bg-primaryLight">
              <tr>
                <th
                  class="px-3 py-2 text-tiny font-semibold text-secondaryLight border-b border-divider"
                >
                  #
                </th>
                <th
                  v-for="column in datasetColumns"
                  :key="column"
                  class="px-3 py-2 text-tiny font-semibold text-secondaryDark border-b border-divider whitespace-nowrap"
                >
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in datasetPreviewRows"
                :key="rowIndex"
                class="border-b border-dividerLight last:border-0"
              >
                <td class="px-3 py-2 text-tiny text-secondaryLight">
                  {{ rowIndex + 1 }}
                </td>
                <td
                  v-for="column in datasetColumns"
                  :key="column"
                  class="px-3 py-2 text-secondaryDark align-top"
                >
                  {{ row[column] ?? "" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p
          v-if="datasetPreviewTruncated"
          class="mt-2 text-tiny text-secondaryLight"
        >
          {{
            t("collection_runner.dataset_preview_truncated", {
              count: DATASET_PREVIEW_ROW_CAP,
            })
          }}
        </p>
      </div>
    </template>
    <template #footer>
      <HoppButtonSecondary
        :label="`${t('action.close')}`"
        outline
        filled
        @click="showDataPreview = false"
      />
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { useRouter } from "vue-router"
import { computed, onMounted, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import AutomationScheduleEditor from "~/components/workbench/AutomationSchedule.vue"
import {
  workbenchSchedulesAvailable,
  type AutomationSchedule,
  type SavedWorkbenchPlan,
} from "~/helpers/workbench-mcp"

import { HoppCollection } from "@apirequest/data"
import { useService } from "dioc/vue"
import { useToast } from "~/composables/toast"
import { TestRunnerConfig } from "~/helpers/tab/document"
import { parseDatasetFile } from "~/helpers/runner/dataset"
import { collectRequestIDs } from "~/helpers/runner/selection"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import IconEye from "~icons/lucide/eye"
import IconPlay from "~icons/lucide/play"
import IconTrash from "~icons/lucide/trash"

import * as E from "fp-ts/Either"

import { cloneDeep } from "lodash-es"

import { getRESTCollectionByRefId } from "~/newstore/collections"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"

const t = useI18n()
const toast = useToast()
const tabs = useService(WorkspaceTabsService)

const loadingCollection = ref(false)
const autoRunFailed = ref(false)
const schedulingAvailable = workbenchSchedulesAvailable()
const savingSettings = ref(false)
const settingsEditor = ref<InstanceType<typeof AutomationScheduleEditor>>()

export type CollectionRunnerData =
  | {
      type: "my-collections"
      // for my-collections it's actually _ref_id
      collectionID: string
      collectionIndex?: string
    }
  | {
      type: "team-collections"
      collectionID: string
      inheritedProperties?: HoppInheritedProperty
    }

const props = defineProps<{
  sameTab?: boolean
  collectionRunnerData: CollectionRunnerData
  prevConfig?: Partial<TestRunnerConfig>
  /**
   * The previous run's selection, in run order — carried over so a new run
   * keeps the sequence the user arranged.
   */
  prevSelection?: string[]
  initialSelection?: string[]
  settingsPlan?: SavedWorkbenchPlan
  schedule?: AutomationSchedule
  autoRun?: boolean
}>()

const emit = defineEmits<{
  (e: "hide-modal"): void
  (e: "settings-saved"): void
}>()

const showDataPreview = ref(false)
const dataFileInput = ref<HTMLInputElement | null>(null)

const collectionTree = ref<HoppCollection | null>(null)
const selectedRequestIDs = ref<Set<string>>(new Set())
const requestFilter = ref("")

// Explicit run order as selection IDs. Empty means "natural collection
// order", which is also what Reset restores.
const requestOrder = ref<string[]>([])

const resetRunOrder = () => {
  requestOrder.value = []
}

const allRequestIDs = computed(() =>
  collectionTree.value ? collectRequestIDs(collectionTree.value) : []
)

const allSelected = computed(
  () =>
    allRequestIDs.value.length > 0 &&
    selectedRequestIDs.value.size === allRequestIDs.value.length
)

// Same rule the selector displays by: the user's explicit order first, then
// anything it doesn't mention in natural order.
const orderedRequestIDs = computed(() => {
  if (requestOrder.value.length === 0) return allRequestIDs.value

  const available = new Set(allRequestIDs.value)
  const ordered = requestOrder.value.filter((id) => available.has(id))
  const seen = new Set(ordered)

  return [...ordered, ...allRequestIDs.value.filter((id) => !seen.has(id))]
})

// Receives a whole subtree at once, so a folder toggle rebuilds the Set once.
const toggleRequestSelection = (ids: string[], select: boolean) => {
  const next = new Set(selectedRequestIDs.value)
  ids.forEach((id) => (select ? next.add(id) : next.delete(id)))
  selectedRequestIDs.value = next
}

const toggleSelectAll = () => {
  selectedRequestIDs.value = allSelected.value
    ? new Set()
    : new Set(allRequestIDs.value)
}

const config = ref<TestRunnerConfig>({
  iterations: 1,
  delay: 500,
  stopOnError: false,
  persistResponses: true,
  keepVariableValues: true,
  executeScripts: true,
})
const saveSettings = async () => {
  if (!props.settingsPlan || savingSettings.value || !settingsEditor.value)
    return false
  const iterations = Number(config.value.iterations)
  const delay = Number(config.value.delay)
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 1000 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 60000
  ) {
    toast.error(t("workbench_schedule.invalid_config"))
    return false
  }
  savingSettings.value = true
  try {
    const saved = await settingsEditor.value.save({
      iterations,
      delay,
      stopOnError: config.value.stopOnError,
      persistResponses: config.value.persistResponses,
      keepVariableValues: config.value.keepVariableValues,
      executeScripts: config.value.executeScripts !== false,
    })
    if (saved) {
      emit("settings-saved")
      toast.success(t("workbench_schedule.saved"))
    }
    return saved
  } finally {
    savingSettings.value = false
  }
}

// Cap the data-preview so a large dataset doesn't stringify thousands of rows
// into the DOM on every render. Computed once, and only while the preview is open.
const DATASET_PREVIEW_ROW_CAP = 50

const datasetPreviewRows = computed(() =>
  (config.value.dataset?.rows ?? []).slice(0, DATASET_PREVIEW_ROW_CAP)
)

// Union of keys across the previewed rows — JSON rows need not be uniform.
const datasetColumns = computed(() => {
  const columns = new Set<string>()
  datasetPreviewRows.value.forEach((row) =>
    Object.keys(row).forEach((key) => columns.add(key))
  )
  return [...columns]
})

const datasetPreviewTruncated = computed(
  () => (config.value.dataset?.rows.length ?? 0) > DATASET_PREVIEW_ROW_CAP
)

// The tree fetch can fail (a network call for team collections) and the run
// controls key off `collectionTree` — a failure must stay recoverable.
const collectionLoadFailed = ref(false)

const loadCollectionTree = async () => {
  collectionLoadFailed.value = false

  const tree = await getCollectionTree(
    props.collectionRunnerData.type,
    props.collectionRunnerData.collectionID
  )

  if (!tree) {
    collectionLoadFailed.value = true
    return
  }

  collectionTree.value = tree as HoppCollection

  const available = collectRequestIDs(collectionTree.value)

  // Carry over the previous run's selection, dropping anything that no
  // longer exists in the tree; everything selected otherwise.
  const carriedOver = (
    props.initialSelection ??
    props.prevSelection ??
    []
  ).filter((id) => available.includes(id))

  // 单接口计划显式传入执行范围；请求在加载前被删除时，保持空选区。
  if (carriedOver.length > 0 || props.initialSelection) {
    selectedRequestIDs.value = new Set(carriedOver)

    // Only install an explicit order when the previous run actually had one:
    // a selection in natural order is just "which requests", and treating it
    // as an ordering would pin re-checked requests to the end of the run.
    const naturalPosition = new Map(available.map((id, index) => [id, index]))
    const isNaturalOrder = carriedOver.every(
      (id, index) =>
        index === 0 ||
        naturalPosition.get(id)! > naturalPosition.get(carriedOver[index - 1])!
    )

    requestOrder.value = isNaturalOrder ? [] : carriedOver
    return
  }

  selectedRequestIDs.value = new Set(available)
  requestOrder.value = []
}

onMounted(async () => {
  if (props.prevConfig) {
    config.value = { ...config.value, ...props.prevConfig }
  }

  if (props.settingsPlan) return
  await loadCollectionTree()
  if (props.autoRun && collectionTree.value && !(await runTests()))
    autoRunFailed.value = true
})

const resetFileInputs = () => {
  if (dataFileInput.value) dataFileInput.value.value = ""
}

const removeDataset = () => {
  config.value.dataset = undefined
  config.value.iterations = 1
  showDataPreview.value = false
  resetFileInputs()
}

// The parsed rows are stored on the (persisted) tab document, which shares
// the ~5MB localStorage quota with every other REST tab — and CSV rows
// expand when re-serialized as keyed JSON objects. 2MB (roughly 20-40k
// rows, i.e. iterations) keeps the worst case comfortably inside the quota.
const DATA_FILE_SIZE_LIMIT_MB = 2

const handleDatasetFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) return

  if (file.size > DATA_FILE_SIZE_LIMIT_MB * 1024 * 1024) {
    toast.error(
      t("collection_runner.data_file_size_limit_exceeded", {
        sizeLimit: DATA_FILE_SIZE_LIMIT_MB,
      })
    )
    resetFileInputs()
    return
  }

  const result = await parseDatasetFile(file)

  if (E.isLeft(result)) {
    toast.error(`${t("collection_runner.invalid_data_file")}: ${result.left}`)
    resetFileInputs()
    return
  }

  if (result.right.rows.length === 0) {
    toast.error(t("collection_runner.empty_data_file"))
    resetFileInputs()
    return
  }

  // What persists is the PARSED rows, and a wide CSV balloons once column
  // names repeat per row — so the raw-file gate above isn't enough; gate the
  // serialized size the tab state will actually carry.
  if (
    JSON.stringify(result.right.rows).length >
    DATA_FILE_SIZE_LIMIT_MB * 1024 * 1024
  ) {
    toast.error(
      t("collection_runner.data_file_size_limit_exceeded", {
        sizeLimit: DATA_FILE_SIZE_LIMIT_MB,
      })
    )
    resetFileInputs()
    return
  }

  config.value.dataset = result.right
  config.value.iterations = result.right.rows.length
  resetFileInputs()
}

const router = useRouter()
const runTests = async () => {
  if (savingSettings.value) return
  const iterations = Number(config.value.iterations)
  const delay = Number(config.value.delay)

  if (!Number.isFinite(iterations) || iterations < 1) {
    toast.error(t("collection_runner.invalid_iterations"))
    return
  }

  if (!Number.isFinite(delay) || delay < 0) {
    toast.error(t("collection_runner.negative_delay"))
    return
  }

  const tree =
    collectionTree.value ??
    ((await getCollectionTree(
      props.collectionRunnerData.type,
      props.collectionRunnerData.collectionID
    )) as HoppCollection | null)

  if (!tree) {
    toast.error(t("collection_runner.collection_not_found"))
    return
  }

  if (checkIfCollectionIsEmpty(tree)) {
    toast.error(t("collection_runner.empty_collection"))
    return
  }

  if (selectedRequestIDs.value.size === 0) {
    toast.error(t("collection_runner.no_requests_selected"))
    return
  }

  // `undefined` means "everything, in collection order"; otherwise send the
  // explicit run order, which the runner executes in exactly this order.
  const selectedRequestRefIds =
    allSelected.value && requestOrder.value.length === 0
      ? undefined
      : orderedRequestIDs.value.filter((id) => selectedRequestIDs.value.has(id))

  let tabIdToClose = null
  if (props.sameTab) tabIdToClose = cloneDeep(tabs.currentTabID.value)
  const runTab = tabs.createNewTab({
    type: "test-runner",
    collectionType: props.collectionRunnerData.type,
    collectionID: props.collectionRunnerData.collectionID,
    collection: tree,
    isDirty: false,
    config: {
      ...config.value,
      iterations,
      delay,
    },
    selectedRequestRefIds,
    status: "idle",
    request: null,
    testRunnerMeta: {
      completedRequests: 0,
      totalRequests: 0,
      totalTime: 0,
      failedTests: 0,
      passedTests: 0,
      totalTests: 0,
    },
    inheritedProperties:
      "inheritedProperties" in props.collectionRunnerData
        ? props.collectionRunnerData.inheritedProperties
        : undefined,
  })

  if (tabIdToClose) tabs.closeTab(tabIdToClose)

  emit("hide-modal")
  await router.push({ path: "/automation", query: { run: runTab.id } })
  return true
}

/**
 * Fetches the collection tree from the backend
 * @param collection
 * @returns collection tree
 */
const getCollectionTree = async (
  _type: CollectionRunnerData["type"],
  collectionID: string
) => (collectionID ? getRESTCollectionByRefId(collectionID) : undefined)

function checkIfCollectionIsEmpty(collection: HoppCollection): boolean {
  // Check if the collection has requests or if any child collection is non-empty
  return (
    collection.requests.length === 0 &&
    collection.folders.every((folder) => checkIfCollectionIsEmpty(folder))
  )
}

const closeModal = () => {
  emit("hide-modal")
}
</script>
