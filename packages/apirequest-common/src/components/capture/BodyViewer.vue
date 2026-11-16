<template>
  <div
    class="capture-body-viewer flex min-h-0 flex-col gap-3"
    tabindex="0"
    @keydown="onFindShortcut"
  >
    <div class="flex flex-wrap items-center gap-2">
      <WorkbenchSelect
        v-model="view"
        :label="t('workbench_capture.body_view')"
        :options="viewOptions"
        class="w-28 shrink-0"
      />
      <HoppButtonSecondary
        ref="findButton"
        :icon="IconSearch"
        :label="t('workbench_capture.find_body')"
        :aria-expanded="finding"
        :disabled="!searchText"
        @click="finding = !finding"
      />
      <span class="text-tiny text-secondaryLight">{{ body?.size ?? 0 }} B</span>
      <HoppButtonSecondary
        :label="t('action.copy')"
        :disabled="!text"
        @click="copyToClipboard(text)"
      />
      <HoppButtonSecondary
        :label="t('action.download_file')"
        :disabled="!body"
        @click="$emit('download')"
      />
    </div>
    <p v-if="body?.truncated" class="text-tiny text-amber-600">
      {{ t("workbench_capture.preview_limited") }}
    </p>
    <BodyFind
      v-if="finding"
      :text="searchText"
      :mode="findMode"
      @close="closeFind"
    />
    <div v-show="!finding" class="capture-body-preview min-w-0">
      <div v-if="view === 'hex'" class="overflow-auto">
        <pre class="font-mono text-tiny">{{ hex }}</pre>
      </div>
      <div v-else-if="view === 'text'" class="overflow-auto">
        <pre class="whitespace-pre-wrap break-all font-mono text-tiny">{{
          text
        }}</pre>
      </div>
      <div
        v-else-if="events.length"
        class="max-h-[60vh] space-y-2 overflow-auto"
      >
        <article
          v-for="event in events"
          :key="event.index"
          class="rounded border border-divider p-2"
        >
          <p class="mb-1 text-tiny text-accent">
            #{{ event.index + 1 }} · {{ event.event }}
            <span v-if="event.id">· {{ event.id }}</span>
          </p>
          <ConsoleValue :value="jsonValue(event.data)" />
        </article>
      </div>
      <ConsoleValue
        v-else-if="parsed !== undefined"
        :value="parsed"
        class="overflow-auto"
      />
      <dl
        v-else-if="mime.includes('x-www-form-urlencoded')"
        class="grid grid-cols-2 gap-2"
      >
        <template v-for="([name, value], index) in form" :key="index"
          ><dt :data-row="index" class="break-all text-secondaryLight">
            {{ name }}
          </dt>
          <dd class="break-all">{{ value }}</dd></template
        >
      </dl>
      <dl v-else-if="multipart.length" class="grid grid-cols-2 gap-2">
        <template v-for="part in multipart" :key="part.name"
          ><dt class="break-all text-secondaryLight">{{ part.name }}</dt>
          <dd class="break-all whitespace-pre-wrap">
            {{ part.value }}
          </dd></template
        >
      </dl>
      <pre
        v-else-if="xmlText"
        class="overflow-auto whitespace-pre-wrap font-mono text-tiny"
        >{{ xmlText }}</pre>
      <img
        v-else-if="
          objectURL && /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)/i.test(mime)
        "
        :src="objectURL"
        :alt="t('workbench_capture.preview')"
        class="max-h-96 max-w-full self-start object-contain"
      />
      <audio
        v-else-if="objectURL && mime.startsWith('audio/')"
        :src="objectURL"
        controls
      />
      <video
        v-else-if="objectURL && mime.startsWith('video/')"
        :src="objectURL"
        controls
        class="max-h-96 max-w-full"
      />
      <pre
        v-else
        class="overflow-auto whitespace-pre-wrap break-all font-mono text-tiny"
        >{{ text || t("workbench_capture.no_body") }}</pre>
    </div>
  </div>
</template>
<script setup lang="ts">
import formatXML from "xml-formatter";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "~/composables/i18n";
import { copyToClipboard } from "~/helpers/utils/clipboard";
import { parseCaptureEvents, type CaptureBody, type CaptureHeaders } from "~/helpers/workbench-capture";
import { decodeCaptureBytes } from "~/helpers/workbench-capture-body";
import WorkbenchSelect from "~/components/workbench/Select.vue";
import ConsoleValue from "~/components/console/Value.vue";
import BodyFind from "~/components/capture/BodyFind.vue";
import IconSearch from "~icons/lucide/search";
const props = defineProps<{
  body?: CaptureBody
  headers?: CaptureHeaders
}>()
defineEmits<{ (e: "download"): void }>()
const t = useI18n()
const viewOptions = computed(() => [
    { value: "preview", label: t("workbench_capture.preview") },
    { value: "text", label: t("workbench_capture.raw") },
    { value: "hex", label: "Hex" },
  ]),
  view = ref("preview"),
  finding = ref(false),
  objectURL = ref("")
