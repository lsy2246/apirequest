<template>
  <div>
    <div
      class="sticky top-0 z-10 flex flex-shrink-0 flex-col overflow-x-auto border-b border-dividerLight bg-primary"
    >
      <div class="flex">
        <input
          v-model="filterText"
          type="search"
          autocomplete="off"
          class="flex w-full bg-transparent px-4 py-2 h-8"
          :placeholder="`${t('action.search')}`"
        />
        <div class="flex">
          <tippy interactive trigger="click" theme="popover">
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip' }"
              :title="t('action.filter')"
              :icon="IconFilter"
            />
            <template #content="{ hide }">
              <div ref="tippyActions" class="flex flex-col focus:outline-none">
                <div class="pb-2 pl-4 text-tiny text-secondaryLight">
                  {{ t("action.filter") }}
                </div>
                <HoppSmartRadioGroup
                  v-model="filterSelection"
                  :radios="filters"
                  @update:model-value="hide()"
                />
                <hr />
                <div class="pb-2 pl-4 text-tiny text-secondaryLight">
                  {{ t("action.group_by") }}
                </div>
                <HoppSmartRadioGroup
                  v-model="groupSelection"
                  :radios="groups"
                  @update:model-value="hide()"
                />
              </div>
            </template>
          </tippy>
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            data-testid="clear_history"
            :disabled="
              history.length === 0 ||
              !isHistoryStoreEnabled ||
              isFetchingHistoryStoreStatus
            "
            :icon="IconTrash2"
            :title="t('action.clear_all')"
            @click="confirmRemove = true"
          />
        </div>
      </div>
    </div>
    <WorkbenchState
      v-if="isFetchingHistoryStoreStatus || loadingPage"
      kind="loading"
      :title="t('state.loading')"
    />
    <WorkbenchState
      v-else-if="hasErrorFetchingHistoryStoreStatus || pageError"
      kind="error"
      :title="t('history.load_failed')"
      :description="t('history.load_failed_description')"
    >
      <HoppButtonSecondary
        :label="t('action.retry')"
        outline
        @click="retryHistory"
      />
    </WorkbenchState>
    <p
      v-else-if="!isHistoryStoreEnabled"
      role="status"
      class="p-4 text-secondaryLight"
    >
      {{ t("history.disabled") }}
    </p>
    <div
      v-if="!isFetchingHistoryStoreStatus && history.length > 0"
      class="flex flex-col"
    >
      <details
        v-for="(
          filteredHistoryGroup, filteredHistoryGroupIndex
        ) in filteredHistoryGroups"
        :key="`filteredHistoryGroup-${filteredHistoryGroupIndex}`"
        class="flex flex-col"
        open
      >
        <summary
          class="group flex min-w-0 flex-1 cursor-pointer items-center justify-between text-tiny text-secondaryLight transition focus:outline-none"
        >
          <span
            class="inline-flex items-center justify-center truncate px-4 py-2 transition group-hover:text-secondary"
          >
            <icon-lucide-chevron-right
              class="indicator mr-2 flex flex-shrink-0"
            />
            <span
              :class="[
                { 'capitalize-first': groupSelection === 'TIME' },
                'truncate',
              ]"
            >
              {{ filteredHistoryGroupIndex }}
            </span>
          </span>
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :icon="IconTrash"
            color="red"
            :title="t('action.remove')"
            class="hidden group-hover:inline-flex group-focus-within:inline-flex"
            @click="deleteBatchHistoryEntry(filteredHistoryGroup)"
          />
        </summary>
        <div
          v-for="(entry, index) in filteredHistoryGroup"
          :key="entry.entry.id ?? `entry-${index}`"
          class="flex min-w-0 items-start"
        >
          <HistoryRestCard
            v-if="isRESTEntry(entry.entry)"
            :entry="entry.entry"
            :show-more="showMore"
            class="min-w-0 flex-1"
            @toggle-star="toggleStar(entry.entry)"
            @delete-entry="deleteHistory(entry.entry)"
            @use-entry="openHistory(toRaw(entry.entry))"
            @add-to-collection="addToCollection(entry.entry)"
          />
          <HistoryGraphqlMergedCard
            v-else
            :entry="entry.entry"
            :show-more="showMore"
            class="min-w-0 flex-1"
            @toggle-star="toggleStar(entry.entry)"
            @delete-entry="deleteHistory(entry.entry)"
            @use-entry="openHistory(toRaw(entry.entry))"
          />
          <HoppButtonSecondary
            v-if="showResultActions && entry.entry.id"
            :label="t('history_results.view')"
            class="shrink-0"
            @click="selectedResultId = entry.entry.id"
          />
        </div>
      </details>
    </div>
    <WorkbenchState
      v-if="
        isHistoryStoreEnabled &&
        !isFetchingHistoryStoreStatus &&
        !loadingPage &&
        !pageError &&
        !hasErrorFetchingHistoryStoreStatus &&
        history.length === 0 &&
        !hasFilters
      "
      :title="t('empty.history')"
    />
    <WorkbenchState
      v-else-if="
        !isFetchingHistoryStoreStatus &&
        !loadingPage &&
        !pageError &&
        !hasErrorFetchingHistoryStoreStatus &&
        isHistoryStoreEnabled &&
        (history.length > 0 || hasFilters) &&
        filteredHistory.length === 0
      "
      :title="`${t('state.nothing_found')} ‟${filterText || filterSelection}”`"
      :icon="IconSearch"
    >
      <template #default>
        <HoppButtonSecondary
          :label="t('action.clear')"
          outline
          @click="
            () => {
              filterText = ''
              filterSelection = 'ALL'
            }
          "
        />
      </template>
    </WorkbenchState>
    <div
      v-if="platform.localDesktop && (hasNextPage || currentPage > 0)"
      class="flex items-center justify-center gap-3 p-3"
    >
      <HoppButtonSecondary
        data-testid="history-previous-page"
        :label="t('workbench.previous_page')"
        :disabled="currentPage === 0 || loadingPage"
        @click="goBack"
      />
      <span class="text-tiny text-secondaryLight">{{ currentPage + 1 }}</span>
      <HoppButtonSecondary
        data-testid="history-next-page"
        :label="t('workbench.next_page')"
        :disabled="!hasNextPage || loadingPage"
        @click="goForward"
      />
    </div>
    <HistoryResultDialog
      v-if="selectedResultId"
      :key="selectedResultId"
      :history-id="selectedResultId"
      @close="selectedResultId = undefined"
    />
    <HoppSmartConfirmModal
      :show="confirmRemove"
      :title="`${t('confirm.remove_history')}`"
      @hide-modal="confirmRemove = false"
      @resolve="clearHistory"
    />
  </div>
