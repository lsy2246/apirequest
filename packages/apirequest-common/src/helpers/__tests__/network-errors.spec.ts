import { beforeEach, describe, expect, it, vi } from "vitest"
import { firstValueFrom } from "rxjs"
import { filter } from "rxjs/operators"
import { createRESTNetworkRequestStream } from "../network"
const mocks = vi.hoisted(() => ({
  toRequest: vi.fn(),
  toResponse: vi.fn(),
  execute: vi.fn(),
}))
vi.mock("~/modules/dioc", () => ({
  getService: () => ({ execute: mocks.execute }),
}))
vi.mock("~/services/kernel-interceptor.service", () => ({
  KernelInterceptorService: class {},
}))
vi.mock("~/helpers/kernel/rest", () => ({
  RESTRequest: { toRequest: mocks.toRequest },
  RESTResponse: { toResponse: mocks.toResponse },
}))
beforeEach(() => vi.resetAllMocks())
const terminal = () => {
  const [stream] = createRESTNetworkRequestStream({ name: "fixture" } as any)
  return firstValueFrom(
    stream.pipe(filter((response) => response.type !== "loading"))
  )
}
describe("original network errors", () => {
  it.each(["request", "transport", "response"])(
    "emits the original %s failure as a terminal response",
    async (stage) => {
      const error = new Error(`original ${stage} failure`)
      mocks.toRequest.mockResolvedValue({})
      mocks.execute.mockReturnValue({
        response: Promise.resolve({ _tag: "Right", right: {} }),
      })
      if (stage === "request") mocks.toRequest.mockRejectedValue(error)
      if (stage === "transport")
        mocks.execute.mockImplementation(() => {
          throw error
        })
      if (stage === "response") mocks.toResponse.mockRejectedValue(error)
      const result = await terminal()
      expect(result.type).toBe("network_fail")
      expect((result as any).error).toBe(error)
    }
  )
})