const mime = computed(
  () =>
    props.headers
      ?.find(([key]) => key.toLowerCase() === "content-type")?.[1]
      .toLowerCase() ?? ""
)
const bytes = computed(() => {
  try {
    return props.body?.base64
      ? Uint8Array.from(atob(props.body.base64), (ch) => ch.charCodeAt(0))
      : new TextEncoder().encode(props.body?.text ?? "")
  } catch {
    return new Uint8Array()
  }
})
const decoded = ref<Uint8Array>()
let bodyRevision = 0
const previewBytes = computed(() => decoded.value ?? bytes.value)
watch(
  () => props.body,
  async () => {
    const version = ++bodyRevision
    decoded.value = undefined
    const encoding = props.headers?.find(
      ([key]) => key.toLowerCase() === "content-encoding"
    )?.[1]
    if (
      !props.body?.base64 ||
      props.body.truncated ||
      !["gzip", "deflate"].includes(encoding ?? "")
    )
      return
    try {
      const data = await decodeCaptureBytes(bytes.value, props.headers)
      if (version === bodyRevision) decoded.value = data
    } catch {
      /* 不支持的压缩内容仍可按原始字节下载。 */
    }
  },
  { immediate: true }
)
const text = computed(
  () =>
    props.body?.text ??
    (props.body?.base64 ? new TextDecoder().decode(previewBytes.value) : "")
)
function jsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
const parsed = computed(() => {
  try {
    return JSON.parse(text.value)
  } catch {
    return undefined
  }
})
const events = computed(() =>
  mime.value.includes("event-stream") ? parseCaptureEvents(text.value) : []
)
const form = computed(() => [...new URLSearchParams(text.value)])
const xmlText = computed(() => {
  if (!mime.value.includes("xml")) return ""
  try {
    return formatXML(text.value, { collapseContent: true })
  } catch {
    return text.value
  }
})
const multipart = computed(() => {
  const boundary = props.headers
    ?.find(([key]) => key.toLowerCase() === "content-type")?.[1]
    .match(/boundary=(?:"([^"]+)"|([^;]+))/)
    ?.slice(1)
    .find(Boolean)
  if (!boundary || !mime.value.includes("multipart/")) return []
  return text.value
    .split("--" + boundary)
    .slice(1, -1)
    .map((part) => {
      const split = part.indexOf("\r\n\r\n")
      return {
        name: part.match(/name="([^"]*)"/)?.[1] ?? "",
        value: part.slice(split + 4).replace(/\r\n$/, ""),
      }
    })
})
const hex = computed(() => {
  const rows = []
  for (let i = 0; i < bytes.value.length; i += 16) {
    const part = bytes.value.subarray(i, i + 16)
    rows.push(
      i.toString(16).padStart(8, "0") +
        "  " +
        Array.from(part, (b) => b.toString(16).padStart(2, "0"))
          .join(" ")
          .padEnd(47) +
        "  " +
        Array.from(part, (b) =>
          b >= 32 && b < 127 ? String.fromCharCode(b) : "."
        ).join("")
    )
  }
  return rows.join("\n")
})
// 查找使用完整正文，JSON 展开格式化，关闭后恢复原预览与展开状态。
const searchText = computed(() => {
  if (view.value === "hex") return hex.value
  if (view.value === "text") return text.value
  if (parsed.value !== undefined) return JSON.stringify(parsed.value, null, 2)
  return xmlText.value || text.value
})
const findMode = computed(() =>
  view.value !== "hex" && parsed.value !== undefined
    ? "application/json"
    : "text/plain"
)
const findButton = ref<{ $el: HTMLElement }>()
async function closeFind() {
  finding.value = false
  await nextTick()
  findButton.value?.$el.focus()
}
function onFindShortcut(event: KeyboardEvent) {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "f" &&
    searchText.value
  ) {
    event.preventDefault()
    event.stopPropagation()
    finding.value = true
  }
}
// 仅使用本地 Blob 预览正文，不执行抓到的 HTML 或 SVG。
watch(
  [previewBytes, mime],
  () => {
    if (objectURL.value) URL.revokeObjectURL(objectURL.value)
    objectURL.value =
      props.body && !props.body.truncated
        ? URL.createObjectURL(
            new Blob([new Uint8Array(previewBytes.value).buffer], {
              type: mime.value,
            })
          )
        : ""
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  if (objectURL.value) URL.revokeObjectURL(objectURL.value)
})
</script>
<style scoped>
.capture-body-preview :deep(pre.truncate) {
  white-space: pre-wrap;
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
}
</style>
