import { isEqual } from "lodash-es"
import { pluck } from "rxjs/operators"
import {
  HoppRESTRequest,
  parseRESTRequest,
  HoppGQLRequest,
  parseGQLRequest,
} from "@apirequest/data"
import DispatchingStore, { defineDispatchers } from "./DispatchingStore"
import { executedResponses$ } from "~/helpers/RequestRunner"
import { captureHistoryResult } from "~/helpers/workbench-history-results"
import { settingsStore } from "./settings"
import { isHistoryStoreEnabled } from "~/lib/sync/history/status"

export type RESTHistoryEntry = {
  v: number

  request: HoppRESTRequest

  responseMeta: {
    duration: number | null
    statusCode: number | null
  }

  star: boolean

  id?: string // For when Firebase Firestore is set

  updatedOn?: Date
}

export type GQLHistoryEntry = {
  v: number
  request: HoppGQLRequest

  response: string

  star: boolean

  id?: string // For when Firestore ID is set

  updatedOn?: Date
}

export function makeRESTHistoryEntry(
  x: Omit<RESTHistoryEntry, "v">
): RESTHistoryEntry {
  return {
    v: 1,
    ...x,
  }
}

export function makeGQLHistoryEntry(
  x: Omit<GQLHistoryEntry, "v">
): GQLHistoryEntry {
  return {
    v: 1,
    ...x,
    updatedOn: new Date(),
  }
}

export function translateToNewRESTHistory(
  value: RESTHistoryEntry
): RESTHistoryEntry {
  if (value.v !== 1) throw new Error("Invalid current history entry")
  return { ...value, request: parseRESTRequest(value.request) }
}

export function translateToNewGQLHistory(
  value: GQLHistoryEntry
): GQLHistoryEntry {
  if (value.v !== 1) throw new Error("Invalid current history entry")
  return { ...value, request: parseGQLRequest(value.request) }
}

// Decodes a JSON-stringified wire value back to a string. Returns the
// raw value if parsing yields a non-string (object, array, etc.) so
// callers always receive a string per the GQLHistoryEntry contract.
export const decodeGQLHistoryResponse = (value: string): string => {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "string" ? parsed : value
  } catch {
    return value
  }
}

export const defaultRESTHistoryState = {
  state: [] as RESTHistoryEntry[],
}

export const defaultGraphqlHistoryState = {
  state: [] as GQLHistoryEntry[],
}

export const HISTORY_LIMIT = 50

type RESTHistoryType = typeof defaultRESTHistoryState
type GraphqlHistoryType = typeof defaultGraphqlHistoryState

