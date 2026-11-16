import { toast } from "@apirequest/ui"
import { onScopeDispose } from "vue"
import { useI18n } from "./i18n"

/** Keep only the current editor's latest deletion available for undo. */
export function useUndoToast() {
  const t = useI18n()
  let activeID: string | number | undefined

  function dismiss() {
    if (activeID !== undefined) {
      toast.dismiss(activeID)
      activeID = undefined
    }
  }

  function clear({ id }: { id: string | number }) {
    if (activeID === id) activeID = undefined
  }

  onScopeDispose(dismiss)

  return (undo: () => void) => {
    dismiss()
    const id = toast.success(t("state.deleted"), {
      action: {
        label: t("action.undo"),
        onClick: (_, notification) => {
          if (activeID !== id) return
          undo()
          notification.dismiss()
          clear({ id })
        },
      },
      onDismiss: clear,
      onAutoClose: clear,
    })
    activeID = id
  }
}
