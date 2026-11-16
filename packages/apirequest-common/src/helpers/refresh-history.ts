// Keep web GraphQL modules out of the standalone desktop bundle.
export const refreshWebHistory = import.meta.env.VITE_WORKBENCH_NATIVE
  ? undefined
  : async () => {
      const { refreshHistory } = await import("~/lib/sync/history")
      await refreshHistory()
    }
