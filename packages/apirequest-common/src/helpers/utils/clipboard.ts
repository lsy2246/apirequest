import { invoke } from "@tauri-apps/api/core"
import { platform } from "~/platform"

/** Resolves only after the clipboard has actually accepted the text. */
export async function copyToClipboard(content: string): Promise<void> {
  if (platform?.localDesktop) {
    await invoke("workbench_copy_text", { text: content })
    return
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const focused = document.activeElement
  const selection = document.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange()
      )
    : []
  const dummy = document.createElement("textarea")
  dummy.value = content
  dummy.setAttribute("readonly", "")
  dummy.style.position = "fixed"
  dummy.style.opacity = "0"
  document.body.appendChild(dummy)
  try {
    dummy.select()
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable")
  } finally {
    dummy.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      ranges.forEach((range) => selection.addRange(range))
    }
  }
}
