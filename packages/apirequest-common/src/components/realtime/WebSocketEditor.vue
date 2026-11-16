<template>
  <AppPaneLayout layout-id="websocket">
    <template #primary>
      <div
        class="sticky top-0 z-10 flex flex-shrink-0 space-x-2 overflow-x-auto bg-primary p-4"
      >
        <HoppSmartInput
          v-model="url"
          type="url"
          :autofocus="false"
          styles="!inline-flex flex-1 space-x-2"
          input-styles="w-full px-4 py-2 border rounded !bg-primaryLight border-divider text-secondaryDark"
          :placeholder="`${t('websocket.url')}`"
          :disabled="
            connectionState === 'CONNECTED' || connectionState === 'CONNECTING'
          "
          @submit="isUrlValid ? toggleConnection() : null"
        >
          <template #button>
            <HoppButtonPrimary
              data-websocket-connect
              :disabled="!isUrlValid"
              class="w-32"
              name="connect"
              :label="
                connectionState === 'CONNECTING'
                  ? t('action.connecting')
                  : connectionState === 'DISCONNECTED'
                    ? t('action.connect')
                    : t('action.disconnect')
              "
              :loading="connectionState === 'CONNECTING'"
              @click="toggleConnection"
            />
          </template>
        </HoppSmartInput>
      </div>
      <HoppSmartTabs
        v-model="selectedTab"
        styles="sticky overflow-x-auto flex-shrink-0 bg-primary top-upperPrimaryStickyFold z-10"
        render-inactive-tabs
      >
        <HoppSmartTab
          :id="'communication'"
          :label="`${t('websocket.communication')}`"
        >
          <RealtimeCommunication
            :active="active"
            :is-connected="connectionState === 'CONNECTED'"
            sticky-header-styles="top-upperSecondaryStickyFold"
            @send-message="sendMessage($event)"
          />
        </HoppSmartTab>
        <HoppSmartTab :id="'protocols'" :label="`${t('websocket.protocols')}`">
          <div
            class="sticky top-upperSecondaryStickyFold z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4"
          >
            <label class="truncate font-semibold text-secondaryLight">
              {{ t("websocket.protocols") }}
            </label>
            <div class="flex">
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                :title="t('action.clear_all')"
                :icon="IconTrash2"
                @click="clearContent"
              />
              <HoppButtonSecondary
                v-tippy="{ theme: 'tooltip' }"
                :title="t('add.new')"
                :icon="IconPlus"
                @click="addProtocol"
              />
            </div>
          </div>
          <draggable
            v-model="protocolsWithID"
            item-key="id"
            animation="250"
            handle=".draggable-handle"
            draggable=".draggable-content"
            ghost-class="cursor-move"
            chosen-class="bg-primaryLight"
            drag-class="cursor-grabbing"
            :move="
              (event: DragDropEvent) =>
                isDragDropAllowed(event, protocols.length)
            "
          >
            <template #item="{ element: { protocol }, index }">
              <div
                class="draggable-content group flex divide-x divide-dividerLight border-b border-dividerLight"
              >
                <span>
                  <HoppButtonSecondary
                    v-tippy="{
                      theme: 'tooltip',
                      delay: [500, 20],
                      content:
                        index !== protocols.length - 1
                          ? t('action.drag_to_reorder')
                          : null,
                    }"
                    :icon="IconGripVertical"
                    class="opacity-0"
                    :class="{
                      'draggable-handle cursor-grab group-hover:opacity-100':
                        index !== protocols.length - 1,
                    }"
                    tabindex="-1"
                  />
                </span>
                <input
                  :value="protocol.value"
                  class="flex flex-1 bg-transparent px-4 py-2"
                  :placeholder="`${t('count.protocol', { count: index + 1 })}`"
                  name="message"
                  type="text"
                  autocomplete="off"
                  @input="
                    updateProtocol(index, {
                      value: ($event.target as HTMLInputElement).value,
                      active: protocol.active,
                    })
                  "
                />
                <span>
                  <HoppButtonSecondary
                    v-tippy="{ theme: 'tooltip' }"
                    :title="
                      protocol.hasOwnProperty('active')
                        ? protocol.active
                          ? t('action.turn_off')
                          : t('action.turn_on')
                        : t('action.turn_off')
                    "
                    :icon="
                      protocol.hasOwnProperty('active')
                        ? protocol.active
                          ? IconCheckCircle
                          : IconCircle
                        : IconCheckCircle
                    "
                    color="green"
                    @click="
                      updateProtocol(index, {
                        value: protocol.value,
                        active: !protocol.active,
                      })
                    "
                  />
                </span>
                <span>
                  <HoppButtonSecondary
                    v-tippy="{ theme: 'tooltip' }"
                    :title="t('action.remove')"
                    :icon="IconTrash"
                    color="red"
                    @click="deleteProtocol(index)"
                  />
                </span>
              </div>
            </template>
          </draggable>
          <HoppSmartPlaceholder
            v-if="protocols.length === 0"
            :src="`/images/states/${colorMode.value}/add_category.svg`"
            :alt="`${t('empty.protocols')}`"
            :text="`${t('empty.protocols')}`"
          />
        </HoppSmartTab>
      </HoppSmartTabs>
    </template>
    <template #secondary>
      <RealtimeLog
        :title="t('websocket.log')"
        :log="log as LogEntryData[]"
        @delete="clearLogEntries()"
      />
    </template>
  </AppPaneLayout>
