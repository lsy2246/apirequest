/** Arrow navigation for single-selection horizontal tabs. */
export function navigateTabs(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const list = event.currentTarget as HTMLElement
  const tabs = Array.from(
    list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')
  )
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0 || !tabs.length) return
  event.preventDefault()
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length
  tabs[next].focus()
  tabs[next].click()
}

export function operationStatusClass(status: string) {
  if (["completed", "applied", "success"].includes(status))
    return "ui-status-success"
  if (["failed", "error", "conflict"].includes(status)) return "ui-status-error"
  if (["paused", "pausing", "interrupted", "expired"].includes(status))
    return "ui-status-warning"
  if (["pending", "running", "applying"].includes(status)) return "text-accent"
  return "text-secondaryLight"
}

export function trapDialogTab(event: KeyboardEvent) {
  if (event.key !== "Tab") return
  const dialog = event.currentTarget as HTMLElement
  const items = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]"
    )
  ).filter(
    (el) =>
      el.tabIndex >= 0 && !el.closest("[inert]") && el.getClientRects().length
  )
  const first = items[0],
    last = items.at(-1)
  if (!first) {
    event.preventDefault()
    dialog.focus()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function relativeTime(date: Date, now: Date, locale: string) {
  const seconds = (date.getTime() - now.getTime()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ]
  const [unit, size] =
    units.find(([, size]) => Math.abs(seconds) >= size) ?? units.at(-1)!
  const language =
    locale === "cn" ? "zh-CN" : locale === "tw" ? "zh-TW" : locale
  return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(
    Math.round(seconds / size),
    unit
  )
}
