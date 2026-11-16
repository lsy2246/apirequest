<template>
  <WorkbenchPage>
    <header class="workbench-page-header">
      <div>
        <h1 class="text-xl font-semibold text-secondaryDark">
          {{ t("workbench.documentation") }}
        </h1>
        <p class="mt-2 text-secondaryLight">
          {{ t("workbench.docs_description") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <WorkbenchToggle
          :on="isDocumentationVisible"
          @change="isDocumentationVisible = !isDocumentationVisible"
        >
          {{ t("workbench.enable_documentation_management") }}
        </WorkbenchToggle>
        <HoppButtonPrimary
          v-if="isDocumentationVisible"
          :icon="IconPlus"
          :label="t('workbench.new_curl')"
          @click="openWorkbenchCurlImport(router)"
        />
      </div>
    </header>
    <div
      v-if="!isDocumentationVisible"
      class="rounded-lg border border-divider bg-primary p-6 text-secondaryLight"
      role="status"
    >
      {{ t("workbench.documentation_management_disabled") }}
    </div>
    <div
      v-else-if="!entries.length"
      class="flex min-h-64 flex-col items-center justify-center rounded border border-divider bg-primary p-8 text-secondaryLight"
    >
      <IconFolder class="mb-4 h-12 w-12 opacity-40" />
      <p>{{ t("workbench.no_collections") }}</p>
      <HoppButtonSecondary
        class="mt-4"
        :label="t('action.new')"
        @click="createCollection"
      />
    </div>
    <div v-else class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="entry in entries"
        :key="entry.path"
        class="workbench-document-card flex min-w-0 flex-col rounded-lg border border-divider bg-primary p-5"
      >
        <div class="mb-4 flex items-center gap-3">
          <IconFolder class="h-5 w-5 text-accent" />
          <h2
            class="truncate font-semibold text-secondaryDark"
            :title="entry.title"
          >
            {{ entry.title }}
          </h2>
        </div>
        <p class="mb-5 text-tiny text-secondaryLight">
          {{ entry.collection.requests.length }} {{ t("workbench.requests") }} ·
          {{ entry.collection.folders.length }} {{ t("workbench.folders") }}
        </p>
        <HoppButtonSecondary
          :icon="IconBook"
          :label="t('workbench.open_documentation')"
          outline
          @click="selectedRef = entry.collection._ref_id || entry.collection.id"
        />
      </article>
    </div>
    <CollectionsDocumentation
      v-if="isDocumentationVisible && selected"
      :show="true"
      :collection="selected.collection"
      :collection-i-d="
        selected.collection.id || selected.collection._ref_id || ''
      "
      :path-or-i-d="selected.path"
      :is-team-collection="false"
      @hide-modal="selectedRef = undefined"
    />
  </WorkbenchPage>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import WorkbenchPage from "~/components/workbench/Page.vue";
import { computed, ref, nextTick, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "~/composables/i18n";
import { useDocumentationVisibility } from "~/composables/documentationVisibility";
import { useWorkbenchCollections } from "~/composables/workbenchCollections";
import { openWorkbenchCurlImport } from "~/helpers/workbench";
import { invokeAction } from "~/helpers/actions";
import IconFolder from "~icons/lucide/folder";
import IconBook from "~icons/lucide/book-open";
import IconPlus from "~icons/lucide/plus";
const t = useI18n()
const { isDocumentationVisible } = useDocumentationVisibility()
const router = useRouter()
const { entries } = useWorkbenchCollections()
const selectedRef = ref<string>()
const selected = computed(() =>
  selectedRef.value
    ? entries.value.find(
        (entry) =>
          (entry.collection._ref_id || entry.collection.id) ===
          selectedRef.value
      )
    : undefined
)
watch(isDocumentationVisible, (visible) => {
  if (!visible) selectedRef.value = undefined
})
const createCollection = async () => {
  await router.push("/")
  await nextTick()
  invokeAction("collection.new")
}
</script>