const RESTHistoryDispatchers = defineDispatchers({
  setEntries(_: RESTHistoryType, { entries }: { entries: RESTHistoryEntry[] }) {
    return {
      state: entries,
    }
  },
  addEntry(
    currentVal: RESTHistoryType,
    { entry }: { entry: RESTHistoryEntry }
  ) {
    return {
      state: [entry, ...currentVal.state].slice(0, HISTORY_LIMIT),
    }
  },
  deleteEntry(
    currentVal: RESTHistoryType,
    { entry }: { entry: RESTHistoryEntry }
  ) {
    return {
      state: currentVal.state.filter((e) => !isEqual(e, entry)),
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  clearHistory(_, {}) {
    return {
      state: [],
    }
  },
  toggleStar(
    currentVal: RESTHistoryType,
    { entry }: { entry: RESTHistoryEntry }
  ) {
    return {
      state: currentVal.state.map((e) => {
        if (isEqual(e, entry) && e.star !== undefined) {
          return {
            ...e,
            star: !e.star,
          }
        }
        return e
      }),
    }
  },
  // only used for history.sync.ts to prevent double insertion of history entries from storeSync and Subscriptions
  removeDuplicateEntry(currentVal: RESTHistoryType, { id }: { id: string }) {
    const entries = currentVal.state.filter((e) => e.id === id)

    if (entries.length === 2) {
      const indexToRemove = currentVal.state.findIndex((e) => e.id === id)

      currentVal.state.splice(indexToRemove, 1)
    }

    return {
      state: currentVal.state,
    }
  },
})

const GQLHistoryDispatchers = defineDispatchers({
  setEntries(
    _: GraphqlHistoryType,
    { entries }: { entries: GQLHistoryEntry[] }
  ) {
    return {
      state: entries,
    }
  },
  addEntry(
    currentVal: GraphqlHistoryType,
    { entry }: { entry: GQLHistoryEntry }
  ) {
    return {
      state: [entry, ...currentVal.state].slice(0, HISTORY_LIMIT),
    }
  },
  deleteEntry(
    currentVal: GraphqlHistoryType,
    { entry }: { entry: GQLHistoryEntry }
  ) {
    return {
      state: currentVal.state.filter((e) => !isEqual(e, entry)),
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  clearHistory(_, {}) {
    return {
      state: [],
    }
  },
  toggleStar(
    currentVal: GraphqlHistoryType,
    { entry }: { entry: GQLHistoryEntry }
  ) {
    return {
      state: currentVal.state.map((e) => {
        if (isEqual(e, entry) && e.star !== undefined) {
          return {
            ...e,
            star: !e.star,
          }
        }
        return e
      }),
    }
  },
  // only used for history.sync.ts to prevent double insertion of history entries from storeSync and Subscriptions
  removeDuplicateEntry(currentVal: GraphqlHistoryType, { id }: { id: string }) {
    const entries = currentVal.state.filter((e) => e.id === id)

    if (entries.length === 2) {
      const indexToRemove = currentVal.state.findIndex((e) => e.id === id)

      currentVal.state.splice(indexToRemove, 1)
    }

    return {
      state: currentVal.state,
    }
  },
})

export const restHistoryStore = new DispatchingStore(
  defaultRESTHistoryState,
  RESTHistoryDispatchers
)

export const graphqlHistoryStore = new DispatchingStore(
  defaultGraphqlHistoryState,
  GQLHistoryDispatchers
)

export const restHistory$ = restHistoryStore.subject$.pipe(pluck("state"))
export const graphqlHistory$ = graphqlHistoryStore.subject$.pipe(pluck("state"))

export function setRESTHistoryEntries(entries: RESTHistoryEntry[]) {
  restHistoryStore.dispatch({
    dispatcher: "setEntries",
    payload: { entries },
  })
}

export function addRESTHistoryEntry(entry: RESTHistoryEntry) {
  if (window.__APIREQUEST_NATIVE__) entry.id ??= crypto.randomUUID()
  restHistoryStore.dispatch({
    dispatcher: "addEntry",
    payload: { entry },
  })
}

export function deleteRESTHistoryEntry(entry: RESTHistoryEntry) {
  restHistoryStore.dispatch({
    dispatcher: "deleteEntry",
    payload: { entry },
  })
}

export function clearRESTHistory() {
  restHistoryStore.dispatch({
    dispatcher: "clearHistory",
    payload: {},
  })
}

export function toggleRESTHistoryEntryStar(entry: RESTHistoryEntry) {
  restHistoryStore.dispatch({
    dispatcher: "toggleStar",
    payload: { entry },
  })
}

export function setGraphqlHistoryEntries(entries: GQLHistoryEntry[]) {
  graphqlHistoryStore.dispatch({
    dispatcher: "setEntries",
    payload: { entries },
  })
}

export function addGraphqlHistoryEntry(entry: GQLHistoryEntry) {
  if (window.__APIREQUEST_NATIVE__) entry.id ??= crypto.randomUUID()
  graphqlHistoryStore.dispatch({
    dispatcher: "addEntry",
    payload: { entry },
  })
}

export function deleteGraphqlHistoryEntry(entry: GQLHistoryEntry) {
  graphqlHistoryStore.dispatch({
    dispatcher: "deleteEntry",
    payload: { entry },
  })
}

export function clearGraphqlHistory() {
  graphqlHistoryStore.dispatch({
    dispatcher: "clearHistory",
    payload: {},
  })
}

export function toggleGraphqlHistoryEntryStar(entry: GQLHistoryEntry) {
  graphqlHistoryStore.dispatch({
    dispatcher: "toggleStar",
    payload: { entry },
  })
}

export function removeDuplicateRestHistoryEntry(id: string) {
  restHistoryStore.dispatch({
    dispatcher: "removeDuplicateEntry",
    payload: { id },
  })
}

export function removeDuplicateGraphqlHistoryEntry(id: string) {
  graphqlHistoryStore.dispatch({
    dispatcher: "removeDuplicateEntry",
    payload: { id },
  })
}

// Listen to completed responses to add to history
executedResponses$.subscribe((res) => {
  if (!settingsStore.value.RECORD_HISTORY || !isHistoryStoreEnabled.value)
    return
  // Spread to auto-capture any future fields, but omit _ref_id and id
  // since history entries are snapshots and shouldn't carry collection/firestore references
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _ref_id, id, ...request } = res.req

  addRESTHistoryEntry(
    captureHistoryResult(
      makeRESTHistoryEntry({
        request,
        responseMeta: {
          duration: res.meta.responseDuration,
          statusCode: res.statusCode,
        },
        star: false,
        updatedOn: new Date(),
      }),
      {
        requestId: res.historyRequestId,
        statusCode: res.statusCode,
        statusText: res.statusText,
        duration: res.meta.responseDuration,
        headers: res.headers,
        body: res.body,
      }
    )
  )
})
