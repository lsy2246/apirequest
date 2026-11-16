import axios from "axios"
import { BehaviorSubject, Subject } from "rxjs"
import { readonly, ref } from "vue"
import type {
  AuthEvent,
  AuthPlatformDef,
  HoppUser,
} from "@apirequest/common/platform/auth"

export const authEvents$ = new Subject<AuthEvent | { event: "token_refresh" }>()
const currentUser$ = new BehaviorSubject<HoppUser | null>(null)
const state = ref<"initializing" | "ready" | "unavailable">("initializing")
let pending: Promise<void> | undefined

export function renewLocalWorkspaceSession(): Promise<void> {
  pending ??= (async () => {
    state.value = "initializing"
    try {
      await axios.post(
        `${import.meta.env.VITE_BACKEND_API_URL}/auth/local-session`,
        {},
        {
          withCredentials: true,
          headers: { "X-Workbench-Local": "1" },
        }
      )
      const response = await axios.post(
        import.meta.env.VITE_BACKEND_GQL_URL,
        {
          query: "query Me { me { uid displayName email photoURL createdOn } }",
        },
        { withCredentials: true }
      )
      if (response.data.errors || !response.data.data?.me)
        throw new Error("Local workspace identity is unavailable")
      const user = { ...response.data.data.me, emailVerified: true } as HoppUser
      const reconnecting = !!currentUser$.value
      currentUser$.next(user)
      state.value = "ready"
      authEvents$.next(
        reconnecting ? { event: "token_refresh" } : { event: "login", user }
      )
    } catch (error) {
      state.value = "unavailable"
      throw error
    }
  })().finally(() => {
    pending = undefined
  })
  return pending
}

export const def: AuthPlatformDef = {
  localSessionState: readonly(state),
  getCurrentUserStream: () => currentUser$,
  getProbableUserStream: () => currentUser$,
  getAuthEventsStream: () => authEvents$,
  getCurrentUser: () => currentUser$.value,
  getProbableUser: () => currentUser$.value,
  performAuthInit: renewLocalWorkspaceSession,
  getBackendHeaders: () => ({}),
  getGQLClientOptions: () => ({ fetchOptions: { credentials: "include" } }),
  axiosPlatformConfig: () => ({ withCredentials: true }),
  willBackendHaveAuthError: () => state.value !== "ready",
  onBackendGQLClientShouldReconnect(callback) {
    authEvents$.subscribe(() => callback())
  },
  getDevOptsBackendIDToken: () => null,
  async waitProbableLoginToConfirm() {
    if (pending) await pending
    if (!currentUser$.value) throw new Error("Local workspace is unavailable")
  },
  async refreshAuthToken() {
    try {
      await renewLocalWorkspaceSession()
      return true
    } catch {
      return false
    }
  },
  async verifyAuthTokens() {
    try {
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_API_URL}/auth/verify-token`,
        { withCredentials: true }
      )
      return response.data.isValid === true
    } catch {
      return false
    }
  },
}