</template>

<script setup lang="ts">
import { relativeTime } from "~/helpers/ui-states"
import { useFullI18n } from "~/composables/i18n"
import { toRaw } from "vue"
import { refreshWebHistory } from "~/helpers/refresh-history"
import WorkbenchState from "~/components/workbench/State.vue"
import IconSearch from "~icons/lucide/search"
import IconFilter from "~icons/lucide/filter"
import IconTrash from "~icons/lucide/trash"
import IconTrash2 from "~icons/lucide/trash-2"
import {
  isHistoryStoreEnabled,
  isFetchingHistoryStoreStatus,
  hasErrorFetchingHistoryStoreStatus,
} from "~/lib/sync/history/status"
import HistoryGraphqlMergedCard from "./graphql/MergedCard.vue"
import HistoryRestCard from "./rest/Card.vue"
import HistoryResultDialog from "./ResultDialog.vue"
import { useI18n } from "@composables/i18n"
import { useReadonlyStream } from "@composables/stream"
import { useToast } from "@composables/toast"
import {
  HoppGQLRequest,
  HoppRESTRequest,
  makeGQLRequest,
} from "@apirequest/data"
import { useNow, watchDebounced } from "@vueuse/core"
import { combineLatest, map } from "rxjs"
import * as A from "fp-ts/Array"
import { pipe } from "fp-ts/function"
import { escapeRegExp, filter, groupBy, isEqual } from "lodash-es"
import { computed, ref, Ref, watch } from "vue"
import { useRouter } from "vue-router"
import {
  clearGraphqlHistory,
  clearRESTHistory,
  deleteGraphqlHistoryEntry,
  deleteRESTHistoryEntry,
  GQLHistoryEntry,
  graphqlHistory$,
  restHistory$,
  RESTHistoryEntry,
  toggleGraphqlHistoryEntryStar,
  toggleRESTHistoryEntryStar,
} from "~/newstore/history"

