<template>
  <div class="flex flex-col h-screen overflow-hidden bg-primary">
    <DocumentationHeader
      v-if="!loading && !error && publishedDoc"
      :published-doc="publishedDoc"
      :instance-display-name="instanceDisplayName"
      :environment-name="environmentName"
    />

    <DocumentationSkeleton v-if="loading" />

    <div
      v-else-if="error"
      class="flex items-center justify-center flex-1 py-20"
    >
      <div class="flex flex-col items-center space-y-4 max-w-md text-center">
        <IconAlertCircle class="w-16 h-16 text-red-500" />
        <h2 class="text-xl font-semibold text-secondaryDark">
          {{ t("error.something_went_wrong") }}
        </h2>
        <p class="text-secondaryLight">{{ error }}</p>
      </div>
    </div>

    <DocumentationContent
      v-else-if="collectionData"
      :collection-data="collectionData"
      :is-doc-modal="false"
      :all-items="allItems"
      :update-url-on-select="true"
      :environment-variables="environmentVariables"
    />
  </div>
</template>

<script setup lang="ts">
import IconAlertCircle from "~icons/lucide/alert-circle"
import { ref, onMounted, computed, watch } from "vue"
import { useRoute } from "vue-router"
import { useI18n } from "~/composables/i18n"
import {
  getPublishedDocBySlugREST,
  collectionFolderToHoppCollection,
} from "~/helpers/backend/queries/PublishedDocs"
import * as E from "fp-ts/Either"
import {
  Environment,
  HoppCollection,
  HoppGQLRequest,
  HoppRESTRequest,
  translateToNewEnvironmentVariables,
} from "@apirequest/data"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { hasActualScript } from "@apirequest/js-sandbox/scripting"
import { PublishedDocREST } from "~/helpers/backend/queries/PublishedDocs"

import { getKernelMode } from "@apirequest/kernel"
import { platform } from "~/platform"
import { useReadonlyStream } from "~/composables/stream"
import { usePageHead } from "~/composables/head"

const route = useRoute()
const t = useI18n()

const kernelMode = getKernelMode()

const instancePlatform = platform.instance

const currentState =
  kernelMode === "desktop" &&
  instancePlatform?.instanceSwitchingEnabled &&
  instancePlatform.getConnectionStateStream
    ? useReadonlyStream(
        instancePlatform.getConnectionStateStream(),
        instancePlatform.getCurrentConnectionState?.() ?? {
          status: "disconnected" as const,
        }
      )
    : ref({
        status: "disconnected" as const,
        instance: { displayName: "API Request" },
      })

const instanceDisplayName = computed(() => {
  if (currentState.value.status !== "connected") {
    return "API Request"
  }
  return currentState.value.instance.displayName
})

const publishedDoc = ref<Partial<PublishedDocREST> | null>(null)
const collectionData = ref<HoppCollection | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const environmentVariables = ref<Environment["variables"]>([])
const environmentName = ref<string | null>(null)

type DocumentationItem = {
  id: string
  type: "folder" | "request"
  item: HoppCollection | HoppRESTRequest | HoppGQLRequest
  inheritedProperties: HoppInheritedProperty
}

/**
 * Recursively flattens a collection into an array of documentation items
 */
const flattenCollection = (
  collection: HoppCollection,
  items: DocumentationItem[] = [],
  inheritedProperties: HoppInheritedProperty | undefined = undefined
): DocumentationItem[] => {
  const currentInheritedProps: HoppInheritedProperty = {
    auth:
      collection.auth.authType === "inherit"
        ? (inheritedProperties?.auth ?? {
            parentID: "",
            parentName: "",
            inheritedAuth: { authType: "none", authActive: true },
          })
        : {
            parentID: collection.id || "",
            parentName: collection.name,
            inheritedAuth: collection.auth,
          },
    headers: [
      ...(inheritedProperties?.headers || []),
      ...(collection.headers || []).map((h) => ({
        parentID: collection.id || "",
        parentName: collection.name,
        inheritedHeader: h,
      })),
    ],
    variables: [
      ...(inheritedProperties?.variables || []),
      {
        parentID: collection.id || "",
        parentName: collection.name,
        inheritedVariables: (collection.variables || []).map((v) => ({
          ...v,
          secret: v.secret,
        })),
      },
    ],
    scripts: [
      ...(inheritedProperties?.scripts || []),
      ...(hasActualScript(collection.preRequestScript) ||
      hasActualScript(collection.testScript)
        ? [
            {
              parentID:
                collection.id ||
                collection._ref_id ||
                `collection-${collection.name}`,
              parentName: collection.name,
              preRequestScript: collection.preRequestScript || "",
              testScript: collection.testScript || "",
            },
          ]
        : []),
    ],
  }

  if (collection.folders && collection.folders.length > 0) {
    collection.folders.forEach((folder: HoppCollection) => {
      items.push({
        id: folder.id || (folder as any)._ref_id || `folder-${folder.name}`,
        type: "folder",
        item: folder,
        inheritedProperties: currentInheritedProps,
      })
      flattenCollection(folder, items, currentInheritedProps)
    })
  }

  // collectionFolderToHoppCollection ensures all requests are converted to the latest version
  if (collection.requests && collection.requests.length > 0) {
    ;(collection.requests as (HoppRESTRequest | HoppGQLRequest)[]).forEach(
      (request) => {
        items.push({
          id:
            request.id || (request as any)._ref_id || `request-${request.name}`,
          type: "request",
          item: request,
          inheritedProperties: currentInheritedProps,
        })
      }
    )
  }

  return items
}

