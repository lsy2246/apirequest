<template>
  <div class="space-y-3">
    <div class="flex gap-2">
      <HoppButtonSecondary
        :label="t('action.add')"
        outline
        :disabled="modelValue.length >= 24"
        @click="add"
      /><HoppButtonPrimary
        :label="t('workbench_capture.apply_rules')"
        :disabled="busy || !active"
        @click="$emit('apply')"
      />
    </div>
    <p class="text-tiny text-secondaryLight">
      {{ t("workbench_capture.rules_help") }}
    </p>
    <p v-if="!modelValue.length" class="p-4 text-secondaryLight">
      {{ t("workbench_capture.no_rules") }}
    </p>
    <article
      v-for="(rule, index) in modelValue"
      :key="index"
      class="space-y-3 rounded border border-divider p-3"
    >
      <div class="flex items-center gap-2">
        <WorkbenchToggle
          :on="rule.enabled"
          :aria-label="t('workbench_capture.enabled')"
          @change="change(index, 'enabled', $event)"
        />
        <input
          :value="rule.name"
          :placeholder="t('workbench_capture.rule_name')"
          maxlength="120"
          class="min-w-0 flex-1 rounded border border-divider bg-primary px-2 py-1"
          @input="
            change(index, 'name', ($event.target as HTMLInputElement).value)
          "
        />
        <button
          :disabled="index === 0"
          :aria-label="t('workbench_capture.move_up')"
          @click="move(index, -1)"
        >
          ↑</button
        ><button
          :disabled="index === modelValue.length - 1"
          :aria-label="t('workbench_capture.move_down')"
          @click="move(index, 1)"
        >
          ↓
        </button>
        <HoppButtonSecondary
          :label="t('action.delete')"
          @click="remove(index)"
        />
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="min-w-0 space-y-1">
          <span class="text-secondaryLight">{{
            t("workbench_capture.rule_action")
          }}</span>
          <WorkbenchSelect
            :model-value="rule.action"
            :options="actionOptions"
            :label="t('workbench_capture.rule_action')"
            @update:model-value="change(index, 'action', $event)"
          />
        </label>
        <label class="min-w-0 space-y-1">
          <span class="text-secondaryLight">{{ t("request.method") }}</span>
          <WorkbenchSelect
            :model-value="rule.method"
            :options="methodOptions"
            :label="t('request.method')"
            @update:model-value="change(index, 'method', $event)"
          />
        </label>
      </div>
      <label class="block"
        >{{ t("workbench_capture.url_match")
        }}<input
          :value="rule.match"
          class="mt-1 w-full rounded border border-divider bg-primary p-2"
          @input="
            change(index, 'match', ($event.target as HTMLInputElement).value)
          "
      /></label>
      <label v-if="rule.action === 'rewrite'" class="block"
        >URL<input
          :value="rule.value"
          class="mt-1 w-full rounded border border-divider bg-primary p-2"
          @input="
            change(index, 'value', ($event.target as HTMLInputElement).value)
          "
      /></label>
      <template v-if="rule.action === 'local'">
        <div class="grid grid-cols-2 gap-2">
          <label
            >{{ t("workbench_capture.status")
            }}<input
              type="number"
              min="200"
              max="599"
              :value="rule.status"
              class="mt-1 w-full rounded border border-divider bg-primary p-2"
              @input="
                change(
                  index,
                  'status',
                  Number(($event.target as HTMLInputElement).value)
                )
              " /></label
          ><label
            >Content-Type<input
              :value="rule.contentType"
              class="mt-1 w-full rounded border border-divider bg-primary p-2"
              @input="
                change(
                  index,
                  'contentType',
                  ($event.target as HTMLInputElement).value
                )
              "
          /></label>
        </div>
        <label class="block"
          >{{ t("workbench_capture.response")
          }}<textarea
            :value="rule.value"
            rows="4"
            class="mt-1 w-full rounded border border-divider bg-primary p-2 font-mono"
            @input="
              change(
                index,
                'value',
                ($event.target as HTMLTextAreaElement).value
              )
            "
          />
        </label>
      </template>
      <div v-if="rule.action === 'network'" class="grid grid-cols-2 gap-2">
        <label
          >{{ t("workbench_capture.delay")
          }}<input
            type="number"
            min="0"
            max="10000"
            :value="rule.delayMs"
            class="mt-1 w-full rounded border border-divider bg-primary p-2"
            @input="
              change(
                index,
                'delayMs',
                Number(($event.target as HTMLInputElement).value)
              )
            " /></label
        ><label
          >{{ t("workbench_capture.loss")
          }}<input
            type="number"
            min="0"
            max="100"
            :value="rule.loss"
            class="mt-1 w-full rounded border border-divider bg-primary p-2"
            @input="
              change(
                index,
                'loss',
                Number(($event.target as HTMLInputElement).value)
              )
            "
        /></label>
      </div>
    </article>
  </div>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { computed } from "vue";
import WorkbenchSelect from "~/components/workbench/Select.vue";
import { getMethodLabelColor } from "~/helpers/rest/labelColoring";
import IconUp from "~icons/lucide/arrow-up";
import IconDown from "~icons/lucide/arrow-down";
import IconRewrite from "~icons/lucide/arrow-right-left";
import IconFile from "~icons/lucide/file-text";
import IconNetwork from "~icons/lucide/gauge";
import { useI18n } from "~/composables/i18n";
import { newCaptureRule, type CaptureRule } from "~/helpers/workbench-capture";
const props = defineProps<{
  modelValue: CaptureRule[]
  busy: boolean
  active: boolean
}>()
const emit = defineEmits<{
  (e: "update:modelValue", value: CaptureRule[]): void
  (e: "apply"): void
}>()
const t = useI18n()
const actionOptions = computed(() => [
  {
    value: "pause_request",
    label: t("workbench_capture.pause_request"),
    icon: IconUp,
  },
  {
    value: "pause_response",
    label: t("workbench_capture.pause_response"),
    icon: IconDown,
  },
  {
    value: "rewrite",
    label: t("workbench_capture.rewrite"),
    icon: IconRewrite,
  },
  { value: "local", label: t("workbench_capture.local"), icon: IconFile },
  {
    value: "network",
    label: t("workbench_capture.network"),
    icon: IconNetwork,
  },
])
const methodOptions = computed(() => [
  { value: "", label: t("workbench_capture.all") },
  ...["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
    (value) => ({ value, label: value, color: getMethodLabelColor(value) })
  ),
])
function change(index: number, key: keyof CaptureRule, value: unknown) {
  emit(
    "update:modelValue",
    props.modelValue.map((rule, i) =>
      i === index ? { ...rule, [key]: value } : rule
    )
  )
}
function add() {
  emit("update:modelValue", [...props.modelValue, newCaptureRule()])
}
function remove(index: number) {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, i) => i !== index)
  )
}
function move(index: number, delta: number) {
  const next = [...props.modelValue]
  ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
  emit("update:modelValue", next)
}
</script>