import { useService } from "dioc/vue"
import { defineActionHandler, invokeAction } from "~/helpers/actions"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { isRESTRequest } from "~/helpers/request-type"
import { platform } from "~/platform"
import {
  nativeHistoryRevision,
  queryNativeHistory,
  type HistoryCursor,
} from "~/lib/sync/history/native"

type HistoryEntry = GQLHistoryEntry | RESTHistoryEntry

type TimedHistoryEntry = {
  entry: HistoryEntry
  timeAgo: Ref<string>
}

const toast = useToast()
const t = useI18n()
const { locale } = useFullI18n()
const now = useNow({ interval: 60000 })

const filterText = ref("")
const hasFilters = computed(
  () => !!filterText.value.trim() || filterSelection.value !== "ALL"
)
const showMore = ref(false)
const confirmRemove = ref(false)
const selectedResultId = ref<string>()
const showResultActions = computed(
  () =>
    window.__APIREQUEST_NATIVE__ ||
    platform.auth.localSessionState?.value === "ready"
)

const mergedHistory$ = combineLatest([restHistory$, graphqlHistory$]).pipe(
  map(([rest, gql]) => {
    const merged = [...rest, ...gql] as HistoryEntry[]
    return merged.sort(
      (a, b) => (b.updatedOn?.getTime() ?? 0) - (a.updatedOn?.getTime() ?? 0)
    )
  })
)

const recentHistory = useReadonlyStream<HistoryEntry[]>(mergedHistory$, [])
const pageEntries = ref<HistoryEntry[]>([])
const history = computed(() =>
  platform.localDesktop ? pageEntries.value : recentHistory.value
)

const deepCheckForRegex = (value: unknown, regExp: RegExp): boolean => {
  if (value === null || value === undefined) return false

  if (typeof value === "string") return regExp.test(value)
  if (typeof value === "number") return regExp.test(value.toString())

  if (typeof value === "object")
    return Object.values(value).some((input) =>
      deepCheckForRegex(input, regExp)
    )
  if (Array.isArray(value))
    return value.some((input) => deepCheckForRegex(input, regExp))

  return false
}

const filteredHistory = computed(() =>
  pipe(
    history.value as HistoryEntry[],
    A.filter(
      (
        input
      ): input is HistoryEntry & {
        updatedOn: NonNullable<HistoryEntry["updatedOn"]>
      } => {
        return (
          !!input.updatedOn &&
          (platform.localDesktop ||
            filterText.value.length === 0 ||
            deepCheckForRegex(
              input,
              new RegExp(escapeRegExp(filterText.value), "gi")
            ))
        )
      }
    ),
    A.map((entry): TimedHistoryEntry => ({
      entry,
      timeAgo: computed(() =>
        relativeTime(entry.updatedOn, now.value, locale.value)
      ),
    }))
  )
)

const filters = computed(() => [
  { value: "ALL" as const, label: t("filter.all") },
  { value: "STARRED" as const, label: t("filter.starred") },
])

type FilterMode = (typeof filters)["value"][number]["value"]

const filterSelection = ref<FilterMode>("ALL")

