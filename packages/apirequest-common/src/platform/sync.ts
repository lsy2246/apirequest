/** Optional hooks for history storage settings. */
export type SyncPlatformDef = {
  history?: {
    /**
     * Resolve whether the backend currently has user-history storing
     * enabled. Self-host exposes this through the `isUserHistoryEnabled`
     * infra-config; backends without that admin toggle (e.g. cloud) omit
     * this hook and the sync layer treats history as always enabled.
     * Rejects on fetch failure so the sync layer can flag its error state.
     */
    getHistoryStoreStatus?: () => Promise<boolean>
    /**
     * Subscribe to backend-side history-enabled toggles (the self-host
     * infra-config `USER_HISTORY_STORE_ENABLED`). `onStatusChange` fires
     * with each new enabled state; returns an unsubscribe handle the sync
     * layer tears down alongside the other history subscriptions.
     */
    subscribeToHistoryStoreStatus?: (
      onStatusChange: (enabled: boolean) => void
    ) => { unsubscribe: () => void }
  }
}
