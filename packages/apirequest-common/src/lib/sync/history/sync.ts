import { ReqType } from "~/helpers/backend/enums";
import { graphqlHistoryStore, removeDuplicateRestHistoryEntry, removeDuplicateGraphqlHistoryEntry, restHistoryStore } from "~/newstore/history";
import { getSettingSubject, settingsStore } from "~/newstore/settings";

import { getSyncInitFunction, type StoreSyncDefinitionOf } from "..";

import * as E from "fp-ts/Either";

import { createUserHistory, deleteAllUserHistory, removeRequestFromHistory, toggleHistoryStarStatus } from "./api";

import { isHistoryStoreEnabled } from "./status";
import { historyResultSnapshots, uploadHistoryResult } from "~/helpers/workbench-history-results";

export const restHistoryStoreSyncDefinition: StoreSyncDefinitionOf<
  typeof restHistoryStore
> = {
  async addEntry({ entry }) {
    if (!isHistoryStoreEnabled.value) {
      return
    }

    const snapshot = historyResultSnapshots.get(entry)
    historyResultSnapshots.delete(entry)
    const res = await createUserHistory(
      JSON.stringify(entry.request),
      JSON.stringify(entry.responseMeta),
      ReqType.Rest
    )

    if (E.isRight(res)) {
      entry.id = res.right.createUserHistory.id
      if (snapshot) void uploadHistoryResult(entry.id, snapshot)

      // preventing double insertion from here and subscription
      removeDuplicateRestHistoryEntry(entry.id)
    }
  },
  deleteEntry({ entry }) {
    if (entry.id) {
      removeRequestFromHistory(entry.id)
    }
  },
  toggleStar({ entry }) {
    if (entry.id) {
      toggleHistoryStarStatus(entry.id)
    }
  },
  clearHistory() {
    deleteAllUserHistory(ReqType.Rest)
  },
}

export const gqlHistoryStoreSyncDefinition: StoreSyncDefinitionOf<
  typeof graphqlHistoryStore
> = {
  async addEntry({ entry }) {
    if (!isHistoryStoreEnabled.value) {
      return
    }

    const snapshot = historyResultSnapshots.get(entry)
    historyResultSnapshots.delete(entry)
    const res = await createUserHistory(
      JSON.stringify(entry.request),
      JSON.stringify(
        snapshot
          ? { statusCode: snapshot.statusCode, duration: snapshot.duration }
          : entry.response
      ),
      ReqType.Gql
    )

    if (E.isRight(res)) {
      entry.id = res.right.createUserHistory.id
      if (snapshot) void uploadHistoryResult(entry.id, snapshot)

      // preventing double insertion from here and subscription
      removeDuplicateGraphqlHistoryEntry(entry.id)
    }
  },
  deleteEntry({ entry }) {
    if (entry.id) {
      removeRequestFromHistory(entry.id)
    }
  },
  toggleStar({ entry }) {
    if (entry.id) {
      toggleHistoryStarStatus(entry.id)
    }
  },
  clearHistory() {
    deleteAllUserHistory(ReqType.Gql)
  },
}

export const restHistorySyncer = getSyncInitFunction(
  restHistoryStore,
  restHistoryStoreSyncDefinition,
  () => settingsStore.value.syncHistory,
  getSettingSubject("syncHistory")
)

export const gqlHistorySyncer = getSyncInitFunction(
  graphqlHistoryStore,
  gqlHistoryStoreSyncDefinition,
  () => settingsStore.value.syncHistory,
  getSettingSubject("syncHistory")
)