const cursors = ref<(HistoryCursor | undefined)[]>([undefined])
const currentPage = computed(() => cursors.value.length - 1)
const nextCursor = ref<HistoryCursor | null>(null)
const hasNextPage = computed(() => nextCursor.value !== null)
const loadingPage = ref(false)
const pageError = ref(false)
let pageRequest = 0

async function loadPage() {
  const request = ++pageRequest
  loadingPage.value = true
  pageError.value = false
  try {
    const page = await queryNativeHistory({
      protocol: null,
      before: cursors.value.at(-1),
      search: filterText.value,
      starred: filterSelection.value === "STARRED",
    })
    if (request !== pageRequest) return
    if (page.entries.length === 0 && currentPage.value > 0) {
      cursors.value.pop()
      await loadPage()
      return
    }
    pageEntries.value = page.entries
    nextCursor.value = page.next
  } catch {
    if (request === pageRequest) pageError.value = true
  } finally {
    if (request === pageRequest) loadingPage.value = false
  }
}

async function retryHistory() {
  if (import.meta.env.VITE_WORKBENCH_NATIVE || platform.localDesktop)
    return loadPage()
  return refreshWebHistory?.()
}

function goBack() {
  if (currentPage.value === 0) return
  cursors.value.pop()
  void loadPage()
}

function goForward() {
  if (!nextCursor.value) return
  cursors.value.push(nextCursor.value)
  void loadPage()
}

if (platform.localDesktop) {
  watchDebounced(
    filterText,
    () => {
      cursors.value = [undefined]
      void loadPage()
    },
    { debounce: 180 }
  )
  watch(filterSelection, () => {
    cursors.value = [undefined]
    void loadPage()
  })
  watch(nativeHistoryRevision, loadPage)
  void loadPage()
}

const groups = computed(() => [
  { value: "TIME" as const, label: t("group.time") },
  { value: "URL" as const, label: t("group.url") },
])

type GroupMode = (typeof groups)["value"][number]["value"]

const groupSelection = ref<GroupMode>("TIME")

const filteredHistoryGroups = computed(() =>
  groupBy(
    filter(filteredHistory.value, (input) =>
      filterSelection.value === "STARRED" ? input.entry.star : true
    ),
    (input) =>
      groupSelection.value === "TIME"
        ? input.timeAgo.value
        : getAppropriateURL(input.entry)
  )
)

const isRESTEntry = (entry: HistoryEntry): entry is RESTHistoryEntry =>
  isRESTRequest(entry.request)

const getAppropriateURL = (entry: HistoryEntry) =>
  isRESTRequest(entry.request)
    ? (entry.request as HoppRESTRequest).endpoint
    : (entry.request as HoppGQLRequest).url

const clearHistory = () => {
  clearRESTHistory()
  clearGraphqlHistory()
  toast.success(`${t("state.history_deleted")}`)
}

const tabs = useService(WorkspaceTabsService)
const router = useRouter()

function openHistory(entry: HistoryEntry) {
  useHistory(entry)
  void router.push("/")
}

// Compare the signature fields of two requests. We deliberately exclude:
//   - `responses`  — mutated whenever the tab re-runs the request
//   - `v`, `_ref_id`, `id` — schema/version/persistence metadata, not user intent
//   - `name`, `description` — cosmetic; renaming a tab shouldn't fork it
// Everything that affects the wire payload or runtime behaviour IS compared,
// so two history entries that differ only in (say) preRequestScript are
// recognised as distinct.
const restRequestsMatch = (a: HoppRESTRequest, b: HoppRESTRequest) =>
  a.endpoint === b.endpoint &&
  a.method === b.method &&
  a.preRequestScript === b.preRequestScript &&
  a.testScript === b.testScript &&
  isEqual(a.body, b.body) &&
  isEqual(a.headers, b.headers) &&
  isEqual(a.params, b.params) &&
  isEqual(a.auth, b.auth) &&
  isEqual(a.requestVariables, b.requestVariables)

