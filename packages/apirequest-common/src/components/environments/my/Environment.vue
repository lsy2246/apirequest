<template>
  <div
    class="group flex items-stretch"
    @contextmenu.prevent="options!.tippy?.show()"
  >
    <span class="flex items-center justify-center px-4" aria-hidden="true">
      <icon-lucide-globe
        v-if="environmentIndex === 'Global'"
        class="svg-icons"
      />
      <icon-lucide-layers v-else class="svg-icons" />
    </span>
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center py-2 pr-2 text-left transition group-hover:text-secondaryDark"
      :aria-label="displayName"
      :title="t('action.edit')"
      @click="emitEditEnvironment"
    >
      <span class="truncate"> {{ displayName }} </span>
    </button>

    <div class="flex">
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :icon="IconEdit"
        :title="`${t('action.edit')}`"
        class="hidden group-hover:inline-flex"
        @click="emitEditEnvironment"
      />
      <HoppButtonSecondary
        v-tippy="{ theme: 'tooltip' }"
        :icon="IconCopy"
        :title="`${t('action.duplicate')}`"
        class="hidden group-hover:inline-flex"
        @click="duplicateEnvironments"
      />
    </div>
    <span>
      <tippy
        ref="options"
        interactive
        trigger="click"
        theme="popover"
        :on-shown="() => tippyActions!.focus()"
      >
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.more')"
          :icon="IconMoreVertical"
        />
        <template #content="{ hide }">
          <div
            ref="tippyActions"
            class="flex flex-col focus:outline-none"
            tabindex="0"
            role="menu"
            @keyup.e="edit!.$el.click()"
            @keyup.d="duplicate!.$el.click()"
            @keyup.j="exportAsJsonEl!.$el.click()"
            @keyup.delete="
              !(environmentIndex === 'Global')
                ? deleteAction!.$el.click()
                : null
            "
            @keyup.escape="hide()"
          >
            <HoppSmartItem
              ref="edit"
              :icon="IconEdit"
              :label="`${t('action.edit')}`"
              :shortcut="['E']"
              :disabled="duplicateGlobalEnvironmentLoading"
              @click="
                async () => {
                  const ok = await emitEditEnvironment()
                  if (ok) hide()
                }
              "
            />
            <HoppSmartItem
              ref="duplicate"
              :icon="IconCopy"
              :label="t('action.duplicate')"
              :shortcut="['D']"
              :loading="duplicateGlobalEnvironmentLoading"
              @click="
                () => {
                  duplicateEnvironments()
                  !showContextMenuLoadingState && hide()
                }
              "
            />
            <HoppSmartItem
              :icon="IconImport"
              :label="t('environment.import_json')"
              :disabled="duplicateGlobalEnvironmentLoading"
              @click="
                () => {
                  showImport = true
                  hide()
                }
              "
            />
            <HoppSmartItem
              ref="exportAsJsonEl"
              :icon="IconEdit"
              :label="`${t('export.as_json')}`"
              :shortcut="['J']"
              :disabled="duplicateGlobalEnvironmentLoading"
              @click="
                () => {
                  exportEnvironmentAsJSON()
                  hide()
                }
              "
            />
            <HoppSmartItem
              v-if="environmentIndex !== 'Global'"
              ref="deleteAction"
              :icon="IconTrash2"
              :label="`${t('action.delete')}`"
              :shortcut="['⌫']"
              :disabled="duplicateGlobalEnvironmentLoading"
              @click="
                () => {
                  confirmRemove = true
                  hide()
                }
              "
            />
          </div>
        </template>
      </tippy>
    </span>
    <HoppSmartConfirmModal
      :show="confirmRemove"
      :title="`${t('confirm.remove_environment')}`"
      @hide-modal="confirmRemove = false"
      @resolve="removeEnvironment"
    />
    <EnvironmentsImportExport
      v-if="showImport"
      environment-type="MY_ENV"
      :target-environment="environment"
      @hide-modal="showImport = false"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { Environment } from "@apirequest/data"
