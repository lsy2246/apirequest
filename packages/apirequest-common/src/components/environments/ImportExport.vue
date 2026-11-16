<template>
  <HoppSmartModal
    dialog
    :title="
      targetEnvironment
        ? t('environment.import_into', { name: targetEnvironment.name })
        : t('environment.import_json')
    "
    @close="emit('hide-modal')"
  >
    <template #body>
      <p v-if="targetEnvironment" class="mb-4 text-secondaryLight">
        {{ t("environment.import_merge_hint") }}
      </p>
      <p v-if="targetImportError" role="alert" class="mb-4 text-red-500">
        {{ targetImportError }}
      </p>
      <FileImport
        accepted-file-types=".json,application/json"
        caption="import.apirequest_environment_description"
        :loading="isRESTImporterInProgress"
        @import-from-file="importJSON"
      />
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { Environment, generateUniqueRefId } from "@apirequest/data";
import * as E from "fp-ts/Either";
import { ref } from "vue";
import { useService } from "dioc/vue";
import { useI18n } from "~/composables/i18n";
import { useToast } from "~/composables/toast";
import FileImport from "~/components/importExport/ImportExportSteps/FileImport.vue";
import { hoppEnvImporter } from "~/helpers/import-export/import/hoppEnv";
import { mergeEnvironmentVariables } from "~/helpers/import-export/import/merge-environment";
import { populateLocalStoresFromVariables, promoteInitialValueForImport, stripClientLocalValuesForWire } from "~/helpers/clientLocalVariables";
import { addGlobalEnvVariable, appendEnvironments, getGlobalVariables, environmentsStore, setGlobalEnvVariables, updateEnvironment } from "~/newstore/environments";
import { CurrentValueService } from "~/services/current-environment-value.service";
import { SecretEnvironmentService } from "~/services/secret-environment.service";
import { platform } from "~/platform";
const props = defineProps<{
  teamEnvironments?: Environment[]
  teamId?: string
  environmentType: "MY_ENV" | "TEAM_ENV"
  targetEnvironment?: Environment
}>()
const t = useI18n()
const toast = useToast()
const currentEnvironmentValueService = useService(CurrentValueService)
const secretEnvironmentService = useService(SecretEnvironmentService)
const isRESTImporterInProgress = ref(false)
const targetImportError = ref("")
const showImportFailedError = () => toast.error(t("import.failed"))
async function importJSON(environments: string[]) {
  if (isRESTImporterInProgress.value) return
  isRESTImporterInProgress.value = true
  targetImportError.value = ""
  try {
    const res = await hoppEnvImporter(environments)()
    if (E.isRight(res)) {
      if (props.targetEnvironment) {
        if (res.right.length !== 1)
          throw new Error(t("environment.import_one_environment"))
        importToTarget(res.right[0])
      } else {
        const globals = res.right.filter((env) => env.id === "Global")
        await handleImportToStore(
          res.right.filter((env) => !globals.includes(env)),
          globals
        )
      }
      platform.analytics?.logEvent({
        type: "HOPP_IMPORT_ENVIRONMENT",
        platform: "rest",
        workspaceType: "personal",
      })
      emit("hide-modal")
    } else {
      targetImportError.value = t("import.failed")
      showImportFailedError()
    }
  } catch (failure) {
    targetImportError.value =
      (failure as Error).message === t("environment.import_one_environment")
        ? t("environment.import_one_environment")
        : t("import.failed")
    showImportFailedError()
  } finally {
    isRESTImporterInProgress.value = false
  }
}
function importToTarget(imported: Environment) {
  const id = props.targetEnvironment!.id
  const isGlobal = id === "Global"
  const index = environmentsStore.value.environments.findIndex(
    (environment) => environment.id === id
  )
  const current = isGlobal
    ? { ...props.targetEnvironment!, variables: getGlobalVariables() }
    : environmentsStore.value.environments[index]
  if (!current) throw new Error(t("import.failed"))
  const hydrated = current.variables.map((variable, varIndex) => {
    if (variable.secret) {
      const stored = secretEnvironmentService.getSecretEnvironmentVariable(
        id,
        varIndex
      )
      return {
        ...variable,
        initialValue: stored?.initialValue ?? variable.initialValue,
        currentValue: stored?.value ?? variable.currentValue,
      }
    }
    return {
      ...variable,
      currentValue:
        currentEnvironmentValueService.getEnvironmentVariable(id, varIndex)
          ?.currentValue ?? variable.currentValue,
    }
  })
  const variables = mergeEnvironmentVariables(hydrated, imported.variables)
  populateLocalStoresFromVariables(id, variables)
  const updated = {
    ...current,
    variables: stripClientLocalValuesForWire(variables),
  }
  if (isGlobal) setGlobalEnvVariables(updated)
  else updateEnvironment(index, updated)
  toast.success(t("state.file_imported"))
}
const handleImportToStore = async (
  environments: Environment[],
  globalEnvs: Environment[] = []
) => {
  // Per-env populate happens inside MY_ENV / TEAMS branches below, each
  // keyed appropriately. Globals share the single `"Global"` key and must
  // merge with existing entries — hydrate, concat, populate once.
  if (globalEnvs.length > 0) {
    const importedGlobals = globalEnvs.flatMap(({ variables }) => variables)
    const existingHydrated: Environment["variables"] = getGlobalVariables().map(
      (v, i) => {
        if (v.secret) {
          const stored = secretEnvironmentService.getSecretEnvironmentVariable(
            "Global",
            i
          )
          return {
            ...v,
            initialValue: stored?.initialValue ?? "",
            currentValue: stored?.value ?? "",
          }
        }
        const stored = currentEnvironmentValueService.getEnvironmentVariable(
          "Global",
          i
        )
        return {
          ...v,
          currentValue: stored?.currentValue ?? v.currentValue,
        }
      }
    )
    // `populateLocalStoresFromVariables` is a full replace for `"Global"`.
    // Relies on the sync path above (`getGlobalVariables()` → hydrate →
    // concat) running with no awaits in between — a future refactor that
    // introduces one between the snapshot and this call would silently
    // drop any global added meanwhile.
    //
    // Promote on the IMPORTED slice only (not `existingHydrated`) so a
    // legacy export shape (`initialValue` set, `currentValue: ""`) lands
    // its secrets correctly, while user-cleared existing globals stay
    // cleared per the rehydration semantic.
    populateLocalStoresFromVariables("Global", [
      ...existingHydrated,
      ...promoteInitialValueForImport(importedGlobals),
    ])
    // Append stripped imports; varIndex aligns with the hydrated entries.
    stripClientLocalValuesForWire(importedGlobals).forEach(
      ({ key, initialValue, currentValue, secret }) => {
        addGlobalEnvVariable({ key, initialValue, currentValue, secret })
      }
    )
  }
  {
    // Always stamp a fresh temp id, even if the export carried one —
    // re-using the exported `id` would land the populate on a store
    // entry already owned by the original environment (then the sync
    // remap would migrate that entry away, blanking the original's
    // secrets). A fresh id guarantees no collision with anything in
    // the store before the sync handler creates the new backend row.
    const envsWithIds = environments.map((env) => ({
      ...env,
      id: generateUniqueRefId("env"),
    }))
    envsWithIds.forEach((env) => {
      populateLocalStoresFromVariables(
        env.id,
        promoteInitialValueForImport(env.variables)
      )
    })
    const strippedEnvironments = envsWithIds.map((env) => ({
      ...env,
      variables: stripClientLocalValuesForWire(env.variables),
    }))
    appendEnvironments(strippedEnvironments)
    toast.success(t("state.file_imported"))
  }
}
const emit = defineEmits<{
  (e: "hide-modal"): () => void
}>()
</script>
