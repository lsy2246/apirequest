import { CageModuleCtx, defineSandboxFn } from "faraday-cage/modules"

import type {
  EnvMethods,
  RequestProps,
  EnvironmentMethods,
  SandboxValue,
} from "~/types"

/**
 * Creates pw namespace methods for the sandbox environment
 * Includes environment operations and request variable management
 */
export const createEnvironmentMethods = (
  ctx: CageModuleCtx,
  envMethods: EnvMethods,
  requestProps: RequestProps
): EnvironmentMethods => {
  return {
    // `pw` namespace environment methods
    envGet: defineSandboxFn(
      ctx,
      "envGet",
      function (key: SandboxValue, options: SandboxValue) {
        return envMethods.current.get(key, options)
      }
    ),
    envGetResolve: defineSandboxFn(
      ctx,
      "envGetResolve",
      function (key: SandboxValue, options: SandboxValue) {
        return envMethods.current.getResolve(key, options)
      }
    ),
    envSet: defineSandboxFn(
      ctx,
      "envSet",
      function (key: SandboxValue, value: SandboxValue, options: SandboxValue) {
        return envMethods.current.set(key, value, options)
      }
    ),
    envUnset: defineSandboxFn(
      ctx,
      "envUnset",
      function (key: SandboxValue, options: SandboxValue) {
        return envMethods.current.unset(key, options)
      }
    ),
    envResolve: defineSandboxFn(
      ctx,
      "envResolve",
      function (key: SandboxValue) {
        return envMethods.current.resolve(key)
      }
    ),

    // Request variable operations
    getRequestVariable: defineSandboxFn(
      ctx,
      "getRequestVariable",
      function (key: SandboxValue) {
        const reqVarEntry = requestProps.requestVariables.find(
          (reqVar: SandboxValue) => reqVar.key === key
        )
        return reqVarEntry ? reqVarEntry.value : null
      }
    ),
  }
}
