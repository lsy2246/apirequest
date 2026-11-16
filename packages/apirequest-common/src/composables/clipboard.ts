import { onScopeDispose, ref } from "vue"
import { copyToClipboard } from "~/helpers/utils/clipboard"
import { useI18n } from "./i18n"
import { useToast } from "./toast"

/** Shared copy feedback; callers change their icons only when copy returns true. */
export function useClipboard() {
  const t = useI18n()
  const toast = useToast()
  const copying = ref(false)
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
  })

  async function copy(text: string): Promise<boolean> {
    if (copying.value) return false
    copying.value = true
    copied.value = false
    clearTimeout(timer)
    try {
      await copyToClipboard(text)
      if (disposed) return false
      copied.value = true
      timer = setTimeout(() => (copied.value = false), 1500)
      toast.success(t("state.copied_to_clipboard"))
      return true
    } catch {
      if (!disposed) toast.error(t("error.copy_failed"))
      return false
    } finally {
      copying.value = false
    }
  }

  return { copy, copied, copying }
}
