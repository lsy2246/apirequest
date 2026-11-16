import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"

const subscriptions = vi.hoisted(() => new Set<() => void>())
vi.mock("~/services/workbench-realtime.service", async () => {
  const { reactive } = await import("vue")
  return {
    liveStatus: reactive({ backend: "live" }),
    liveSourceKey: (source: string) => source,
    subscribeWorkbench: (
      _source: string,
      _topics: string[],
      receive: () => void
    ) => {
      subscriptions.add(receive)
      receive()
      return () => subscriptions.delete(receive)
    },
  }
})
import { provideWorkbenchLive, useWorkbenchLiveQuery } from "../workbenchLive"
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  subscriptions.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.removeItem("workbench-live-background")
  localStorage.removeItem("workbench-live-pages")
})
const tick = async () => {
  await nextTick()
  await vi.advanceTimersByTimeAsync(160)
}
describe("live query lifecycle", () => {
  it("coalesces bursts and retains invalidations arriving during an in-flight snapshot", async () => {
    vi.useFakeTimers()
    let release!: () => void
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            release = done
          })
      )
      .mockResolvedValue(undefined)
    app = createApp(
      defineComponent({
        setup() {
          useWorkbenchLiveQuery(["mock"], load)
          return () => h("div")
        },
      })
    )
    app.mount(document.createElement("div"))
    await tick()
    for (let i = 0; i < 100; i++) for (const notify of subscriptions) notify()
    expect(load).toHaveBeenCalledTimes(1)
    release()
    await tick()
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60000)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it("ignores old disabled preferences and keeps receiving updates in the background", async () => {
    vi.useFakeTimers()
    const blocked = ref(false)
    const load = vi.fn().mockResolvedValue(undefined)
    localStorage.setItem(
      "workbench-live-pages",
      JSON.stringify({ test: false })
    )
    const child = defineComponent({
      setup() {
        useWorkbenchLiveQuery(["ai"], load, { blocked })
        return () => h("div")
      },
    })
    app = createApp(
      defineComponent({
        setup() {
          provideWorkbenchLive()
          return () => h(child)
        },
      })
    )
    app.mount(document.createElement("div"))
    await tick()
    expect(subscriptions.size).toBe(1)
    expect(load).toHaveBeenCalledTimes(1)
    blocked.value = true
    await tick()
    expect(subscriptions.size).toBe(0)
    blocked.value = false
    await tick()
    expect(load).toHaveBeenCalledTimes(2)
    localStorage.setItem("workbench-live-background", "false")
    vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    document.dispatchEvent(new Event("visibilitychange"))
    await tick()
    expect(subscriptions.size).toBe(1)
    for (const notify of subscriptions) notify()
    await tick()
    expect(load).toHaveBeenCalledTimes(3)
    app.unmount()
    app = undefined
    expect(subscriptions.size).toBe(0)
  })
})
