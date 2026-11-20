<template>
  <FormFrame
    wide
    :embedded="embedded"
    :title="
      plan
        ? `${t('workbench_schedule.settings')} · ${plan.name}`
        : t('workbench_schedule.new')
    "
    @close="!saving && emit('close')"
  >
    <template #body>
      <form
        id="workbench-automation-schedule"
        ref="form"
        class="grid gap-6 md:grid-cols-2"
        :inert="saving"
        :aria-busy="saving"
        @submit.prevent="save()"
      >
        <div class="min-w-0">
          <AutomationCaseSelector
            v-model="selectedCaseIDs"
            :collections="collections"
            :cases="availableCases"
          />
        </div>
        <div class="min-w-0 space-y-4">
          <label class="block space-y-1">
            <span>{{ t("workbench_schedule.environment") }}</span>
            <WorkbenchSelect
              v-model="environmentID"
              :label="t('workbench_schedule.environment')"
              :options="environmentOptions"
            />
          </label>
          <p
            v-if="schedulingAvailable && type !== 'off' && environmentID"
            class="text-xs text-secondaryLight"
          >
            {{ t("workbench_schedule.values_notice") }}
          </p>
          <fieldset class="space-y-3 border-t border-divider pt-4">
            <legend class="font-semibold">
              {{ t("collection_runner.run_config") }}
            </legend>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block space-y-1">
                <span>{{ t("collection_runner.iterations") }}</span>
                <input
                  v-model.number="config.iterations"
                  name="iterations"
                  type="number"
                  class="input w-full"
                  min="1"
                  max="1000"
                  step="1"
                  required
                />
              </label>
              <label class="block space-y-1">
                <span>{{ t("collection_runner.delay") }} · ms</span>
                <input
                  v-model.number="config.delay"
                  name="delay"
                  type="number"
                  class="input w-full"
                  min="0"
                  max="60000"
                  step="1"
                  required
                />
              </label>
            </div>
            <div class="flex flex-col items-start gap-3">
              <WorkbenchToggle v-model="config.stopOnError">{{
                t("collection_runner.stop_on_error")
              }}</WorkbenchToggle>
              <WorkbenchToggle v-model="config.persistResponses">{{
                t("collection_runner.persist_responses")
              }}</WorkbenchToggle>
              <WorkbenchToggle v-model="config.executeScripts">{{
                t("collection_runner.execute_scripts")
              }}</WorkbenchToggle>
            </div>
          </fieldset>
          <fieldset
            v-if="schedulingAvailable"
            class="space-y-3 border-t border-divider pt-4"
          >
            <legend class="font-semibold">
              {{ t("automation_webhook.title") }}
            </legend>
            <WorkbenchToggle
              :model-value="config.webhook?.enabled ?? false"
              @update:model-value="setWebhook('enabled', $event)"
            >
              {{ t("automation_webhook.enable") }}
            </WorkbenchToggle>
            <template v-if="config.webhook?.enabled">
              <NotificationChannelPicker
                ref="notificationPicker"
                :model-value="config.webhook.channelIDs"
                @update:model-value="setNotificationChannels"
              />
              <p class="text-xs text-secondaryLight">
                {{ t("automation_webhook.summary_help") }}
              </p>
              <WorkbenchToggle
                :model-value="config.webhook?.includeErrorDetails ?? false"
                @update:model-value="setWebhook('includeErrorDetails', $event)"
              >
                {{ t("automation_webhook.include_details") }}
              </WorkbenchToggle>
              <p class="text-xs text-secondaryLight">
                {{ t("automation_webhook.details_help") }}
              </p>
              <router-link
                to="/settings"
                class="inline-block text-xs text-accent"
                >{{ t("automation_webhook.configure") }}</router-link
              >
            </template>
          </fieldset>
          <h4
            v-if="schedulingAvailable"
            class="border-t border-divider pt-4 font-semibold"
          >
            {{ t("workbench_schedule.title") }}
          </h4>
          <label v-if="schedulingAvailable" class="block space-y-1">
            <span>{{ t("workbench_schedule.rule") }}</span>
            <WorkbenchSelect
              v-model="type"
              :label="t('workbench_schedule.rule')"
              :options="ruleOptions"
            />
          </label>
          <label
            v-if="schedulingAvailable && type === 'interval'"
            class="block space-y-1"
          >
            <span>{{ t("workbench_schedule.minutes") }}</span>
            <input
              v-model.number="minutes"
              type="number"
              class="input w-full"
              min="1"
              max="10080"
              required
            />
          </label>
          <div
            v-else-if="schedulingAvailable && type !== 'off'"
            class="space-y-3"
          >
            <label v-if="type === 'weekly'" class="block space-y-1">
              <span>{{ t("workbench_schedule.weekday") }}</span>
              <WorkbenchSelect
                :model-value="String(weekday)"
                :label="t('workbench_schedule.weekday')"
                :options="
                  weekdays.map((day) => ({
                    value: String(day.value),
                    label: day.label,
                  }))
                "
                @update:model-value="weekday = Number($event)"
              />
            </label>
            <label class="block space-y-1">
              <span>{{ t("workbench_schedule.time") }} · {{ timezone }}</span>
              <input v-model="time" type="time" class="input w-full" required />
            </label>
          </div>
          <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
        </div>
      </form>
    </template>
    <template #footer>
      <HoppButtonPrimary
        :label="plan ? t('action.save') : t('action.create')"
        type="submit"
        form="workbench-automation-schedule"
        :loading="saving"
        :disabled="saving || !selectedChoices.length"
      />
      <HoppButtonSecondary
        :label="t('action.cancel')"
        :disabled="saving"
        @click="emit('close')"
      />
    </template>
  </FormFrame>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import FormFrame from "./FormFrame.vue"