const gqlRequestsMatch = (a: HoppGQLRequest, b: HoppGQLRequest) =>
  a.url === b.url &&
  a.query === b.query &&
  a.variables === b.variables &&
  a.preRequestScript === b.preRequestScript &&
  a.testScript === b.testScript &&
  isEqual(a.headers, b.headers) &&
  isEqual(a.auth, b.auth)

const useHistory = (entry: HistoryEntry) => {
  if (isRESTRequest(entry.request)) {
    const restEntry = entry.request as HoppRESTRequest

    // Focus an already-open REST tab that still matches the entry's
    // signature, so selecting the same history row does not duplicate tabs.
    //
    // Deliberately skips tabs bound to a collection: history stores the same
    // fields `restRequestsMatch` compares, so an unedited run matches its own
    // originating tab. Focusing that tab would turn a later save into a silent
    // overwrite of the stored request instead of the Save-As the user expects.
    const existing = tabs
      .getTabs()
      .find(
        (t) =>
          t.document.type === "request" &&
          !t.document.saveContext &&
          restRequestsMatch(t.document.request, restEntry)
      )
    if (existing) {
      tabs.setActiveTab(existing.id)
      return
    }

    tabs.createNewTab({
      type: "request",
      request: restEntry,
      isDirty: false,
    })
    return
  }

  // GraphQL entry — normalize via makeGQLRequest so we get schema defaults
  // (responses: {}, version, etc.) regardless of how the entry was stored.
  const gqlEntryRequest = entry.request as HoppGQLRequest
  const gqlRequest = makeGQLRequest({
    name: gqlEntryRequest.name,
    url: gqlEntryRequest.url,
    headers: gqlEntryRequest.headers,
    query: gqlEntryRequest.query,
    variables: gqlEntryRequest.variables,
    auth: gqlEntryRequest.auth,
    description: gqlEntryRequest.description ?? null,
    responses: {},
    preRequestScript: gqlEntryRequest.preRequestScript ?? "",
    testScript: gqlEntryRequest.testScript ?? "",
  })

  const existing = tabs
    .getTabs()
    .find(
      (t) =>
        t.document.type === "gql-request" &&
        !t.document.saveContext &&
        gqlRequestsMatch(t.document.request, gqlEntryRequest)
    )
  if (existing) {
    tabs.setActiveTab(existing.id)
    return
  }

  tabs.createNewTab({
    type: "gql-request",
    request: gqlRequest,
    isDirty: false,
    cursorPosition: 0,
  })
}

const deleteBatchHistoryEntry = (entries: TimedHistoryEntry[]) => {
  entries.forEach(({ entry }) => {
    if (isRESTRequest(entry.request)) {
      deleteRESTHistoryEntry(entry as RESTHistoryEntry)
    } else {
      deleteGraphqlHistoryEntry(entry as GQLHistoryEntry)
    }
  })
  toast.success(`${t("state.deleted")}`)
}

const deleteHistory = (entry: HistoryEntry) => {
  if (isRESTRequest(entry.request)) {
    deleteRESTHistoryEntry(entry as RESTHistoryEntry)
  } else {
    deleteGraphqlHistoryEntry(entry as GQLHistoryEntry)
  }
  toast.success(`${t("state.deleted")}`)
}

const addToCollection = (entry: HistoryEntry) => {
  // Only REST entries support add-to-collection from history today — the GQL
  // card doesn't emit `add-to-collection`, so this is a no-op for GQL even
  // in unified-workspace mode. Wiring GQL save-as is its own follow-up.
  if (isRESTRequest(entry.request)) {
    invokeAction("request.save-as", {
      requestType: "rest",
      request: entry.request as HoppRESTRequest,
    })
  }
}

const toggleStar = (entry: HistoryEntry) => {
  if (isRESTRequest(entry.request)) {
    toggleRESTHistoryEntryStar(entry as RESTHistoryEntry)
  } else {
    toggleGraphqlHistoryEntryStar(entry as GQLHistoryEntry)
  }
}

defineActionHandler("history.clear", () => {
  confirmRemove.value = true
})
</script>