</template>
<script setup lang="ts">
import IconTrash2 from "~icons/lucide/trash-2";
import IconPlus from "~icons/lucide/plus";
import IconCheckCircle from "~icons/lucide/check-circle";
import IconCircle from "~icons/lucide/circle";
import IconGripVertical from "~icons/lucide/grip-vertical";
import IconTrash from "~icons/lucide/trash";
import draggable from "vuedraggable-es";
import type { LogEntryData } from "~/components/realtime/Log.vue";
import { isDragDropAllowed, type DragDropEvent } from "~/helpers/dragDropValidation";
import { computed, onUnmounted, ref } from "vue";
import type { HoppWSProtocol, HoppWSRequest } from "~/helpers/types/websocket";
import type { HoppRealtimeLog, HoppRealtimeLogLine } from "~/helpers/types/HoppRealtimeLog";
import { useI18n } from "@composables/i18n";
import { useStreamSubscriber, useReadonlyStream } from "@composables/stream";
import { useToast } from "@composables/toast";
import { useColorMode } from "@composables/theming";
import { WSConnection } from "@helpers/realtime/WSConnection";

defineProps({ active: { type: Boolean, default: true } })
const request = defineModel<HoppWSRequest>({ required: true })
const t = useI18n()
const toast = useToast()
const colorMode = useColorMode()
const { subscribeToStream } = useStreamSubscriber()

const selectedTab = ref<"communication" | "protocols">("communication")
const url = computed({
  get: () => request.value.endpoint,
  set: (endpoint) => {
    request.value = { ...request.value, endpoint }
  },
})
const protocols = computed({
  get: () => request.value.protocols,
  set: (value) => {
    request.value = { ...request.value, protocols: value }
  },
})
const protocolsWithID = computed({
  get: () =>
    protocols.value.map((protocol, index) => ({
      id: `protocol-${index}`,
      protocol,
    })),
  set: (value) => {
    protocols.value = value.map(({ protocol }) => protocol)
  },
})

const isUrlValid = computed(() => {
  try {
    const parsed = new URL(url.value)
    return ["ws:", "wss:"].includes(parsed.protocol) && !parsed.hash
  } catch {
    return false
  }
})

// 每个标签持有自己的连接和消息记录，关掉标签时释放连接。
const socket = new WSConnection()
const connectionState = useReadonlyStream(
  socket.connectionState$,
  "DISCONNECTED"
)
const log = ref<HoppRealtimeLog>([])
const appendLog = (line: HoppRealtimeLogLine) => {
  log.value = [...log.value, line]
}
onUnmounted(() => socket.disconnect())

subscribeToStream(socket.event$, (event) => {
  switch (event?.type) {
    case "CONNECTING":
    case "CONNECTED":
      log.value = [
        {
          payload: t(
            event.type === "CONNECTED"
              ? "state.connected_to"
              : "state.connecting_to",
            { name: url.value }
          ).toString(),
          source: "info",
          color: "var(--accent-color)",
          ts: event.type === "CONNECTED" ? event.time : undefined,
        },
      ]
      if (event.type === "CONNECTED")
        toast.success(t("state.connected").toString())
      break

    case "MESSAGE_SENT":
    case "MESSAGE_RECEIVED":
      appendLog({
        payload: event.message,
        source: event.type === "MESSAGE_SENT" ? "client" : "server",
        ts: event.time,
      })
      break

    case "ERROR":
      appendLog({
        payload:
          event.error instanceof SyntaxError
            ? event.error.message
            : t("error.something_went_wrong").toString(),
        source: "info",
        color: "#ff5555",
        ts: event.time,
      })
      break

    case "DISCONNECTED":
      appendLog({
        payload: t("state.disconnected_from", { name: url.value }).toString(),
        source: "disconnected",
        color: "#ff5555",
        ts: event.time,
      })
      toast.error(t("state.disconnected").toString())
      break
  }
})

function toggleConnection() {
  if (connectionState.value === "DISCONNECTED") {
    if (isUrlValid.value) {
      socket.connect(
        url.value,
        protocols.value
          .filter(({ active, value }) => active && value)
          .map(({ value }) => value)
      )
    }
  } else socket.disconnect()
}

const sendMessage = (event: { message: string; eventName: string }) => {
  socket.sendMessage(event)
}
const clearContent = () => {
  protocols.value = []
}
const addProtocol = () => {
  protocols.value = [...protocols.value, { value: "", active: true }]
}
const deleteProtocol = (index: number) => {
  const previous = protocols.value
  protocols.value = previous.filter((_, i) => i !== index)
  toast.success(t("state.deleted").toString(), {
    duration: 4000,
    action: {
      label: t("action.undo").toString(),
      onClick: (_, { dismiss }) => {
        protocols.value = previous
        dismiss()
      },
    },
  })
}
const updateProtocol = (index: number, updated: HoppWSProtocol) => {
  protocols.value = protocols.value.map((protocol, i) =>
    i === index ? updated : protocol
  )
}
const clearLogEntries = () => {
  log.value = []
}
</script>
