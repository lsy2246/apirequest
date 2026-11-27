<template>
  <HoppSmartModal
    dialog
    :title="t('history_results.view')"
    styles="sm:max-w-4xl"
    @close="emit('close')"
  >
    <template #body>
      <div class="flex max-h-[65vh] flex-col gap-4 overflow-auto">
        <div
          v-if="loading"
          role="status"
          aria-busy="true"
          class="flex items-center gap-2"
        >
          <HoppSmartSpinner />{{ t("ui_detail.loading_result") }}
        </div>
        <p v-else-if="error" role="alert" class="text-red-500">
          {{ t("history_results.error") }}
          <HoppButtonSecondary
            :label="t('action.retry')"
            outline
            @click="loadResult"
          />
        </p>
        <template v-else-if="detail && detail.state !== 'saved'">
          <div v-if="detail.summary" class="flex items-center gap-4">
            <span v-if="detail.summary.statusCode">{{
              detail.summary.statusCode
            }}</span>
            <span v-if="detail.summary.duration != null"
              >{{ detail.summary.duration }} ms</span
            >
          </div>
          <p>
            {{
              t(
                detail.state === "cleaned"
                  ? "history_results.cleaned"
                  : "history_results.missing"
              )
            }}
          </p>
        </template>
        <template v-else-if="detail?.state === 'saved'">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span
              v-if="detail.metadata.statusCode"
              class="font-semibold text-secondaryDark"
            >
              {{ detail.metadata.statusCode }} {{ detail.metadata.statusText }}
            </span>
            <span v-if="detail.metadata.duration !== undefined"
              >{{ detail.metadata.duration }} ms</span
            >
            <span>{{ detail.metadata.contentType }}</span>
            <span>{{ formatBytes(detail.size) }}</span>
            <HoppButtonSecondary
              v-if="!previewMissing"
              :label="t('action.download_file')"
              :to="nativeWorkspace ? undefined : `${bodyURL}?download=1`"
              @click="downloadNative()"
              outline
            />
          </div>
          <details v-if="detail.metadata.headers.length">
            <summary class="cursor-pointer font-medium">
              {{ t("response.headers") }}
            </summary>
            <dl
              class="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-1 rounded border border-divider p-2 font-mono text-tiny"
            >
              <template
                v-for="(header, index) in detail.metadata.headers"
                :key="index"
              >
                <dt class="break-all">{{ header.key }}</dt>
                <dd class="break-all">{{ header.value }}</dd>
              </template>
            </dl>
          </details>
          <img
            v-if="detail.kind === 'image'"
            :src="bodyURL"
            alt=""
            class="max-h-80 max-w-full self-start object-contain"
          />
          <video
            v-else-if="detail.kind === 'video'"
            :src="bodyURL"
            controls
            preload="metadata"
            class="max-h-80 w-full"
          />
          <template
            v-else-if="detail.kind === 'json' || detail.kind === 'text'"
          >
            <div
              v-if="previewLoading"
              role="status"
              aria-busy="true"
              class="flex items-center gap-2"
            >
              <HoppSmartSpinner />{{ t("ui_detail.loading_result") }}
            </div>
            <p v-if="previewMissing" role="status" class="text-secondaryLight">
              {{ t("history_results.body_missing") }}
            </p>
            <p v-else-if="previewError" role="alert" class="text-red-500">
              {{ t("history_results.error") }}
              <HoppButtonSecondary
                :label="t('action.retry')"
                outline
                @click="loadPreview(detail.kind === 'json')"
              />
            </p>
            <img
              v-for="(src, index) in images"
              :key="index"
              :src="src"
              alt=""
              class="max-h-80 max-w-full self-start object-contain"
            />
            <div
              v-if="links.length && detail.canAttach"
              class="flex flex-col gap-2"
            >
              <div
                v-for="link in links"
                :key="link"
                class="flex min-w-0 items-center gap-2"
              >
                <span
                  class="min-w-0 flex-1 truncate text-secondaryLight"
                  :title="link"
                  >{{ link }}</span
                >
                <HoppButtonSecondary
                  :label="t('history_results.save_file')"
                  :disabled="savingLink"
                  outline
                  @click="saveFile(link)"
                />
              </div>
              <p v-if="linkError" role="alert" class="text-red-500">
                {{ t("history_results.error") }}
              </p>
            </div>
            <pre
              v-if="preview"
              class="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border border-divider bg-primaryLight p-3 text-tiny"
              >{{ preview }}</pre>
            <p v-if="truncated" class="text-secondaryLight">
              {{ t("history_results.preview_truncated") }}
            </p>
          </template>
          <div
            v-if="detail.attachments.length"
            class="flex flex-col gap-3 border-t border-divider pt-3"
          >
            <h3 class="font-semibold text-secondaryDark">
              {{ t("history_results.saved_files") }}
            </h3>
            <div
              v-for="attachment in detail.attachments"
              :key="attachment.id"
              class="flex flex-col gap-2"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="break-all">{{ attachment.name }}</span>
                <span class="text-secondaryLight">{{
                  formatBytes(attachment.size)
                }}</span>
                <HoppButtonSecondary
                  :label="t('action.download_file')"
                  :to="
                    nativeWorkspace
                      ? undefined
                      : `${attachmentURL(attachment.id)}?download=1`
                  "
                  @click="downloadNative(attachment.id)"
                  outline
                />
              </div>
              <img
                v-if="attachment.contentType.startsWith('image/')"
                :src="attachmentURL(attachment.id)"
                alt=""
                class="max-h-80 max-w-full self-start object-contain"
              />
              <video
                v-else-if="attachment.contentType.startsWith('video/')"
                :src="attachmentURL(attachment.id)"
                controls
                preload="metadata"
                class="max-h-80 w-full"
              />
            </div>
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <HoppButtonSecondary :label="t('action.close')" @click="emit('close')" />
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import { downloadNativeHistory } from "~/helpers/native-workbench-history"
import {
  formatBytes,
  historyResultAPI,
  historyResultURL,
  pendingHistoryResults,
  type HistoryResultDetail,
} from "~/helpers/workbench-history-results"

