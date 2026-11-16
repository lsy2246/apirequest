import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, ref, nextTick, type App } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import { HoppButtonPrimary, HoppButtonSecondary } from "../ui-buttons"

let app: App | undefined
afterEach(() => app?.unmount())

describe.each([HoppButtonPrimary, HoppButtonSecondary])(
  "workbench action buttons",
  (Button) => {
    it("keeps navigation actions accessible as named links", () => {
      const target = document.createElement("div")
      app = createApp({
        render: () =>
          h(Button, { to: "/access-tokens", label: "Access tokens" }),
      })
      app.use(
        createRouter({
          history: createMemoryHistory(),
          routes: [
            { path: "/access-tokens", component: { render: () => null } },
          ],
        })
      )
      app.mount(target)
      const link = target.querySelector("a")!
      expect(link.getAttribute("role")).toBe("link")
      expect(link.getAttribute("aria-label")).toBe("Access tokens")
      expect(link.getAttribute("href")).toBe("/access-tokens")
    })
    it("uses the current visible label, preserves explicit names, and avoids implicit form submission", async () => {
      const label = ref("Copy")
      const submit = vi.fn((event: Event) => event.preventDefault())
      const target = document.createElement("div")
      app = createApp({
        setup: () => () =>
          h("form", { onSubmit: submit }, [
            h(Button, { label: label.value }),
            h(Button, {
              label: "Copy",
              "aria-label": "Copy connection configuration",
              type: "submit",
            }),
          ]),
      })
      app.component("RouterLink", { render: () => null })
      app.mount(target)
      const buttons = target.querySelectorAll("button")
      expect(buttons[0].getAttribute("aria-label")).toBe("Copy")
      expect(buttons[0].type).toBe("button")
      buttons[0].click()
      expect(submit).not.toHaveBeenCalled()
      expect(buttons[1].getAttribute("aria-label")).toBe(
        "Copy connection configuration"
      )
      expect(buttons[1].type).toBe("submit")
      label.value = "Copied"
      await nextTick()
      expect(buttons[0].getAttribute("aria-label")).toBe("Copied")
    })

    it("disables pending actions and exposes their busy state", () => {
      const click = vi.fn()
      const target = document.createElement("div")
      app = createApp({
        render: () =>
          h(Button, { label: "Copy", loading: true, onClick: click }),
      })
      app.component("RouterLink", { render: () => null })
      app.mount(target)
      const button = target.querySelector("button")!
      expect(button.disabled).toBe(true)
      expect(button.getAttribute("aria-busy")).toBe("true")
      button.click()
      expect(click).not.toHaveBeenCalled()
    })
  }
)
