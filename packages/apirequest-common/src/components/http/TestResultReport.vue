<template>
  <div class="flex items-center px-4 py-2">
    <HoppSmartProgressRing
      class="mr-2 text-red-500"
      :radius="8"
      :stroke="1.5"
      :progress="totalTests ? (failedTests / totalTests) * 100 : 0"
    />
    <div class="ml-2">
      <span v-if="failedTests" class="text-red-500">
        {{ t("workbench.assertions_failed", { count: failedTests }) }}
      </span>
      <span v-if="passedTests" class="text-green-500">
        {{ t("workbench.assertions_passed", { count: passedTests }) }}
      </span>
      <span>
        {{ t("workbench.assertions_total", { count: totalTests }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, PropType } from "vue";
import { useI18n } from "~/composables/i18n";
const t = useI18n()
import { HoppTestExpectResult, HoppTestResult } from "~/helpers/types/HoppTestResult";

const props = defineProps({
  testResults: {
    type: Object as PropType<HoppTestResult>,
    required: true,
    expectResults: [] as HoppTestExpectResult[],
  },
})

const totalTests = computed(() => props.testResults.expectResults.length)
const failedTests = computed(
  () =>
    props.testResults.expectResults.filter(
      (result: { status: string }) => result.status === "fail"
    ).length
)
const passedTests = computed(
  () =>
    props.testResults.expectResults.filter(
      (result: { status: string }) => result.status === "pass"
    ).length
)
</script>
