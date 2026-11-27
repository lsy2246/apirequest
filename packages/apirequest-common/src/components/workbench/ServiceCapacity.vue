<template>
  <section class="workbench-panel p-5 sm:p-8" data-testid="service-capacity">
    <h3 class="heading">服务容量</h3>
    <p v-if="loading" class="mt-4 text-secondaryLight" role="status">
      正在读取服务容量…
    </p>
    <p v-if="error" class="mt-4 text-red-500" role="alert">{{ error }}</p>
    <HoppButtonSecondary
      v-if="!view && !loading"
      class="mt-3"
      label="重试"
      @click="load"
    />
    <form v-if="view" class="mt-4 space-y-5" @submit.prevent="save">
      <fieldset v-for="group in groups" :key="group.title" class="space-y-2">
        <legend class="mb-2 font-medium text-secondaryDark">
          {{ group.title }}
        </legend>
        <p v-if="group.hint" class="text-tiny text-secondaryLight">
          {{ group.hint }}
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="[key, label, unit] in group.fields"
            :key="key"
            class="flex min-w-0 items-center justify-between gap-3 rounded border border-divider p-3"
          >
            <span class="min-w-0 space-y-1">
              <span class="block">{{ label }}</span>
              <span class="block text-tiny text-secondaryLight">
                生效 {{ view.values[key] }} · 默认
                {{ view.fields[key].default }} {{ unit }}
              </span>
            </span>
            <input
              v-model.number="draft[key]"
              type="number"
              class="input w-24 shrink-0"
              :aria-label="label"
              :disabled="saving || loading"
              required
            />
          </label>
        </div>
      </fieldset>
      <div class="flex flex-wrap items-center gap-2">
        <HoppButtonPrimary
          type="submit"
          label="保存容量设置"
          :loading="saving"
          :disabled="saving || loading || !changed"
        />
        <HoppButtonSecondary
          type="button"
          outline
          label="填入默认值"
          :disabled="saving || loading"
          @click="fillDefaults"
        />
        <HoppButtonSecondary
          type="button"
          label="重新读取"
          :disabled="saving || loading"
          @click="load"
        />
        <span class="text-tiny text-secondaryLight">保存后对新请求生效</span>
      </div>
      <p v-if="saved" role="status" class="text-secondaryDark">
        已保存，服务容量已更新。
      </p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { setDetailBatchSize } from "~/helpers/remote-collections"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import {
  readServiceCapacity,
  writeServiceCapacity,
  type CapacityView,
} from "~/helpers/service-capacity"

const groups = [
  {
    title: "请求频率",
    hint: "按客户端 IP 和接口计数。次数设为 0 可关闭对应限频。",
    fields: [
      ["rateWindowSeconds", "计数窗口", "秒"],
      ["workspaceReads", "工作台读取", "次 / 窗口"],
      ["batchReads", "批量读取", "次 / 窗口"],
      ["sessionRequests", "建立工作台会话", "次 / 窗口"],
      ["externalMcp", "外部 MCP", "次 / 窗口"],
      ["publicMock", "Mock 请求", "次 / 窗口"],
      ["relayRequests", "Web 转发", "次 / 窗口"],
    ],
  },
  {
    title: "连接与超时",
    hint: "降低并发上限后，已在途的请求和已建立的连接可以继续完成。",
    fields: [
      ["relayConcurrency", "Web 转发在途请求", "个 / 服务"],
      ["eventConnections", "实时事件流连接", "条 / 工作区"],
      ["relayDefaultTimeoutSeconds", "Web 转发默认超时", "秒"],
      ["relayMaxTimeoutSeconds", "Web 转发最长超时", "秒"],
    ],
  },
  {
    title: "数据大小",
    hint: "Web 转发会流式返回上游响应。",
    fields: [
      ["detailBatchSize", "工作台接口详情批量大小", "条 / 批"],
      ["relayBodyMiB", "Web 转发请求正文上限", "MiB"],
      ["collectionImportMiB", "集合导入 API 大小", "MiB"],
      ["configImportMiB", "配置包导入大小", "MiB"],
    ],
  },
] as const

const view = ref<CapacityView>()
const draft = ref<Record<string, number>>({})
const loading = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref("")
const controller = new AbortController()
const changed = computed(() =>
  Object.entries(draft.value).some(
    ([key, value]) => value !== view.value?.values[key]
  )
)

function apply(result: CapacityView) {
  view.value = result
  setDetailBatchSize(result.values.detailBatchSize)
  draft.value = { ...result.values }
}
function fillDefaults() {
  if (!view.value) return
  draft.value = Object.fromEntries(
    Object.entries(view.value.fields).map(([key, field]) => [
      key,
      field.default,
    ])
  )
  saved.value = false
}
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ""
  saved.value = false
  try {
    apply(await readServiceCapacity(controller.signal))
  } catch (failure) {
    if (!controller.signal.aborted)
      error.value =
        failure instanceof Error ? failure.message : "无法读取服务容量"
  } finally {
    loading.value = false
  }
}
async function save() {
  if (!view.value || saving.value || loading.value || !changed.value) return
  if (
    draft.value.relayDefaultTimeoutSeconds > draft.value.relayMaxTimeoutSeconds
  ) {
    error.value = "Web 转发默认超时不能超过最长超时。"
    return
  }
  const overrides = Object.fromEntries(
    Object.entries(draft.value).filter(
      ([key, value]) => value !== view.value?.fields[key].default
    )
  )
  saving.value = true
  saved.value = false
  error.value = ""
  try {
    apply(
      await writeServiceCapacity(
        overrides,
        view.value.revision,
        controller.signal
      )
    )
    saved.value = true
  } catch (failure) {
    if (!controller.signal.aborted)
      error.value =
        failure instanceof Error ? failure.message : "无法保存服务容量"
  } finally {
    saving.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => controller.abort())
</script>
