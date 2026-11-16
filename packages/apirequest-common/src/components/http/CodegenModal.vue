<template>
  <HoppSmartModal
    v-if="show"
    dialog
    :title="curlOnly ? t('export.curl') : t('request.generate_code')"
    @close="hideModal"
  >
    <template #body>
      <HttpCodegen :curl-only="curlOnly" @request-code="requestCode = $event" />
    </template>
    <template #footer>
      <span class="flex space-x-2">
        <HoppButtonPrimary
          :label="`${t('action.copy')}`"
          :icon="copyCodeIcon"
          outline
          @click="copyRequestCode"
        />
        <HoppButtonSecondary
          :label="`${t('action.dismiss')}`"
          outline
          filled
          @click="hideModal"
        />
      </span>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { refAutoReset } from "@vueuse/core"
import { ref, watch } from "vue"
import { useClipboard } from "~/composables/clipboard"

import { platform } from "~/platform"
import IconCheck from "~icons/lucide/check"
import IconCopy from "~icons/lucide/copy"

const { copy: copyToClipboard } = useClipboard()
const t = useI18n()

const props = defineProps<{
  show: boolean
  curlOnly?: boolean
}>()

const emit = defineEmits<{
  (e: "hide-modal"): void
}>()

const copyCodeIcon = refAutoReset<typeof IconCopy | typeof IconCheck>(
  IconCopy,
  1000
)

const requestCode = ref<string>("")

watch(
  () => props.show,
  (goingToShow) => {
    if (goingToShow) {
      platform.analytics?.logEvent({
        type: "HOPP_REST_CODEGEN_OPENED",
      })
    }
  }
)

const hideModal = () => emit("hide-modal")

const copyRequestCode = async () => {
  if (!(await copyToClipboard(requestCode.value))) return
  copyCodeIcon.value = IconCheck
}
</script>
