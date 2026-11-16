import { describe, expect, it } from "vitest"
import { createI18n } from "vue-i18n"
import cn from "../../../../locales/cn.json"
import en from "../../../../locales/en.json"
describe("Mock action help text", () => {
  it.each([
    ["cn", cn],
    ["en", en],
  ] as const)(
    "renders action hints in %s without message syntax errors",
    (locale, messages) => {
      const i18n = createI18n({
        legacy: false,
        locale,
        messages: { [locale]: messages },
      })
      for (const key of [
        "script_hint",
        "callback_hint",
        "structure_hint",
        "cookies_hint",
        "protocol_hint",
      ]) {
        const translated = i18n.global.t(`mock_tools.${key}`)
        expect(translated).toContain(
          key === "protocol_hint"
            ? "Base64"
            : key === "structure_hint"
              ? "JSON"
              : key === "cookies_hint"
                ? "Cookie"
                : locale === "cn"
                  ? "响应"
                  : "response"
        )
      }
    }
  )
})
