import { defineComponent, h, type Component } from "vue"
import {
  HoppButtonPrimary as Primary,
  HoppButtonSecondary as Secondary,
} from "@apirequest/ui"

// Preserve the upstream props, defaults and styles while using the visible
// label as the accessible name. Ordinary actions must not submit parent forms.
function withButtonLabel<T extends typeof Primary | typeof Secondary>(
  button: T
): T {
  return defineComponent({
    extends: button,
    inheritAttrs: false,
    setup(props, { attrs, slots }) {
      const details = props as Pick<
        InstanceType<typeof Primary>["$props"],
        "label" | "to" | "loading" | "disabled"
      >
      return () =>
        h(
          button as Component,
          {
            ...props,
            ...attrs,
            role: attrs.role || (details.to ? "link" : "button"),
            "aria-label":
              attrs["aria-label"] || details.label || attrs.title || undefined,
            "aria-busy": details.loading || undefined,
            disabled: details.disabled || details.loading,
            type: attrs.type || (details.to ? undefined : "button"),
          },
          slots
        )
    },
  }) as unknown as T
}

export const HoppButtonPrimary = withButtonLabel(Primary)
export const HoppButtonSecondary = withButtonLabel(Secondary)