import { HoppSmartItem } from "@apirequest/ui"
import { useService } from "dioc/vue"
import { computed, ref, watch } from "vue"
import { TippyComponent } from "vue-tippy"
import * as E from "fp-ts/Either"

import { exportAsJSON } from "~/helpers/import-export/export/environment"
import {
  deleteEnvironment,
  duplicateEnvironment,
} from "~/newstore/environments"
import { handleTokenValidation } from "~/helpers/handleTokenValidation"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import IconCopy from "~icons/lucide/copy"
import IconEdit from "~icons/lucide/edit"
import IconMoreVertical from "~icons/lucide/more-vertical"
import IconTrash2 from "~icons/lucide/trash-2"
import IconImport from "~icons/lucide/folder-down"
import EnvironmentsImportExport from "~/components/environments/ImportExport.vue"
import { CurrentValueService } from "~/services/current-environment-value.service"

const t = useI18n()
const toast = useToast()

const emitEditEnvironment = async (): Promise<boolean> => {
  const isValidToken = await handleTokenValidation()
  if (!isValidToken) return false
  emit("edit-environment")
  return true
}

const props = withDefaults(
  defineProps<{
    environment: Environment
    environmentIndex: number | "Global" | null
    duplicateGlobalEnvironmentLoading?: boolean
    showContextMenuLoadingState?: boolean
  }>(),
  {
    duplicateGlobalEnvironmentLoading: false,
    showContextMenuLoadingState: false,
  }
)

const emit = defineEmits<{
  (e: "edit-environment"): void
  (e: "duplicate-global-environment"): void
}>()

const confirmRemove = ref(false)
const showImport = ref(false)

const secretEnvironmentService = useService(SecretEnvironmentService)
const currentEnvironmentValueService = useService(CurrentValueService)

watch(
  () => props.duplicateGlobalEnvironmentLoading,
  (newDuplicateGlobalEnvironmentLoadingVal) => {
    if (!newDuplicateGlobalEnvironmentLoadingVal) {
      options?.value?.tippy?.hide()
    }
  }
)

const isGlobalEnvironment = computed(() => props.environmentIndex === "Global")
const displayName = computed(() =>
  isGlobalEnvironment.value ? t("environment.global") : props.environment.name
)

const exportEnvironmentAsJSON = async () => {
  const { environment, environmentIndex } = props

  const message = await exportAsJSON(environment, environmentIndex)
  E.isRight(message)
    ? toast.success(t(message.right))
    : toast.error(t(message.left))
}

const tippyActions = ref<HTMLDivElement | null>(null)
const options = ref<TippyComponent | null>(null)
const edit = ref<typeof HoppSmartItem>()
const duplicate = ref<typeof HoppSmartItem>()
const exportAsJsonEl = ref<typeof HoppSmartItem>()
const deleteAction = ref<typeof HoppSmartItem>()

const removeEnvironment = async () => {
  const isValidToken = await handleTokenValidation()
  if (!isValidToken) return
  if (props.environmentIndex === null) return
  if (!isGlobalEnvironment.value) {
    deleteEnvironment(props.environmentIndex as number, props.environment.id)
    secretEnvironmentService.deleteSecretEnvironment(props.environment.id)
    currentEnvironmentValueService.deleteEnvironment(props.environment.id)
  }
  toast.success(`${t("state.deleted")}`)
}

const duplicateEnvironments = async () => {
  const isValidToken = await handleTokenValidation()
  if (!isValidToken) return
  if (props.environmentIndex === null) {
    return
  }

  if (isGlobalEnvironment.value) {
    emit("duplicate-global-environment")
    return
  }

  duplicateEnvironment(props.environmentIndex as number)
  toast.success(`${t("environment.duplicated")}`)
}
</script>
