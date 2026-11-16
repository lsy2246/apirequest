<template>
  <div class="space-y-4">
    <p class="text-tiny text-secondaryLight">
      {{ t("mock_tools.protocol_hint") }}
    </p>
    <div>
      <p class="mb-2 font-medium">{{ t("mock_tools.push_messages") }}</p>
      <div
        v-for="(_, index) in model.messages"
        :key="index"
        class="mb-2 flex gap-2"
      >
        <MessageField
          v-model="model.messages[index]"
          :label="t('mock_tools.push_messages')"
        /><button
          type="button"
          class="px-2"
          :aria-label="t('action.delete')"
          @click="model.messages.splice(index, 1)"
        >
          ×
        </button>
      </div>
      <HoppButtonSecondary
        type="button"
        :label="t('mock_tools.add_message')"
        @click="model.messages.push('')"
      />
    </div>
    <div>
      <p class="mb-2 font-medium">{{ t("mock_tools.message_matchers") }}</p>
      <div
        v-for="(matcher, index) in model.matchers"
        :key="index"
        class="mb-3 space-y-2 rounded border border-divider p-3"
      >
        <div class="flex flex-wrap gap-2">
          <select
            :value="matcher.type || 'text'"
            :aria-label="t('mock_tools.message_type')"
            class="mock-field"
            @change="
              matcher.type = ($event.target as HTMLSelectElement).value as
                'text' | 'binary' | 'any'
            "
          >
            <option value="text">{{ t("mock_tools.text_message") }}</option>
            <option value="binary">{{ t("mock_tools.binary_message") }}</option>
            <option value="any">{{ t("mock_tools.any") }}</option>
          </select>
          <select
            v-model="matcher.operator"
            :aria-label="t('mock_tools.operator')"
            class="mock-field"
          >
            <option v-for="op in operators" :key="op" :value="op">
              {{ t(`mock_tools.${op}`) }}
            </option></select
          ><input
            v-if="matcher.operator !== 'any'"
            v-model="matcher.value"
            :aria-label="t('documentation.value')"
            class="mock-field min-w-0 flex-1"
          /><button
            type="button"
            :aria-label="t('action.delete')"
            class="px-2"
            @click="model.matchers.splice(index, 1)"
          >
            ×
          </button>
        </div>
        <label class="block">{{ t("mock_tools.replies") }}</label>
        <div
          v-for="(_, reply) in matcher.replies"
          :key="reply"
          class="flex gap-2"
        >
          <MessageField
            v-model="matcher.replies[reply]"
            :label="t('mock_tools.replies')"
          /><button
            type="button"
            :aria-label="t('action.delete')"
            class="px-2"
            @click="matcher.replies.splice(reply, 1)"
          >
            ×
          </button>
        </div>
        <HoppButtonSecondary
          type="button"
          :label="t('mock_tools.add_message')"
          @click="matcher.replies.push('')"
        />
        <WorkbenchToggle
          class="flex items-center gap-2"
          v-model="matcher.close"
          >{{ t("mock_tools.close") }}</WorkbenchToggle
        >
      </div>
      <HoppButtonSecondary
        type="button"
        :label="t('mock_tools.add_matcher')"
        @click="
          model.matchers.push({
            type: 'text',
            operator: 'equals',
            value: 'ping',
            replies: ['pong'],
            close: false,
          })
        "
      />
    </div>
    <label class="block"
      >{{ t("mock_tools.close_code")
      }}<input
        v-model.number="model.closeCode"
        type="number"
        min="1000"
        max="4999"
        required
        class="mock-field mt-1 w-full"
    /></label>
  </div>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import MessageField from "./MessageField.vue"
import { useI18n } from "~/composables/i18n"
import type { MockWebSocket } from "~/helpers/mockServer/rules"
const model = defineModel<MockWebSocket>({ required: true }),
  t = useI18n()
const operators = ["equals", "contains", "regex", "any"] as const
</script>
