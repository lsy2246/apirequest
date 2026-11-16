import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { pwaNeedsRefresh, refreshAppForPWAUpdate } from "@modules/pwa"
import { watch } from "vue"

export const usePwaPrompt = function () {
  const toast = useToast()
  const t = useI18n()

  watch(
    pwaNeedsRefresh,
    (value) => {
      if (value) {
        showUpdateToast()
      }
    },
    {
      immediate: true,
    }
  )

  function showUpdateToast() {
    toast.message(`${t("app.new_version_found")}`, {
      position: "bottom-center",
      duration: Infinity,
      action: [
        {
          label: `${t("action.dismiss")}`,
          onClick: (_, { dismiss }) => {
            dismiss()
          },
        },
        {
          label: `${t("app.reload")}`,
          onClick: (_, { dismiss }) => {
            dismiss()
            refreshAppForPWAUpdate()
          },
        },
      ],
    })
  }
}
