import { computed, inject, onBeforeUnmount, onMounted, provide, watch, type InjectionKey, type Ref } from "vue";
import { subscribeWorkbench, type LiveSource } from "~/services/workbench-realtime.service";

type LiveContext = {
  source: LiveSource
}
const contextKey: InjectionKey<LiveContext> = Symbol("workbench-live")

export function provideWorkbenchLive(source: LiveSource = "backend") {
  const context = { source }
  provide(contextKey, context)
  return context
}

export function useWorkbenchLive() {
  return inject(contextKey)
}

// Invalidation during an in-flight read is retained and followed by another read.
// Reconnecting takes a fresh snapshot; hidden pages keep their subscription.
export function useWorkbenchLiveQuery(
  topics: string[],
  load: () => Promise<unknown>,
  options: {
    blocked?: Ref<boolean>
    source?: LiveSource
    available?: boolean
    context?: LiveContext
  } = {}
) {
  const context = options.context ?? useWorkbenchLive()
  let stop: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false,
    dirty = false,
    running = false
  const allowed = computed(() => !options.blocked?.value)
  const invalidate = () => {
    dirty = true
    if (running || timer || disposed || !allowed.value) return
    timer = setTimeout(async () => {
      timer = undefined
      if (disposed || !allowed.value) return
      dirty = false
      running = true
      try {
        await load()
      } catch {
        /* Query owners retain their own error/retry UI. */
      } finally {
        running = false
        if (dirty) invalidate()
      }
    }, 150)
  }
  onMounted(() => {
    if (options.available === false) return
    // Temporarily blocked pages still get an initial read.
    if (!allowed.value) void load().catch(() => {})
    watch(
      allowed,
      (active) => {
        stop?.()
        stop = undefined
        clearTimeout(timer)
        timer = undefined
        if (active)
          stop = subscribeWorkbench(
            options.source ?? context?.source ?? "backend",
            topics,
            invalidate
          )
      },
      { immediate: true }
    )
  })
  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(timer)
    stop?.()
  })
  return { invalidate }
}
