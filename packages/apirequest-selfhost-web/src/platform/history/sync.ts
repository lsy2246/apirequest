import {
  runGQLQuery,
  runGQLSubscription,
} from "@apirequest/common/helpers/backend/GQLClient"
import { SyncPlatformDef } from "@apirequest/common/platform/sync"
import * as E from "fp-ts/Either"

import {
  IsUserHistoryEnabledDocument,
  IsUserHistoryEnabledQuery,
  IsUserHistoryEnabledQueryVariables,
  UserHistoryStoreStatusChangedDocument,
} from "@app/api/generated/graphql"

const getUserHistoryStore = () =>
  runGQLQuery<
    IsUserHistoryEnabledQuery,
    IsUserHistoryEnabledQueryVariables,
    ""
  >({
    query: IsUserHistoryEnabledDocument,
    variables: {},
  })

/**
 * Self-host history sync overrides. The `isUserHistoryEnabled` infra-config
 * (and its change subscription) only exist on the self-hosted backend, so the
 * shared sync layer in `~/lib/sync/history` feature-detects these hooks rather
 * than depending on the self-host-only documents directly.
 */
export const historySyncDef: NonNullable<SyncPlatformDef["history"]> = {
  async getHistoryStoreStatus() {
    const res = await getUserHistoryStore()

    if (E.isLeft(res)) {
      throw res.left
    }

    return ["ENABLE", "true"].includes(res.right.isUserHistoryEnabled.value)
  },
  subscribeToHistoryStoreStatus(onStatusChange) {
    const [statusChanged$, sub] = runGQLSubscription({
      query: UserHistoryStoreStatusChangedDocument,
      variables: {},
    })

    statusChanged$.subscribe((res) => {
      if (E.isRight(res)) {
        onStatusChange(["ENABLE", "true"].includes(res.right.infraConfigUpdate))
      }
    })

    return sub
  },
}