import WorkbenchSelect from "./Select.vue"
import WorkbenchToggle from "./Toggle.vue"
import AutomationCaseSelector from "./AutomationCaseSelector.vue"
import NotificationChannelPicker from "./NotificationChannelPicker.vue"
import { useWorkbenchRequestCases } from "~/composables/workbenchRequestCases"
import {
  collectionCaseChoices,
  snapshotCases,
} from "~/helpers/request-cases/automation"
import {
  AutomationConfigSchema,
  getAutomationConfig,
  type HoppCollection,
} from "@apirequest/data"
import { useService } from "dioc/vue"
import { useI18n } from "~/composables/i18n"
import { useReadonlyStream } from "~/composables/stream"
import { useWorkbenchCollections } from "~/composables/workbenchCollections"
import {
  workbenchMcpAPI,
  workbenchSchedulesAvailable,
  type AutomationSchedule,
  type AutomationScheduleRule,
  type SavedWorkbenchPlan,
} from "~/helpers/workbench-mcp"
import { environments$ } from "~/newstore/environments"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"

const props = defineProps<{
  plan?: SavedWorkbenchPlan
  schedule?: AutomationSchedule
  embedded?: boolean
}>()
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>()
const t = useI18n()
const schedulingAvailable = workbenchSchedulesAvailable()
const { collections } = useWorkbenchCollections()
const environments = useReadonlyStream(environments$, [])
const currentValues = useService(CurrentValueService)
const secretValues = useService(SecretEnvironmentService)
const rule = props.schedule?.rule ?? props.schedule?.draftRule
const type = ref<"off" | AutomationScheduleRule["type"]>(
  props.schedule?.rule?.type ?? "off"
)
const draftType = ref<AutomationScheduleRule["type"]>(rule?.type ?? "interval")
watch(
  type,
  (value) => {
    if (value !== "off") draftType.value = value
  },
  { flush: "sync" }
)
const config = ref(
  getAutomationConfig(
    props.plan?.config,
    props.plan && !schedulingAvailable
      ? { delay: 500, keepVariableValues: true }
      : {}
  )
)
function setWebhook(key: "enabled" | "includeErrorDetails", value: boolean) {
  config.value.webhook = {
    enabled: false,
    includeErrorDetails: false,
    ...config.value.webhook,
    [key]: value,
  }
}
const notificationPicker = ref<{ validate: () => Promise<boolean> }>()
function setNotificationChannels(channelIDs: string[]) {
  config.value.webhook = {
    enabled: true,
    includeErrorDetails: false,
    ...config.value.webhook,
    channelIDs,
  }
}
const storedCases = useWorkbenchRequestCases()
void storedCases.ready.catch(() => {})
const availableCases = computed(() => ({
  ...config.value.requestCases,
  ...storedCases.cases.value,
}))
const allChoices = computed(() =>
  collectionCaseChoices(collections.value, availableCases.value)
)
const selectedCaseIDs = ref<string[]>(props.plan?.config?.selectedCaseIDs ?? [])
let initializedSelection = !!props.plan?.config?.selectedCaseIDs
watch(
  allChoices,
  (choices) => {
    if (initializedSelection || !choices.length) return
    initializedSelection = true
    const plan = props.plan
    if (!plan) return
    if (plan.config?.selectedRequestIDs) {
      selectedCaseIDs.value = choices
        .filter((choice) =>
          plan.config!.selectedRequestIDs!.includes(choice.requestID)
        )
        .map(({ entry }) => entry.id)
      return
    }
    const find = (items: HoppCollection[]): HoppCollection | undefined => {
      for (const item of items) {
        if ((item.id ?? item._ref_id) === plan.collectionID) return item
        const nested = find(item.folders)
        if (nested) return nested
      }
    }
    const group = find(collections.value)
    const scoped = plan.requestID
      ? choices.filter((choice) => choice.requestID === plan.requestID)
      : group
        ? collectionCaseChoices([group], availableCases.value)
        : []
    selectedCaseIDs.value = scoped.map(({ entry }) => entry.id)
  },
  { immediate: true }
)
const selectedChoices = computed(() =>
  allChoices.value.filter(({ entry }) =>
    selectedCaseIDs.value.includes(entry.id)
  )
)
const selectedTarget = computed(() => {
  const first = selectedChoices.value[0]
  if (!first) return undefined
  const requests = new Set(
    selectedChoices.value.map((choice) => choice.requestID)
  )
  return {
    id: requests.size === 1 ? first.requestID : first.collectionID,
    collectionID: first.collectionID,
    kind: requests.size === 1 ? ("request" as const) : ("group" as const),
  }
})
const minutes = ref(rule?.type === "interval" ? rule.minutes : 30)
const time = ref(rule && rule.type !== "interval" ? rule.time : "09:00")
const weekday = ref(rule?.type === "weekly" ? rule.weekday : 1)
const timezone =
  rule && rule.type !== "interval"
    ? rule.timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone
