<template>
  <section class="request-cases flex min-w-0 flex-col gap-4 p-4 sm:p-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold text-secondaryDark">
          {{ t("workbench.request_cases") }}
        </h2>
        <p class="mt-1 text-tiny leading-relaxed text-secondaryLight">
          {{ t("request_case.description") }}
        </p>
      </div>
      <div v-if="requestId" class="flex flex-wrap gap-2">
        <HoppButtonSecondary
          v-if="running"
          :label="t('request_case.stop')"
          :aria-label="t('request_case.stop')"
          outline
          @click="controller?.abort()"
        />
        <HoppButtonSecondary
          v-else-if="cases.length"
          :icon="IconPlay"
          :label="t('request_case.run_all')"
          :aria-label="t('request_case.run_all')"
          :disabled="locked || !!draft"
          outline
          @click="runCases(cases)"
        />
        <HoppButtonSecondary
          :icon="IconPlus"
          :label="t('workbench.add_case')"
          :aria-label="t('workbench.add_case')"
          :disabled="locked || !!draft || !!running"
          outline
          @click="startEditing()"
        />
      </div>
    </header>
    <p
      v-if="error"
      ref="errorElement"
      tabindex="-1"
      role="alert"
      class="rounded border border-red-300 bg-primary p-3 text-red-500"
    >
      {{ error }}
    </p>
    <p
      v-if="!requestId"
      class="rounded border border-divider p-4 text-secondaryLight"
    >
      {{ t("workbench.case_save_request") }}
      <HoppButtonSecondary
        class="ml-3"
        :label="t('request.save')"
        outline
        @click="invokeAction('request-response.save')"
      />
    </p>
    <form
      v-else-if="draft"
      class="min-w-0 rounded-lg border border-divider bg-primary"
      @submit.prevent="saveCase"
    >
      <fieldset
        :disabled="saving || uploading > 0"
        class="min-w-0 divide-y divide-divider"
      >
        <div class="space-y-3 p-4">
          <label class="case-label"
            >{{ t("workbench.case_name")
            }}<input
              v-model.trim="draft.name"
              required
              class="case-field"
              :placeholder="t('request_case.name_placeholder')"
          /></label>
        </div>
        <details open class="p-4">
          <summary class="case-summary">
            {{ t("request_case.request_override") }}
          </summary>
          <div class="mt-4 space-y-4">
            <p class="text-tiny text-secondaryLight">
              {{ t("request_case.inherit_hint") }}
            </p>
            <div class="flex min-w-0 flex-wrap gap-3">
              <label class="case-label w-32"
                >{{ t("request_case.method")
                }}<CaseSelect
                  :model-value="draft.overrides.method || '__inherit__'"
                  :options="methodOptions"
                  :label="t('request_case.method')"
                  @update:model-value="
                    draft.overrides.method =
                      $event === '__inherit__' ? '' : $event
                  "
              /></label>
              <label class="case-label min-w-0 flex-1"
                >URL<CaseVariableInput
                  v-model="draft.overrides.endpoint"
                  label="URL"
                  :variables="variableChoices"
                  :placeholder="request.endpoint"
              /></label>
            </div>
            <div class="space-y-2">
              <h3 class="font-medium">Query</h3>
              <CaseFields
                v-model="draft.overrides.params"
                label="Query"
                :variables="variableChoices"
                allow-remove
              />
            </div>
            <div class="space-y-2">
              <h3 class="font-medium">{{ t("tab.headers") }}</h3>
              <p class="text-tiny text-secondaryLight">
                {{ t("request_case.header_auth_hint") }}
              </p>
              <CaseFields
                v-model="draft.overrides.headers"
                :label="t('tab.headers')"
                :variables="variableChoices"
                allow-remove
              />
            </div>
            <div class="space-y-3">
              <label class="case-label"
                >{{ t("tab.body")
                }}<CaseSelect
                  :model-value="draft.overrides.body.mode"
                  :options="bodyOptions"
                  :label="t('tab.body')"
                  @update:model-value="setBodyMode"
              /></label>
              <label
                v-if="
                  ['json', 'text', 'urlencoded'].includes(
                    draft.overrides.body.mode
                  )
                "
                class="case-label"
                >{{ t("request_case.body_content")
                }}<CaseVariableInput
                  v-model="draft.overrides.body.text"
                  :label="t('request_case.body_content')"
                  :variables="variableChoices"
                  multiline
                />
              </label>
              <CaseFilePicker
                v-if="draft.overrides.body.mode === 'binary'"
                v-model="draft.overrides.body.file"
                @busy="uploading += $event ? 1 : -1"
              />
              <div
                v-if="draft.overrides.body.mode === 'multipart'"
                class="space-y-3"
              >
                <div
                  v-for="(field, index) in draft.overrides.body.fields"
                  :key="field.id"
                  class="space-y-2 rounded border border-divider p-3"
                >
                  <div class="flex min-w-0 flex-wrap gap-2">
                    <input
                      v-model="field.key"
                      :aria-label="`${t('request_case.form_key')} ${index + 1}`"
                      :placeholder="t('request_case.key')"
                      required
                      class="case-field min-w-0 flex-1"
                    />
                    <CaseSelect
                      v-model="field.kind"
                      :options="fieldKindOptions"
                      :label="`${t('request_case.form_kind')} ${index + 1}`"
                      class="w-28"
                    />
                    <button
                      type="button"
                      class="case-icon"
                      :aria-label="`${t('action.delete')} ${t('request_case.form_key')} ${index + 1}`"
                      @click="draft.overrides.body.fields.splice(index, 1)"
                    >
                      <IconTrash />
                    </button>
                  </div>
                  <CaseFilePicker
                    v-if="field.kind === 'file'"
                    v-model="field.file"
                    @busy="uploading += $event ? 1 : -1"
                  />
                  <CaseVariableInput
                    v-else
                    v-model="field.value"
                    :label="`${t('request_case.form_value')} ${index + 1}`"
                    :variables="variableChoices"
                    :placeholder="t('request_case.value')"
                  />
                </div>
                <button type="button" class="case-add" @click="addFormField">
                  <IconPlus />{{ t("request_case.add_field") }}
                </button>
              </div>
            </div>
          </div>
        </details>
        <details open class="p-4">
          <summary class="case-summary">
            {{ t("request_case.variables_and_environment")
            }}<span
              v-if="variableRows.length"
              class="ml-2 text-tiny text-secondaryLight"
              >{{ variableRows.length }}</span
            >
          </summary>
          <div class="mt-3 space-y-3">
            <label class="case-label"
              >{{ t("request_case.run_environment") }}
              <CaseSelect
                v-model="environmentSelection"
                :options="environmentOptions"
                :label="t('request_case.run_environment')"
              />
            </label>
            <p class="text-tiny leading-relaxed text-secondaryLight">
              {{ t("request_case.variable_hint") }}
            </p>
            <label class="case-label">
              {{ t("request_case.timeout_label") }}
              <input
                :value="draft.timeoutMs ?? ''"
                type="number"
                min="1"
                :max="MAX_CASE_TIMEOUT_MS"
                step="1"
                class="case-field"
                :placeholder="t('request_case.timeout_inherit')"
                @input="
                  draft.timeoutMs =
                    ($event.target as HTMLInputElement).value === ''
                      ? undefined
                      : Number(($event.target as HTMLInputElement).value)
                "
              />
            </label>
            <p class="text-tiny leading-relaxed text-secondaryLight">
              {{ t("request_case.timeout_help") }}
            </p>
            <h3 class="font-medium">{{ t("request_case.variables") }}</h3>
            <CaseFields
              v-model="variableRows"
              :label="t('request_case.variables')"
              :variables="variableChoices"
              exclude-self
            />
          </div>
        </details>
        <details class="p-4">
          <summary class="case-summary">
            {{ t("request_case.scripts") }} ·
            {{
              scriptOptions.find((item) => item.value === draft?.scripts)?.label
            }}
          </summary>
          <div class="mt-3 space-y-3">
            <CaseSelect
              :model-value="draft.scripts"
              :options="scriptOptions"
              :label="t('request_case.scripts')"
              @update:model-value="setScriptMode"
            />
            <p class="text-tiny text-secondaryLight">
              {{ t("request_case.script_hint") }}
            </p>
            <template v-if="draft.scripts === 'custom'">
              <label class="case-label"
                >{{ t("tab.pre_request_script")
                }}<textarea
                  v-model="draft.preRequestScript"
                  rows="4"
                  class="case-field font-mono"
                  spellcheck="false"
                />
              </label>
              <label class="case-label"
                >{{ t("request_case.post_script")
                }}<textarea
                  v-model="draft.testScript"
                  rows="4"
                  class="case-field font-mono"
                  spellcheck="false"
                />
              </label>
            </template>
          </div>
        </details>
        <div class="space-y-3 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold text-secondaryDark">
              {{ t("request_case.assertions") }}
            </h3>
            <button type="button" class="case-add" @click="addAssertion">
              <IconPlus />{{ t("request_case.add_assertion") }}
            </button>
          </div>
          <div
            v-for="(assertion, index) in draft.assertions"
            :key="assertion.id"
            class="assertion-editor space-y-3 rounded border border-divider bg-primaryLight p-3"
          >
            <div class="flex items-center justify-between">
              <strong class="text-tiny text-secondaryLight">{{
                t("request_case.assertion_number", { number: index + 1 })
              }}</strong
              ><button
                type="button"
                class="case-icon"
                :disabled="draft.assertions.length === 1"
                :aria-label="`${t('action.delete')} ${t('request_case.assertion_number', { number: index + 1 })}`"
                @click="draft.assertions.splice(index, 1)"
              >
                <IconTrash />
              </button>
            </div>
            <div class="grid min-w-0 gap-3 sm:grid-cols-2">
              <CaseSelect
                v-model="assertion.target"
                :options="targetOptions"
                :label="`${t('request_case.assertion_number', { number: index + 1 })} ${t('request_case.target')}`"
              />
              <input
                v-if="['json', 'header'].includes(assertion.target)"
                v-model="assertion.path"
                :required="assertion.target === 'header'"
                :aria-label="`${t('request_case.assertion_number', { number: index + 1 })} ${t('request_case.path')}`"
                :placeholder="
                  assertion.target === 'json'
                    ? 'data.items[0].id'
                    : 'Content-Type'
                "
                class="case-field min-w-0"
              />
              <CaseSelect
                v-model="assertion.operator"
                :options="operatorOptions"
                :label="`${t('request_case.assertion_number', { number: index + 1 })} ${t('request_case.operator')}`"
              />
              <input
                v-if="!['exists', 'not_exists'].includes(assertion.operator)"
                v-model="assertion.expected"
                :aria-label="`${t('request_case.assertion_number', { number: index + 1 })} ${t('request_case.expected')}`"
                :placeholder="t('request_case.expected')"
                class="case-field min-w-0"
              />
            </div>
          </div>
          <p class="text-tiny text-secondaryLight">
            {{ t("request_case.assertion_hint") }}
          </p>
        </div>
      </fieldset>
      <footer
        class="flex flex-wrap gap-2 border-t border-divider bg-primaryLight p-4"
      >
        <HoppButtonPrimary
          type="submit"
          :aria-label="t('action.save')"
          :label="t('action.save')"
          :loading="saving"
          :disabled="saving || uploading > 0"
        />
        <HoppButtonSecondary
          type="button"
          :label="t('action.cancel')"
          :aria-label="t('action.cancel')"
          :disabled="saving || uploading > 0"
          outline
          @click="cancelEditing"
        />
      </footer>
    </form>
    <p
      v-else-if="!cases.length && !loading"
      class="rounded border border-dashed border-divider p-8 text-center text-secondaryLight"
    >
      {{ t("workbench.case_empty") }}
    </p>
    <article
      v-for="entry in cases"
      :key="entry.id"
      class="case-card min-w-0 overflow-hidden rounded-lg border border-divider bg-primary"
      :data-case-id="entry.id"
    >
      <div class="flex flex-wrap items-start justify-between gap-3 p-4">
        <div class="min-w-0 flex-1">
          <strong class="break-words text-secondaryDark">{{
            entry.name
          }}</strong>
          <p class="mt-1 text-tiny text-secondaryLight">
            {{ t("request_case.summary", { count: entry.assertions.length }) }}
            ·
            {{
              scriptOptions.find((item) => item.value === entry.scripts)?.label
            }}
            <span v-if="entry.timeoutMs"> · {{ entry.timeoutMs }} ms</span>
          </p>
          <p
            v-if="results[entry.id]"
            role="status"
            class="mt-2 flex flex-wrap items-center gap-2 font-medium"
            :class="
              results[entry.id].error || !passed(results[entry.id].result)
                ? 'text-red-500'
                : 'text-green-600'
            "
          >
            <template v-if="results[entry.id].error">{{
              results[entry.id].error
            }}</template>
            <template v-else-if="results[entry.id].result"
              >{{
                passed(results[entry.id].result)
                  ? t("request_case.passed")
                  : t("request_case.failed")
              }}<span class="text-tiny font-normal text-secondaryLight"
                >HTTP {{ results[entry.id].result?.status }} ·
                {{ Math.round(results[entry.id].result?.duration ?? 0) }}
                ms</span
              ></template
            >
          </p>
        </div>
        <div class="flex items-center gap-1">
          <HoppButtonSecondary
            :icon="IconPlay"
            :label="running === entry.id ? t('state.loading') : t('test.run')"
            :aria-label="t('test.run')"
            :loading="running === entry.id"
            :disabled="!!running || !!draft || locked"
            @click="runCases([entry])"
          />
          <HoppButtonSecondary
            :icon="IconPencil"
            :title="t('action.edit')"
            :aria-label="t('action.edit')"
            :disabled="locked || !!running || !!draft"
            @click="startEditing(entry)"
          />
          <HoppButtonSecondary
            :icon="IconTrash"
            :title="t('action.delete')"
            :aria-label="t('action.delete')"
            :disabled="locked || !!running || !!draft"
            @click="removeCase(entry.id)"
          />
        </div>
      </div>
      <details
        v-if="results[entry.id]?.result"
        open
        class="border-t border-divider p-4"
      >
        <summary class="case-summary text-tiny">
          {{ t("request_case.assertion_results") }}
        </summary>
        <div class="mt-3 space-y-3">
          <div
            v-for="item in results[entry.id].result?.assertions"
            :key="item.assertion.id"
            class="rounded border border-divider p-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <IconCheck v-if="item.passed" class="text-green-600" /><IconX
                v-else
                class="text-red-500"
              /><strong>{{
                targetOptions.find(
                  (option) => option.value === item.assertion.target
                )?.label
              }}</strong
              ><code class="min-w-0 break-all text-tiny">{{
                item.assertion.path
              }}</code
              ><span class="text-tiny text-secondaryLight">{{
                operatorOptions.find(
                  (option) => option.value === item.assertion.operator
                )?.label
              }}</span>
            </div>
            <div class="mt-2 grid min-w-0 gap-2 text-tiny sm:grid-cols-2">
              <div class="min-w-0">
                <span class="text-secondaryLight">{{
                  t("request_case.expected")
                }}</span>
                <pre class="mt-1 whitespace-pre-wrap break-all font-mono">{{
                  ["exists", "not_exists"].includes(item.assertion.operator)
                    ? operatorOptions.find(
                        (option) => option.value === item.assertion.operator
                      )?.label
                    : format(item.expected)
                }}</pre>
              </div>
              <div class="min-w-0">
                <span class="text-secondaryLight">{{
                  t("request_case.actual")
                }}</span>
                <pre class="mt-1 whitespace-pre-wrap break-all font-mono">{{
                  item.error ? translateError(item.error) : format(item.actual)
                }}</pre>
              </div>
            </div>
          </div>
          <p
            v-if="results[entry.id].result?.scriptError"
            role="alert"
            class="break-all text-red-500"
          >
            {{ t("request_case.post_failed") }}:
            {{ results[entry.id].result?.scriptError }}
          </p>
          <div
            v-for="(script, index) in results[entry.id].result?.scripts"
            :key="index"
            class="flex gap-2 break-all text-tiny"
            :class="script.passed ? 'text-green-600' : 'text-red-500'"
          >
            <IconCheck v-if="script.passed" /><IconX v-else /><span
              >{{ script.name }} · {{ script.message }}</span
            >
          </div>
        </div>
      </details>
    </article>
  </section>
