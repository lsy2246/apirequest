import { effectScope, shallowRef, watch } from "vue";
import { Store } from "~/kernel/store";
import { STORE_NAMESPACE } from "~/services/persistence";

const key = "collection-expansion"
const expansion = shallowRef<Record<string, boolean>>({})
const loaded = shallowRef(false)
let started = false

export function useNativeFolderExpansion() {
  if (!started) {
    started = true
    const initial = Store.get<Record<string, boolean>>(STORE_NAMESPACE, key)
    void initial.then((result) => {
      if (result._tag === "Right" && result.right) {
        expansion.value = { ...result.right, ...expansion.value }
      }
      loaded.value = true
    })
    // 目录在切换页面时会卸载，保存监听随工作区进程存活。
    effectScope(true).run(() => {
      watch(
        expansion,
        async (value) => {
          await initial
          if (value === expansion.value)
            await Store.set(STORE_NAMESPACE, key, value)
        },
        { flush: "sync" }
      )
    })
  }
  return { expansion, loaded }
}