const draftRule = computed<AutomationScheduleRule | null>(() => {
  if (draftType.value === "interval") {
    return Number.isSafeInteger(minutes.value) &&
      minutes.value >= 1 &&
      minutes.value <= 10080
      ? { type: "interval", minutes: minutes.value }
      : (rule ?? null)
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)) return rule ?? null
  return draftType.value === "weekly"
    ? { type: "weekly", time: time.value, weekday: weekday.value, timezone }
    : { type: "daily", time: time.value, timezone }
})
const weekdays = Array.from({ length: 7 }, (_, day) => ({
  value: day,
  label: new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 4 + day))),
}))
const environmentID = ref(
  props.schedule
    ? (props.schedule.environmentID ?? "")
    : (props.plan?.environmentID ?? "")
)
const saving = ref(false)
const ruleOptions = computed(() => [
  { value: "off" as const, label: t("workbench_schedule.off") },
  ...(["interval", "daily", "weekly"] as const).map((value) => ({
    value,
    label: t(`workbench_schedule.${value}`),
  })),
])
const environmentOptions = computed(() => [
  { value: "", label: t("environment.no_environment") },
  ...(environmentID.value &&
  !environments.value.some(({ id }) => id === environmentID.value)
    ? [
        {
          value: environmentID.value,
          label: t("workbench_mcp.environment_missing"),
        },
      ]
    : []),
  ...environments.value.map((environment) => ({
    value: environment.id,
    label: environment.name,
  })),
])
const error = ref("")
const form = ref<HTMLFormElement>()

const save = async () => {
  const target = selectedTarget.value
  if (saving.value || !target || !form.value?.reportValidity()) return false
  try {
    await storedCases.ready
  } catch {
    error.value = t("request_case.load_failed")
    return false
  }
  if (!selectedChoices.value.length) {
    error.value = t("automation_cases.empty")
    return false
  }
  if (
    config.value.webhook?.enabled &&
    !(await notificationPicker.value?.validate())
  ) {
    error.value = t("automation_webhook.choose_channels")
    return false
  }
  const parsed = AutomationConfigSchema.safeParse({
    ...config.value,
    requestCases: snapshotCases(
      allChoices.value.filter((choice) =>
        selectedChoices.value.some(
          (selected) => selected.requestID === choice.requestID
        )
      )
    ),
    selectedCaseIDs: selectedCaseIDs.value,
    selectedRequestIDs: [
      ...new Set(selectedChoices.value.map((choice) => choice.requestID)),
    ],
    casesOnly: true,
    keepVariableValues: false,
  })
  if (!parsed.success) {
    error.value = t("workbench_schedule.invalid_config")
    return false
  }
  saving.value = true
  error.value = ""
  try {
    const rule: AutomationScheduleRule | null =
      !schedulingAvailable || type.value === "off" ? null : draftRule.value
    const environment = environments.value.find(
      ({ id }) => id === environmentID.value
    )
    // 仅复制选中环境的本机当前值到该计划，后台不会写回调试环境。
    const overrides = rule
      ? environment?.variables.flatMap((variable, index) => {
          const secret = variable.secret
            ? secretValues.getSecretEnvironmentVariableValue(
                environment.id,
                index
              )
            : null
          const value = variable.secret
            ? secret?.value || secret?.initialValue
            : currentValues.getEnvironmentVariableValue(environment.id, index)
          return variable.key && value
            ? [{ key: variable.key, secret: variable.secret, value }]
            : []
        })
      : undefined
    if (!schedulingAvailable) {
      await workbenchMcpAPI(
        props.plan
          ? `configs/automation/${encodeURIComponent(props.plan.id)}`
          : "configs/automation",
        {
          collectionID: target.collectionID,
          requestID: target.kind === "request" ? target.id : null,
          environmentID: environmentID.value || undefined,
          config: parsed.data,
        }
      )
    } else
      await workbenchMcpAPI(
        props.plan
          ? `automation/schedules/${encodeURIComponent(props.plan.id)}`
          : "automation/schedules",
        {
          ...(target?.kind === "request" ? { requestID: target.id } : {}),
          ...(target?.kind === "group" ? { collectionID: target.id } : {}),
          environmentID: environmentID.value || null,
          rule,
          draftRule: draftRule.value,
          overrides,
          config: parsed.data,
        }
      )
    emit("saved")
    return true
  } catch (e) {
    error.value = (e as Error).message
    return false
  } finally {
    saving.value = false
  }
}
defineExpose({ save })
</script>
