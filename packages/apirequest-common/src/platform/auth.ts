import type { ClientOptions } from "@urql/core";
import type { Observable } from "rxjs";
import type { Ref } from "vue";
import type { AxiosRequestConfig } from "axios";

export type HoppUser = {
  /** A unique ID identifying the user */
  uid: string

  /** The name to be displayed as the user's */
  displayName: string | null

  /** The user's email address */
  email: string | null

  /** URL to the profile picture of the user */
  photoURL: string | null

  // Regarding `provider` and `accessToken`:
  // The current implementation and use case for these 2 fields are super weird due to legacy.
  // Currently these fields are only basically populated for Github Auth as we need the access token issued
  // by it to implement Gist submission. I would really love refactor to make this thing more sane.

  /** Name of the provider authenticating (NOTE: See notes on `platform/auth.ts`) */
  provider?: string
  /** Access Token for the auth of the user against the given `provider`. */
  accessToken?: string
  emailVerified: boolean
}

export type AuthEvent =
  | { event: "probable_login"; user: HoppUser } // We have previous login state, but the app is waiting for authentication
  | { event: "login"; user: HoppUser } // We are authenticated
  | { event: "logout" } // No authentication and we have no previous state
  | { event: "token_refresh"; user: HoppUser } // We have refreshed our tokens and have new ones now

export type AuthPlatformDef = {
  localSessionState?: Readonly<Ref<"initializing" | "ready" | "unavailable">>
  getCurrentUserStream: () => Observable<HoppUser | null>
  getAuthEventsStream: () => Observable<AuthEvent | { event: "token_refresh" }>
  getProbableUserStream: () => Observable<HoppUser | null>
  getCurrentUser: () => HoppUser | null
  getProbableUser: () => HoppUser | null
  performAuthInit: () => Promise<void>
  getBackendHeaders: () => Record<string, string>
  willBackendHaveAuthError: () => boolean
  onBackendGQLClientShouldReconnect: (callback: () => void) => void
  getGQLClientOptions?: () => Partial<ClientOptions>
  axiosPlatformConfig?: () => AxiosRequestConfig
  getDevOptsBackendIDToken: () => string | null
  waitProbableLoginToConfirm: () => Promise<void>
  verifyAuthTokens?: () => Promise<boolean>
  refreshAuthToken?: () => Promise<boolean>
}

export type LocalIdentity = AuthPlatformDef