const props = defineProps<{ historyId: string }>()
const emit = defineEmits<{ (event: "close"): void }>()
const t = useI18n()
const path = computed(() => encodeURIComponent(props.historyId))
const bodyURL = computed(() => historyResultURL(`${path.value}/body`))
const attachmentURL = (id: string) =>
  historyResultURL(`${path.value}/attachments/${encodeURIComponent(id)}`)
const detail = ref<HistoryResultDetail>()
const loading = ref(true)
const error = ref(false)
const previewLoading = ref(false)
const previewError = ref(false)
const previewMissing = ref(false)
const preview = ref("")
const truncated = ref(false)
const images = ref<string[]>([])
const links = ref<string[]>([])
const savingLink = ref(false)
const nativeWorkspace = window.__APIREQUEST_NATIVE__ === true

async function downloadNative(attachment?: string) {
  if (!nativeWorkspace) return
  try {
    await downloadNativeHistory(props.historyId, attachment)
  } catch {
    error.value = true
  }
}
const linkError = ref(false)
const controller = new AbortController()

function readJsonMedia(value: unknown) {
  if (typeof value === "string" && /^https?:\/\/\S+$/i.test(value)) {
    links.value = [value]
    return
  }
  const stack = [value]
  const urls = new Set<string>()
  const imageURLs: string[] = []
  while (stack.length) {
    const item = stack.pop()
    if (item === null || typeof item !== "object") continue
    for (const [key, child] of Object.entries(item)) {
      if (typeof child === "object" && child !== null) {
        stack.push(child)
      } else if (typeof child === "string") {
        if (key === "b64_json" && /^[a-z\d+/]+={0,2}$/i.test(child)) {
          const type = child.startsWith("/9j/")
            ? "jpeg"
            : child.startsWith("R0lGOD")
              ? "gif"
              : child.startsWith("UklGR")
                ? "webp"
                : "png"
          imageURLs.push(`data:image/${type};base64,${child}`)
        } else if (
          (key === "url" || key.endsWith("_url")) &&
          /^https?:\/\//i.test(child)
        ) {
          urls.add(child)
        }
      }
    }
  }
  images.value = imageURLs
  links.value = [...urls]
}

async function loadPreview(json: boolean) {
  previewError.value = false
  previewMissing.value = false
  truncated.value = false
  preview.value = ""
  images.value = []
  links.value = []
  previewLoading.value = true
  try {
    const response = await fetch(bodyURL.value, {
      // Tauri's asset protocol does not accept credentialed CORS requests.
      credentials: nativeWorkspace ? "omit" : "include",
      signal: controller.signal,
    })
    if (response.status === 404 || response.status === 410) {
      previewMissing.value = true
      return
    }
    if (!response.ok || !response.body) throw new Error()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const limit = json ? 32 * 1024 * 1024 : 256 * 1024
    let remaining = limit
    let text = ""
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value.subarray(0, remaining), { stream: true })
      remaining -= value.length
      if (remaining < 0) {
        truncated.value = true
        await reader.cancel()
        break
      }
    }
    text += decoder.decode()
    if (json && !truncated.value) {
      try {
        readJsonMedia(JSON.parse(text))
      } catch {
        /* Preserve the original response text. */
      }
    }
    if (!json && !truncated.value && /^https?:\/\/\S+$/i.test(text.trim())) {
      links.value = [text.trim()]
    }
    const visibleChars = 256 * 1024
    truncated.value ||= text.length > visibleChars
    preview.value = text.slice(0, visibleChars)
  } catch {
    if (!controller.signal.aborted) previewError.value = true
  } finally {
    previewLoading.value = false
  }
}

async function loadResult() {
  loading.value = true
  error.value = false
  try {
    await pendingHistoryResults.get(props.historyId)
    const result = await historyResultAPI<HistoryResultDetail>(path.value, {
      signal: controller.signal,
    })
    detail.value = result
    if (
      result.state === "saved" &&
      (result.kind === "json" || result.kind === "text")
    ) {
      void loadPreview(result.kind === "json")
    }
  } catch {
    if (!controller.signal.aborted) error.value = true
  } finally {
    loading.value = false
  }
}

async function saveFile(url: string) {
  if (savingLink.value) return
  savingLink.value = true
  linkError.value = false
  try {
    await historyResultAPI(`${path.value}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    })
    detail.value = await historyResultAPI<HistoryResultDetail>(path.value, {
      signal: controller.signal,
    })
  } catch {
    if (!controller.signal.aborted) linkError.value = true
  } finally {
    savingLink.value = false
  }
}

onMounted(loadResult)
onBeforeUnmount(() => controller.abort())
</script>
