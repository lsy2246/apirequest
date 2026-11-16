import { EMPTY, of } from "rxjs"
import type { LocalIdentity } from "@apirequest/common/platform/auth"

// 单人工作区没有账号会话，订阅者收到空的身份状态。
export const nativeWorkbenchAuth: LocalIdentity = {
  getCurrentUserStream: () => of(null),
  getAuthEventsStream: () => EMPTY,
  getProbableUserStream: () => of(null),
  getCurrentUser: () => null,
  getProbableUser: () => null,
  async performAuthInit() {},
  getBackendHeaders: () => ({}),
  willBackendHaveAuthError: () => false,
  onBackendGQLClientShouldReconnect() {},
  getDevOptsBackendIDToken: () => null,
  async waitProbableLoginToConfirm() {},
}
