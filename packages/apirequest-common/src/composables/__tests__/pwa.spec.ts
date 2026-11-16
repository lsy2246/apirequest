import { effectScope } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"

const notifications = vi.hoisted(() => ({ message: vi.fn() }))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("@apirequest/ui", () => ({ toast: notifications }))
vi.mock("../i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("@modules/pwa", async () => {
  const { ref } = await import("vue")
  return { pwaNeedsRefresh: ref(true), refreshAppForPWAUpdate: refresh }
})

import { usePwaPrompt } from "../pwa"

describe("PWA update notification", () => {
  afterEach(() => vi.clearAllMocks())

  it.each([0, 1])(
    "keeps the prompt visible until action %i is selected",
    (index) => {
      const scope = effectScope()
      try {
        scope.run(usePwaPrompt)
        const options = notifications.message.mock.calls[0][1]
        expect(options.duration).toBe(Infinity)
        expect(
          options.action.map(({ label }: { label: string }) => label)
        ).toEqual(["action.dismiss", "app.reload"])
        const dismiss = vi.fn()
        options.action[index].onClick(new MouseEvent("click"), { dismiss })
        expect(dismiss).toHaveBeenCalledOnce()
        expect(refresh).toHaveBeenCalledTimes(index)
      } finally {
        scope.stop()
      }
    }
  )
})