</template>

<script setup lang="ts">
import { invokeAction } from "~/helpers/actions"
import { useService } from "dioc/vue"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { cloneDeep } from "lodash-es"
import {
  MAX_CASE_TIMEOUT_MS,
  CaseTimeoutError,
  type HoppRESTRequest,
} from "@apirequest/data"
import { useI18n } from "~/composables/i18n"
import { useWorkbenchRequestCases } from "~/composables/workbenchRequestCases"
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import {
  CaseSchema,
  caseBody,
  expectedValue,
  newRequestCase,
  type RequestCase,
  type CasePatch,
  type CaseBody,
  type CaseVariableChoice,
} from "~/helpers/request-cases/model"
import {
  executeRequestCase,
  type CaseRunResult,
} from "~/helpers/request-cases/execute"
import { requestErrorFeedback } from "~/helpers/request-feedback"
import { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import CaseSelect from "./Select.vue"
import CaseFields from "./CaseFields.vue"
import CaseVariableInput from "./CaseVariableInput.vue"
import { useReadonlyStream } from "~/composables/stream"
import {
  environments$,
  globalEnv$,
  selectedEnvironmentIndex$,
} from "~/newstore/environments"
import CaseFilePicker from "./CaseFilePicker.vue"
import IconPencil from "~icons/lucide/pencil"
import IconPlay from "~icons/lucide/play"
import IconPlus from "~icons/lucide/plus"
import IconTrash from "~icons/lucide/trash-2"
import IconCheck from "~icons/lucide/check"
import IconX from "~icons/lucide/x"
const props = defineProps<{
  request: HoppRESTRequest
  requestId?: string
  inherited?: HoppInheritedProperty
}>()
const t = useI18n(),
  interceptor = useService(KernelInterceptorService)
const { cases: stored, ready, update } = useWorkbenchRequestCases()
const errorElement = ref<HTMLElement>()
const loading = ref(true),
  failed = ref(false),
  saving = ref(false),
  uploading = ref(0),
  error = ref("")
const locked = computed(
  () => loading.value || failed.value || saving.value || uploading.value > 0
)
void ready
  .catch(() => {
    failed.value = true
    error.value = t("request_case.load_failed")
  })
  .finally(() => {
    loading.value = false
  })
const cases = computed(() =>
  props.requestId && Object.hasOwn(stored.value, props.requestId)
    ? stored.value[props.requestId].map((entry) => CaseSchema.parse(entry))
    : []
)
const draft = ref<RequestCase>(),
  variableRows = ref<CasePatch[]>([])
const availableEnvironments = useReadonlyStream(environments$, [])
const globals = useReadonlyStream(globalEnv$, { v: 2, variables: [] })
const currentEnvironmentIndex = useReadonlyStream(selectedEnvironmentIndex$, {
  type: "NO_ENV_SELECTED",
})
const currentEnvironment = computed(() => {
  const selection = currentEnvironmentIndex.value
  return availableEnvironments.value[selection.index]
})
const environmentSelection = computed({
  get: () =>
    draft.value?.environmentID === undefined
      ? "__current__"
      : draft.value.environmentID === null
        ? "__none__"
        : draft.value.environmentID,
  set: (value: string) => {
    if (draft.value)
      draft.value.environmentID =
        value === "__current__"
          ? undefined
          : value === "__none__"
            ? null
            : value
  },
})
const environmentOptions = computed(() => [
  {
    value: "__current__",
    label: `${t("request_case.current_environment")} · ${currentEnvironment.value?.name || t("environment.no_environment")}`,
  },
  { value: "__none__", label: t("environment.no_environment") },
  ...availableEnvironments.value.map((environment) => ({
    value: environment.id,
    label: environment.name,
  })),
  ...(draft.value?.environmentID &&
  !availableEnvironments.value.some(
    (environment) => environment.id === draft.value?.environmentID
  )
    ? [
        {
          value: draft.value.environmentID,
          label: t("request_case.environment_missing"),
        },
      ]
    : []),
])
const variableChoices = computed<CaseVariableChoice[]>(() => {
  const choices = new Map<string, CaseVariableChoice>()
  for (const variable of globals.value.variables)
    if (variable.key)
      choices.set(variable.key, {
        key: variable.key,
        source: t("request_case.global_variables"),
        scope: "global",
      })
  const environment =
    draft.value?.environmentID === undefined
      ? currentEnvironment.value
      : availableEnvironments.value.find(
          (environment) => environment.id === draft.value?.environmentID
        )
  for (const variable of environment?.variables ?? [])
    if (variable.key)
      choices.set(variable.key, {
        key: variable.key,
        source: `${t("request_case.environment_variables")} · ${environment?.name}`,
        scope: "environment",
      })
  for (const variable of [
    ...props.request.requestVariables.filter((variable) => variable.active),
    ...variableRows.value,
  ])
    if (variable.key.trim())
      choices.set(variable.key.trim(), {
        key: variable.key.trim(),
        source: t("request_case.variables"),
        scope: "case",
      })
  return [...choices.values()].sort((a, b) => a.key.localeCompare(b.key))
})
const results = ref<
  Record<
    string,
    {
      result?: CaseRunResult
      error?: string
    }
  >
>({})
const running = ref<string>()
let controller: AbortController | undefined,
  generation = 0
const methodOptions = computed(() => [
  { value: "__inherit__", label: t("request_case.inherit") },
  ...["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
    (value) => ({ value, label: value })
  ),
])
const bodyOptions = computed(
  () =>
    [
      { value: "inherit", label: t("request_case.inherit") },
      { value: "none", label: t("request_case.no_body") },
      { value: "json", label: "JSON" },
      { value: "text", label: t("request_case.text") },
      { value: "urlencoded", label: "x-www-form-urlencoded" },
      { value: "multipart", label: "form-data" },
      { value: "binary", label: t("request_case.binary") },
    ] as const
)
const fieldKindOptions = computed(
  () =>
    [
      { value: "text", label: t("request_case.text") },
      { value: "file", label: t("request_case.file") },
    ] as const
)
const scriptOptions = computed(() =>
  (["inherit", "disabled", "custom"] as const).map((value) => ({
    value,
    label: t(`request_case.script_${value}`),
  }))
)
const targetOptions = computed(() =>
  (["status", "json", "header", "body", "duration"] as const).map((value) => ({
    value,
    label: t(`request_case.target_${value}`),
  }))
)
const operatorOptions = computed(() =>
  (
    [
      "eq",
      "ne",
      "contains",
      "exists",
      "not_exists",
      "lt",
      "lte",
      "gt",
      "gte",
    ] as const
  ).map((value) => ({ value, label: t(`request_case.op_${value}`) }))
)
function startEditing(entry?: RequestCase) {
  error.value = ""
  draft.value = entry ? cloneDeep(entry) : { ...newRequestCase(), name: "" }
  variableRows.value = Object.entries(draft.value.variables).map(
    ([key, value]) => ({ key, value, remove: false })
  )
}
function cancelEditing() {
  draft.value = undefined
  error.value = ""
}
function setBodyMode(mode: CaseBody["mode"]) {
  if (!draft.value) return
  draft.value.overrides.body.mode = mode
  if (
    !draft.value.overrides.body.text &&
    typeof props.request.body.body === "string"
  )
    draft.value.overrides.body.text = props.request.body.body
}
function setScriptMode(mode: RequestCase["scripts"]) {
  if (!draft.value) return
  draft.value.scripts = mode
  if (
    mode === "custom" &&
    !draft.value.preRequestScript &&
    !draft.value.testScript
  ) {
    draft.value.preRequestScript = props.request.preRequestScript
    draft.value.testScript = props.request.testScript
  }
}
function addAssertion() {
  draft.value?.assertions.push({
    id: crypto.randomUUID(),
    target: "json",
    path: "",
    operator: "eq",
    expected: "",
  })
}
function addFormField() {
  draft.value?.overrides.body.fields.push({
    id: crypto.randomUUID(),
    key: "",
    value: "",
    kind: "text",
  })
}
function translateError(message: string) {
  const code = message.split(":")[0]
  if (code.startsWith("case_"))
    return `${t(`request_case.${code.slice(5)}`)}${message.includes(":") ? ": " + message.slice(code.length + 1) : ""}`
  return message
}
async function saveCase() {
  const requestId = props.requestId,
    entry = draft.value
  if (!requestId || !entry?.name || locked.value) return
  error.value = ""
  try {
    entry.variables = Object.fromEntries(
      variableRows.value
        .filter((row) => row.key.trim())
        .map((row) => [row.key.trim(), row.value])
    )
    entry.overrides.params = entry.overrides.params.filter((row) =>
      row.key.trim()
    )
    entry.overrides.headers = entry.overrides.headers.filter((row) =>
      row.key.trim()
    )
    entry.assertions.forEach((assertion) => expectedValue(assertion))
    caseBody(entry.overrides.body)
    const updated = CaseSchema.parse(entry)
    saving.value = true
    await update(requestId, (entries) =>
      entries.some((item) => item.id === entry.id)
        ? entries.map((item) => (item.id === entry.id ? updated : item))
        : [...entries, updated]
    )
    delete results.value[entry.id]
    if (props.requestId === requestId) draft.value = undefined
  } catch (e) {
    error.value = translateError(
      (e as Error).message.startsWith("case_")
        ? (e as Error).message
        : "case_save_failed"
    )
  } finally {
    saving.value = false
  }
}
async function removeCase(id: string) {
  if (!props.requestId || locked.value) return
  saving.value = true
  error.value = ""
  try {
    await update(props.requestId, (entries) =>
      entries.filter((entry) => entry.id !== id)
    )
    delete results.value[id]
  } catch {
    error.value = t("request_case.save_failed")
  } finally {
    saving.value = false
  }
}
function passed(result?: CaseRunResult) {
  return (
    !!result &&
    !result.scriptError &&
    result.assertions.every((item) => item.passed) &&
    result.scripts.every((item) => item.passed)
  )
}
function format(value: unknown) {
  if (value === undefined) return t("request_case.missing")
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return text.length > 1500 ? text.slice(0, 1500) + "…" : text
}
async function runCases(entries: RequestCase[]) {
  if (running.value || draft.value || locked.value) return
  const sequence = ++generation,
    abort = new AbortController()
  controller = abort
  const base = cloneDeep(props.request),
    inherited = cloneDeep(props.inherited)
  for (const entry of entries) {
    if (abort.signal.aborted || sequence !== generation) break
    running.value = entry.id
    delete results.value[entry.id]
    try {
      const result = await executeRequestCase(
        base,
        cloneDeep(entry),
        inherited,
        interceptor,
        abort.signal
      )
      if (sequence === generation) results.value[entry.id] = { result }
    } catch (e) {
      if (sequence !== generation) break
      const feedback = requestErrorFeedback(e)
      results.value[entry.id] = {
        error:
          e instanceof CaseTimeoutError
            ? t("request_case.timeout_detail", {
                limit: e.timeoutMs,
                elapsed: e.elapsedMs,
              })
            : feedback.kind === "cancelled"
              ? t("request_case.cancelled")
              : feedback.kind === "timeout"
                ? t("request_case.timeout")
                : e instanceof Error && e.message.startsWith("case_")
                  ? translateError(e.message)
                  : t("workbench.case_network_error"),
      }
    }
  }
  if (sequence === generation) {
    running.value = undefined
    controller = undefined
  }
}
watch(
  () => props.requestId,
  () => {
    controller?.abort()
    generation++
    running.value = undefined
    draft.value = undefined
    results.value = {}
    error.value = ""
  }
)
watch(error, async (value) => {
  if (!value) return
  await nextTick()
  errorElement.value?.scrollIntoView({ block: "nearest" })
  errorElement.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  generation++
  controller?.abort()
})
</script>

<style scoped lang="scss">
.request-cases {
  > * {
    flex-shrink: 0;
  }
  :deep(.case-field) {
    @apply rounded border border-divider bg-primary px-3 py-2 text-secondaryDark outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50;
  }
  :deep(.case-label) {
    @apply flex min-w-0 flex-col gap-2;
  }
  :deep(.case-summary) {
    @apply cursor-pointer font-medium text-secondaryDark;
  }
  :deep(.case-icon) {
    @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-secondaryLight hover:bg-primaryLight hover:text-secondaryDark disabled:opacity-40;
  }
  :deep(.case-add) {
    @apply inline-flex items-center gap-2 rounded border border-divider bg-primary px-3 py-2 text-tiny font-medium text-secondaryDark hover:bg-primaryLight;
  }
  pre {
    overflow-wrap: anywhere;
  }
}
</style>
