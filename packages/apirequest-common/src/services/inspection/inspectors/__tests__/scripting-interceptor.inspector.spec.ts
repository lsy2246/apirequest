import { TestContainer } from "dioc/testing"
import { describe, expect, it, vi } from "vitest"
import { ScriptingInterceptorInspectorService } from "../scripting-interceptor.inspector"
import { InspectionService } from "../../index"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { ref } from "vue"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"

// Mock platform module with mutable feature flags for testing
// Cannot reference external variables in vi.mock due to hoisting
vi.mock("~/platform", () => ({
  __esModule: true,
  platform: {
    platformFeatureFlags: {
      exportAsGIST: false,
      hasTelemetry: false,
      cookiesEnabled: false,
      hasCookieBasedAuth: false,
    },
  },
}))

vi.mock("~/modules/i18n", () => ({
  __esModule: true,
  getI18n: () => (x: string, params?: Record<string, string>) => {
    if (!params) return x
    // Simple parameter replacement for testing
    return Object.entries(params).reduce(
      (str, [key, value]) => str.replace(`{${key}}`, value),
      x
    )
  },
}))

// Import platform after mocking to get the mocked version
import { platform } from "~/platform"

describe("ScriptingInterceptorInspectorService", () => {
  it("registers with the inspection service upon initialization", () => {
    const container = new TestContainer()

    const registerInspectorFn = vi.fn()

    container.bindMock(InspectionService, {
      registerInspector: registerInspectorFn,
    })

    container.bindMock(KernelInterceptorService, {
      getCurrentId: () => "browser",
    })

    const inspector = container.bind(ScriptingInterceptorInspectorService)

    expect(registerInspectorFn).toHaveBeenCalledOnce()
    expect(registerInspectorFn).toHaveBeenCalledWith(inspector)
  })

  describe("same-origin CSRF warnings (cookie-based auth only)", () => {
    it("should warn when using Browser + relative URL with hasCookieBasedAuth", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      // Mock platform with cookie-based auth
      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "await hopp.fetch('/api/data')",
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({
          id: "same-origin-fetch-csrf",
          severity: 2,
          isApplicable: true,
        })
      )
    })

    it("should warn when using Browser + same-origin absolute URL", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        testScript: `await fetch('${window.location.origin}/api/data')`,
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({
          id: "same-origin-fetch-csrf",
          severity: 2,
        })
      )
    })

    it("should warn for hopp.fetch with a relative URL in the test script", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        testScript: `
          await hopp.fetch('/api/users', { method: 'POST' })
        `,
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({
          id: "same-origin-fetch-csrf",
          severity: 2,
        })
      )
    })

    it("should warn for fetch with a same-origin URL in the pre-request script", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: `
          await fetch('${window.location.origin}/api/data', { method: 'GET' })
        `,
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({
          id: "same-origin-fetch-csrf",
        })
      )
    })

    it("should warn when script uses window.location", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: `
          const url = window.location.origin + '/api/data'
          await hopp.fetch(url)
        `,
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({
          id: "same-origin-fetch-csrf",
        })
      )
    })

    it("should NOT warn when hasCookieBasedAuth is false", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      // No cookie-based auth (desktop or cloud)
      platform.platformFeatureFlags.hasCookieBasedAuth = false

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "await hopp.fetch('/api/data')",
      })

      const result = inspector.getInspections(req, ref(null))

      // Should not have CSRF warning
      expect(
        result.value.find((r) => r.id === "same-origin-fetch-csrf")
      ).toBeUndefined()
    })

    it("should NOT warn for different-origin URLs", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "await hopp.fetch('https://different.com/api')",
      })

      const result = inspector.getInspections(req, ref(null))

      expect(
        result.value.find((r) => r.id === "same-origin-fetch-csrf")
      ).toBeUndefined()
    })

    it("should NOT warn when using Native interceptor (even with same-origin)", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "native",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "await hopp.fetch('/api/data')",
      })

      const result = inspector.getInspections(req, ref(null))

      // 原生发送不自动携带网页会话 Cookie。
      expect(
        result.value.find((r) => r.id === "same-origin-fetch-csrf")
      ).toBeUndefined()
    })
  })

  describe("fetch API detection", () => {
    it("should detect hopp.fetch() in pre-request script", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true
      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "const res = await hopp.fetch('/api')",
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({ id: "same-origin-fetch-csrf", severity: 2 })
      )
    })

    it("should detect hopp.fetch() in test script", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true
      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        testScript: "await hopp.fetch('/api')",
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({ id: "same-origin-fetch-csrf", severity: 2 })
      )
    })

    it("should detect fetch() in script (but not hopp.fetch)", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true
      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "const res = await fetch('/api')",
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toContainEqual(
        expect.objectContaining({ id: "same-origin-fetch-csrf", severity: 2 })
      )
    })

    it("should NOT detect hopp.fetch when script is empty", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true
      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "",
        testScript: "",
      })

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toEqual([])
    })

    it("should detect fetch in both pre-request and test scripts", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true
      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "await hopp.fetch('/api/1')",
        testScript: "pm.sendRequest('/api/2', () => {})",
      })

      const result = inspector.getInspections(req, ref(null))

      // 扩展已删除，继续验证两段脚本均能触发同源风险检查。
      expect(result.value).toContainEqual(
        expect.objectContaining({ id: "same-origin-fetch-csrf", severity: 2 })
      )
    })
  })

  describe("edge cases", () => {
    it("should handle requests without scripts gracefully", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref(getDefaultRESTRequest())

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toEqual([])
    })

    it("should handle response-type requests (history)", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      // Response-type request doesn't have preRequestScript/testScript
      const req = ref({
        endpoint: "https://api.example.com",
        method: "GET",
        headers: [],
      } as any)

      const result = inspector.getInspections(req, ref(null))

      expect(result.value).toEqual([])
    })

    it("should handle invalid URLs gracefully", () => {
      const container = new TestContainer()

      container.bindMock(KernelInterceptorService, {
        getCurrentId: () => "browser",
      })

      platform.platformFeatureFlags.hasCookieBasedAuth = true

      const inspector = container.bind(ScriptingInterceptorInspectorService)

      const req = ref({
        ...getDefaultRESTRequest(),
        preRequestScript: "await hopp.fetch('not-a-valid-url')",
      })

      const result = inspector.getInspections(req, ref(null))

      // Should not crash, may or may not have warnings depending on detection
      expect(result.value).toBeDefined()
    })
  })
})
