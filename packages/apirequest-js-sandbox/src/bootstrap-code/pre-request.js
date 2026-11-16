/* eslint-disable @typescript-eslint/no-unused-expressions */
;(inputs) => {
  // Keep strict mode scoped to this IIFE to avoid leaking strictness to concatenated/bootstrapped code
  "use strict"
  // Exposes a host reporter for the generated experimental `try/catch`
  // wrapper in combineScriptsWithIIFE. Locked down (non-writable,
  // non-configurable) so user scripts cannot delete or overwrite it to
  // suppress error reporting. faraday-cage's `runCode` creates a fresh
  // QuickJS runtime per call, so re-definition across calls is not a
  // concern — the property lives only for the current run's VM.
  Object.defineProperty(globalThis, "__hoppReportScriptExecutionError", {
    value: (error) => {
      const safe = error && typeof error === "object" ? error : {}
      inputs.setScriptExecutionError({
        name: typeof safe.name === "string" ? safe.name : "",
        message:
          typeof safe.message === "string" ? safe.message : String(error),
        stack: typeof safe.stack === "string" ? safe.stack : "",
      })
    },
    enumerable: false,
    configurable: false,
    writable: false,
  })
  const requestProps = {
    // Setter methods
    setUrl: (url) => inputs.setRequestUrl(url),
    setMethod: (method) => inputs.setRequestMethod(method),
    setHeader: (name, value) => inputs.setRequestHeader(name, value),
    setHeaders: (headers) => inputs.setRequestHeaders(headers),
    removeHeader: (key) => inputs.removeRequestHeader(key),
    setParam: (name, value) => inputs.setRequestParam(name, value),
    setParams: (params) => inputs.setRequestParams(params),
    removeParam: (key) => inputs.removeRequestParam(key),
    setBody: (body) => inputs.setRequestBody(body),
    setAuth: (auth) => inputs.setRequestAuth(auth),
    // Request variables
    variables: {
      get: (key) => inputs.getRequestVariable(key),
      set: (key, value) => inputs.setRequestVariable(key, value),
    },
  }
  ;["url", "method", "params", "headers", "body", "auth"].forEach((prop) => {
    Object.defineProperty(requestProps, prop, {
      enumerable: true,
      configurable: false,
      get() {
        const currentValues = inputs.getRequestProps()
        return currentValues[prop]
      },
      set(_value) {
        throw new TypeError(`hopp.request.${prop} is read-only`)
      },
    })
  })
  // Freeze the entire requestProps object for additional protection
  Object.freeze(requestProps)
  // Special markers for undefined and null values to preserve them across sandbox boundary
  // NOTE: These values MUST match constants/sandbox-markers.ts
  // (Cannot import directly as this runs in QuickJS sandbox)
  const UNDEFINED_MARKER = "__APIREQUEST_UNDEFINED__"
  const NULL_MARKER = "__APIREQUEST_NULL__"
  // Helper function to convert markers back to their original values
  const convertMarkerToValue = (value) => {
    if (value === UNDEFINED_MARKER) return undefined
    if (value === NULL_MARKER) return null
    return value
  }
  globalThis.hopp = {
    env: {
      get: (key) => {
        return convertMarkerToValue(
          inputs.envGetResolve(key, {
            fallbackToNull: true,
            source: "all",
          }),
        )
      },
      getRaw: (key) => {
        return convertMarkerToValue(
          inputs.envGet(key, {
            fallbackToNull: true,
            source: "all",
          }),
        )
      },
      set: (key, value) => inputs.envSet(key, value),
      delete: (key) => inputs.envUnset(key),
      reset: (key) => inputs.envReset(key),
      getInitialRaw: (key) => {
        return convertMarkerToValue(inputs.envGetInitialRaw(key))
      },
      setInitial: (key, value) => inputs.envSetInitial(key, value),
      active: {
        get: (key) => {
          return convertMarkerToValue(
            inputs.envGetResolve(key, {
              fallbackToNull: true,
              source: "active",
            }),
          )
        },
        getRaw: (key) => {
          return convertMarkerToValue(
            inputs.envGet(key, {
              fallbackToNull: true,
              source: "active",
            }),
          )
        },
        set: (key, value) => inputs.envSet(key, value, { source: "active" }),
        delete: (key) => inputs.envUnset(key, { source: "active" }),
        reset: (key) => inputs.envReset(key, { source: "active" }),
        getInitialRaw: (key) => {
          return convertMarkerToValue(
            inputs.envGetInitialRaw(key, { source: "active" }),
          )
        },
        setInitial: (key, value) =>
          inputs.envSetInitial(key, value, { source: "active" }),
      },
      global: {
        get: (key) => {
          return convertMarkerToValue(
            inputs.envGetResolve(key, {
              fallbackToNull: true,
              source: "global",
            }),
          )
        },
        getRaw: (key) => {
          return convertMarkerToValue(
            inputs.envGet(key, {
              fallbackToNull: true,
              source: "global",
            }),
          )
        },
        set: (key, value) => inputs.envSet(key, value, { source: "global" }),
        delete: (key) => inputs.envUnset(key, { source: "global" }),
        reset: (key) => inputs.envReset(key, { source: "global" }),
        getInitialRaw: (key) => {
          return convertMarkerToValue(
            inputs.envGetInitialRaw(key, { source: "global" }),
          )
        },
        setInitial: (key, value) =>
          inputs.envSetInitial(key, value, { source: "global" }),
      },
    },
    request: requestProps,
    cookies: {
      get: (domain, name) => inputs.cookieGet(domain, name),
      set: (domain, cookie) => inputs.cookieSet(domain, cookie),
      has: (domain, name) => inputs.cookieHas(domain, name),
      getAll: (domain) => inputs.cookieGetAll(domain),
      delete: (domain, name) => inputs.cookieDelete(domain, name),
      clear: (domain) => inputs.cookieClear(domain),
    },
    // Expose fetch as hopp.fetch() for explicit access
    // Note: This exposes the fetch implementation provided by the host environment via hoppFetchHook
    // (injected in cage.ts during sandbox initialization), not the native browser fetch.
    // This allows requests to respect interceptor settings.
    fetch: fetch,
  }
  // Make global fetch() an alias to hopp.fetch()
  // Both fetch() and hopp.fetch() respect interceptor settings
  if (typeof fetch !== "undefined") {
    globalThis.fetch = globalThis.hopp.fetch
  }
}
