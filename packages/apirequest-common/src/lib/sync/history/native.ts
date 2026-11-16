import { GQL_REQ_SCHEMA_VERSION, RESTReqSchemaVersion } from "@apirequest/data";
import { ref } from "vue";
import { nativeHistory } from "~/helpers/native-workbench-history";
import { historyResultSnapshots, uploadHistoryResult } from "~/helpers/workbench-history-results";
import { graphqlHistoryStore, HISTORY_LIMIT, restHistoryStore, setGraphqlHistoryEntries, setRESTHistoryEntries, type GQLHistoryEntry, type RESTHistoryEntry } from "~/newstore/history";
import { getSyncInitFunction } from "..";
import { isHistoryStoreEnabled } from "./status";

type Entry = RESTHistoryEntry | GQLHistoryEntry

type NativeHistoryRecord<T extends Entry = Entry> = {
  protocol: "rest" | "graphql"
  id: string
  executedAt: number
  starred: boolean
  entry: T
}

export const nativeHistoryRevision = ref(0)
let pending = Promise.resolve()
function write(action: () => Promise<unknown>) {
  const operation = pending.then(action)
  pending = operation.then(
    () => {
      nativeHistoryRevision.value++
    },
    () => console.error("Could not write desktop history")
  )
}

function historyActions(protocol: "rest" | "graphql") {
  return {
    addEntry({ entry }: { entry: Entry }) {
      const id = entry.id
      if (!id) return
      const snapshot = historyResultSnapshots.get(entry)
      historyResultSnapshots.delete(entry)
      write(async () => {
        await nativeHistory({
          type: "add",
          entry: {
            id,
            protocol,
            requestId:
              snapshot?.requestId ??
              entry.request.id ??
              entry.request._ref_id ??
              null,
            executedAt: new Date(entry.updatedOn ?? Date.now()).getTime(),
            entry,
            starred: entry.star,
          },
        })
        if (snapshot) void uploadHistoryResult(id, snapshot)
      })
    },
    deleteEntry({ entry }: { entry: Entry }) {
      if (entry.id) write(() => nativeHistory({ type: "delete", id: entry.id }))
    },
    toggleStar({ entry }: { entry: Entry }) {
      const starred = !entry.star
      if (entry.id)
        write(() => nativeHistory({ type: "star", id: entry.id, starred }))
    },
    clearHistory() {
      write(() => nativeHistory({ type: "clear", protocol }))
    },
  }
}

export type HistoryCursor = { id: string; executedAt: number }

function deserialize<T extends Entry>(record: NativeHistoryRecord<T>) {
  const version =
    record.protocol === "rest" ? RESTReqSchemaVersion : GQL_REQ_SCHEMA_VERSION
  // 只读取当前原生记录，历史元数据以 SQLite 的列值为准。
  if (record.entry?.v !== 1 || record.entry.request?.v !== version) return

  return {
    ...record.entry,
    id: record.id,
    star: record.starred,
    updatedOn: new Date(record.executedAt),
  }
}

export async function queryNativeHistory(query: {
  protocol: "rest" | "graphql" | null
  before?: HistoryCursor
  search: string
  starred: boolean
}) {
  const page = await nativeHistory<{
    entries: NativeHistoryRecord[]
    next: HistoryCursor | null
  }>({
    type: "query",
    query,
  })
  return {
    next: page.next,
    entries: page.entries
      .map(deserialize)
      .filter((entry) => entry !== undefined),
  }
}

export async function initNativeHistory() {
  isHistoryStoreEnabled.value = true
  const [rest, graphql] = await Promise.all([
    nativeHistory<NativeHistoryRecord<RESTHistoryEntry>[]>({
      type: "list",
      protocol: "rest",
      take: HISTORY_LIMIT,
    }),
    nativeHistory<NativeHistoryRecord<GQLHistoryEntry>[]>({
      type: "list",
      protocol: "graphql",
      take: HISTORY_LIMIT,
    }),
  ])
  setRESTHistoryEntries(
    rest.map(deserialize).filter((entry) => entry !== undefined)
  )
  setGraphqlHistoryEntries(
    graphql.map(deserialize).filter((entry) => entry !== undefined)
  )
  getSyncInitFunction(
    restHistoryStore,
    historyActions("rest"),
    () => true
  ).startStoreSync()
  getSyncInitFunction(
    graphqlHistoryStore,
    historyActions("graphql"),
    () => true
  ).startStoreSync()
}
