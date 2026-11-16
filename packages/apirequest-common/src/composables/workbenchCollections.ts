import { computed } from "vue";
import type { HoppCollection } from "@apirequest/data";
import { useI18n } from "~/composables/i18n";
import { useReadonlyStream } from "~/composables/stream";
import { isRootRequestCollection, restCollections$ } from "~/newstore/collections";

export function useWorkbenchCollections() {
  const t = useI18n()
  const collections = useReadonlyStream(restCollections$, [])
  const entries = computed(() => {
    const result: {
      path: string
      title: string
      collection: HoppCollection
    }[] = []
    const visit = (
      items: HoppCollection[],
      parentPath = "",
      parentName = ""
    ) => {
      items.forEach((collection, index) => {
        const path = parentPath ? `${parentPath}/${index}` : String(index)
        const name = isRootRequestCollection(collection)
          ? t("workbench.root_directory")
          : collection.name
        const title = parentName ? `${parentName} / ${name}` : name
        result.push({ path, title, collection })
        visit(collection.folders, path, title)
      })
    }
    visit(collections.value)
    return result
  })
  return { collections, entries }
}