const allItems = computed<DocumentationItem[]>(() => {
  if (!collectionData.value) return []

  return flattenCollection(collectionData.value)
})

const fetchDocs = async (docId: string, version: string) => {
  loading.value = true
  error.value = null

  if (!docId) {
    error.value = t("documentation.publish.no_doc_id")
    loading.value = false
    return
  }

  // Fetch published doc using REST API (public access, no authentication required)
  // If version is provided, fetch that specific version; otherwise fetch latest
  const result = await getPublishedDocBySlugREST(docId, version)()

  if (E.isLeft(result)) {
    console.error("Error fetching published doc:", result.left)
    error.value = t("documentation.publish.not_found")
    loading.value = false
    return
  }

  publishedDoc.value = {
    autoSync: result.right.autoSync ?? false,
    createdOn: result.right.createdOn,
    id: result.right.id,
    updatedOn: result.right.updatedOn,
    version: result.right.version,
    metadata: result.right.metadata,
    title: result.right.title,
    creatorUid: result.right.creatorUid,
    versions: result.right.versions,
  }

  environmentName.value = result.right.environmentName ?? null

  // 环境由发布版本绑定，访问页直接使用该版本返回的变量。
  environmentVariables.value = []
  const rawEnvVars = result.right.environmentVariables
  if (rawEnvVars) {
    try {
      const parsed =
        typeof rawEnvVars === "string" ? JSON.parse(rawEnvVars) : rawEnvVars
      if (Array.isArray(parsed)) {
        environmentVariables.value = parsed.map((v) =>
          translateToNewEnvironmentVariables(v)
        )
      }
    } catch (e) {
      console.error("Error parsing environment variables:", e)
    }
  }

  const publishedData = JSON.parse(result.right.documentTree)

  // Convert the REST API response (CollectionFolder) to HoppCollection format
  const hoppCollection = collectionFolderToHoppCollection(publishedData)

  collectionData.value = hoppCollection

  loading.value = false
}

onMounted(() => {
  const docId = route.params.id as string
  const version = route.params.version as string
  fetchDocs(docId, version)
})

watch(
  () => [route.params.id, route.params.version],
  ([newId, newVersion], [oldId, oldVersion]) => {
    if (newId !== oldId || newVersion !== oldVersion) {
      fetchDocs(newId as string, newVersion as string)
    }
  }
)

usePageHead({
  title: computed(
    () => publishedDoc.value?.title || "API Request Documentation"
  ),
  meta: [
    {
      name: "description",
      content: computed(
        () =>
          collectionData.value?.description || "API Request API Documentation"
      ),
    },
    {
      property: "og:title",
      content: computed(
        () => publishedDoc.value?.title || "API Request Documentation"
      ),
    },
    {
      property: "og:description",
      content: computed(
        () =>
          collectionData.value?.description || "API Request API Documentation"
      ),
    },
    {
      property: "og:site_name",
      content: "API Request",
    },
    {
      property: "og:image",
      content: "",
    },
    {
      name: "twitter:card",
      content: "summary_large_image",
    },
    {
      name: "twitter:site",
      content: "",
    },
    {
      name: "twitter:creator",
      content: "",
    },
    {
      name: "twitter:title",
      content: computed(
        () => publishedDoc.value?.title || "API Request Documentation"
      ),
    },
    {
      name: "twitter:description",
      content: computed(
        () =>
          collectionData.value?.description || "API Request API Documentation"
      ),
    },
    {
      name: "twitter:image",
      content: "",
    },
  ],
})
</script>

<route lang="yaml">
meta:
  layout: empty
</route>
