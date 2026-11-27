<template>
  <div
    class="capture-workbench relative flex h-full min-h-0 flex-col bg-primary"
    @keydown.esc="tool = undefined"
  >
    <header
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-divider px-3 py-2"
    >
      <div class="flex shrink-0 items-center gap-2">
        <h1 class="font-semibold text-secondaryDark">
          {{ t("workbench_capture.title") }}
        </h1>
        <span class="capture-count text-tiny text-secondaryLight">
          {{ total }} {{ t("workbench_capture.requests_count") }}
        </span>
      </div>
      <span v-if="state?.mode" class="text-tiny text-secondaryLight">
        {{ t(`workbench_capture.mode_${state.mode}`) }}
      </span>
      <slot name="access" />
      <span
        role="status"
        class="text-tiny"
        :class="state?.recording ? 'text-green-600' : 'text-secondaryLight'"
        >●
        {{
          t(
            initialLoading
              ? "state.loading"
              : !state && error
                ? "workbench.load_failed"
                : `workbench_capture.${active ? (state?.recording ? "recording_active" : "recording_paused") : "stopped"}`
          )
        }}</span
      >
      <div v-if="archiveID" class="flex min-w-0 max-w-56 items-center gap-1">
        <span
          :title="sessionName"
          class="truncate text-tiny text-secondaryLight"
          >{{ sessionName }}</span
        >
        <HoppButtonSecondary
          :icon="IconClose"
          :title="t('action.close')"
          :aria-label="t('action.close')"
          @click="showLive"
        />
      </div>
      <div class="ml-auto flex flex-wrap justify-end gap-1">
        <HoppButtonPrimary
          :label="
            t(
              state?.recording
                ? 'workbench_capture.pause_recording'
                : 'workbench_capture.start_recording'
            )
          "
          :loading="busy"
          :disabled="busy || !state"
          @click="setRecording(!state?.recording)"
        />
        <HoppButtonSecondary
          v-if="batchIDs.length"
          :label="`${t('workbench_capture.replay')} (${batchIDs.length})`"
          :disabled="busy"
          @click="confirmReplay = [...batchIDs]"
        />
        <HoppButtonSecondary
          v-for="tab in toolTabs"
          :key="tab"
          :label="toolLabels[tab]"
          :aria-expanded="tool === tab"
          :class="{ 'text-accent': tool === tab }"
          @click="toggleTool(tab)"
        />
      </div>
    </header>
    <p v-if="!available" class="p-4 text-secondaryLight">
      {{ t("workbench_capture.engine_unavailable") }}
    </p>
    <template v-else>
      <div
        class="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-2"
      >
        <input
          v-model="filter"
          :aria-label="t('action.search')"
          :placeholder="t('action.search')"
          class="min-w-0 flex-1 rounded border border-divider bg-primaryLight px-2 py-1.5"
        />
        <button
          v-if="filterCount"
          class="shrink-0 rounded px-2 py-1.5 text-accent hover:bg-primaryLight"
          @click="clearFilters"
        >
          {{ t("workbench_capture.filter_clear_all", { count: filterCount }) }}
        </button>
        <details
          ref="displayMenu"
          class="relative shrink-0"
          @keydown.esc.stop.prevent="closeDisplay(true)"
        >
          <summary
            class="flex cursor-pointer list-none items-center gap-2 rounded border border-divider px-3 py-1.5 font-semibold text-secondary hover:bg-primaryLight focus-visible:outline focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
          >
            <IconDisplay />
            {{ t("workbench_capture.display") }}
            <IconChevron />
          </summary>
          <div
            class="capture-display absolute right-0 top-full z-30 mt-2 max-h-[min(28rem,65vh)] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded border border-divider bg-primary p-3 shadow-lg"
          >
            <fieldset class="border-b border-divider pb-3">
              <legend class="mb-2 font-semibold text-secondaryDark">
                {{ t("layout.name") }}
              </legend>
              <label
                class="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-primaryLight"
              >
                <input
                  v-model="bottom"
                  type="radio"
                  name="capture-detail-layout"
                  :value="false"
                />
                {{ t("workbench_capture.side_layout") }}
              </label>
              <label
                class="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-primaryLight"
              >
                <input
                  v-model="bottom"
                  type="radio"
                  name="capture-detail-layout"
                  :value="true"
                />
                {{ t("workbench_capture.bottom_layout") }}
              </label>
            </fieldset>
            <fieldset class="mt-3">
              <legend class="mb-2 font-semibold text-secondaryDark">
                {{ t("workbench_capture.columns") }}
              </legend>
              <div class="grid grid-cols-2 gap-x-2">
                <label
                  v-for="col in columnOptions"
                  :key="col"
                  class="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-primaryLight"
                >
                  <input v-model="columns" type="checkbox" :value="col" />
                  {{ columnLabel(col) }}
                </label>
              </div>
            </fieldset>
          </div>
        </details>
      </div>
      <p
        v-if="error || state?.error"
        role="alert"
        class="shrink-0 bg-red-500/10 px-3 py-2 text-red-500"
      >
        {{ t(`workbench_capture.${error || state?.error}`) }}
        <HoppButtonSecondary
          :label="t('action.retry')"
          :loading="initialLoading"
          @click="refreshLive"
        />
      </p>
      <p
        v-if="archiveStatus?.dropped"
        role="status"
        class="shrink-0 bg-amber-500/10 px-3 py-1 text-amber-600"
      >
        {{
          t("workbench_capture.archive_incomplete", {
            count: archiveStatus.dropped,
          })
        }}
      </p>
      <div class="capture-main flex min-h-0 flex-1 overflow-hidden">
        <aside
          v-if="applications.length || hosts.length"
          class="capture-sidebar w-44 shrink-0 overflow-y-auto border-r border-divider bg-primaryLight p-2"
          :class="{ 'capture-mobile-hidden': selectedID }"
        >
          <section
            v-if="applications.length"
            :aria-label="t('workbench_capture.col_application')"
            class="capture-filter-group"
          >
            <h2 class="px-2 py-2 font-semibold text-secondaryLight">
              {{ t("workbench_capture.col_application") }}
            </h2>
            <div class="capture-filter-options">
              <label
                v-for="application in applications"
                :key="application"
                :title="application"
                class="capture-filter-option flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                :class="
                  selectedApplications.includes(application)
                    ? 'bg-primary text-accent'
                    : ''
                "
              >
                <input
                  v-model="selectedApplications"
                  type="checkbox"
                  :value="application"
                  class="shrink-0 accent-accent"
                />
                <span class="truncate">{{ application }}</span>
              </label>
            </div>
          </section>
          <section
            v-if="hosts.length"
            :aria-label="t('workbench_capture.domains')"
            class="capture-filter-group"
          >
            <h2 class="px-2 py-2 font-semibold text-secondaryLight">
              {{ t("workbench_capture.domains") }}
            </h2>
            <div class="capture-filter-options">
              <label
                v-for="host in hosts"
                :key="host"
                :title="host"
                class="capture-filter-option flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                :class="
                  selectedHosts.includes(host) ? 'bg-primary text-accent' : ''
                "
              >
                <input
                  v-model="selectedHosts"
                  type="checkbox"
                  :value="host"
                  class="shrink-0 accent-accent"
                />
                <span class="truncate">{{ host }}</span>
              </label>
            </div>
          </section>
        </aside>
        <div
          class="capture-content flex min-h-0 min-w-0 flex-1"
          :class="bottom ? 'flex-col' : 'capture-split'"
        >
          <section
            class="capture-list flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            :class="{ 'capture-mobile-hidden': selectedID }"
          >
            <div class="min-h-0 flex-1 overflow-x-auto">
              <div
                class="capture-table-head grid h-8 items-center border-b border-divider bg-primaryLight px-2 font-semibold text-secondaryLight"
                :style="{
                  gridTemplateColumns: tableColumns,
                  minWidth: tableWidth,
                }"
              >
                <span></span>
                <ColumnMenu
                  column="sequence"
                  :label="columnLabel('sequence')"
                  :sorted="sortBy === 'sequence'"
                  :descending="sortDescending"
                  @sort="setSort('sequence', $event)"
                />
                <ColumnMenu
                  v-for="col in columns"
                  :key="col"
                  :column="col"
                  :label="columnLabel(col)"
                  :sorted="sortBy === col"
                  :descending="sortDescending"
                  :value="
                    col === 'application'
                      ? selectedApplications
                      : columnFilters[col]
                  "
                  :options="
                    col === 'application'
                      ? applications
                      : col === 'method'
                        ? page.methods
                        : undefined
                  "
                  @sort="setSort(col, $event)"
                  @filter="setColumnFilter(col, $event)"
                />
              </div>
              <p
                v-if="initialLoading || pageLoading"
                role="status"
                aria-busy="true"
                class="flex items-center gap-2 px-3 py-2 text-secondaryLight"
              >
                <HoppSmartSpinner />{{
                  t(
                    initialLoading
                      ? "ui_detail.loading_capture"
                      : "state.loading"
                  )
                }}
              </p>
              <div
                v-if="pageError"
                role="alert"
                class="px-3 py-2 ui-status-error"
              >
                {{ t("workbench.load_failed") }}
                <HoppButtonSecondary
                  :label="t('action.retry')"
                  @click="loadPage"
                />
              </div>
              <div
                v-bind="containerProps"
                class="capture-rows"
                :style="{ minWidth: tableWidth }"
                tabindex="0"
                @keydown.down.prevent="stepSelection(1)"
                @keydown.up.prevent="stepSelection(-1)"
              >
                <div v-bind="wrapperProps">
                  <div
                    v-for="{ data: entry } in virtualRows"
                    :key="entry.id"
                    class="grid h-[34px] items-center border-b border-dividerLight px-2 text-tiny hover:bg-primaryLight"
                    :class="{ 'bg-accent/10': selectedID === entry.id }"
                    :style="{ gridTemplateColumns: tableColumns }"
                    @click="select(entry.id)"
                  >
                    <input
                      v-if="active && entry.originalRequest && entry.replayable"
                      v-model="batchIDs"
                      type="checkbox"
                      :value="entry.id"
                      :aria-label="`${t('workbench_capture.replay')}: ${entry.url}`"
                      @click.stop
                    />
                    <span
                      v-else
                      class="text-green-600"
                      :class="{ '!text-red-500': entry.failed }"
                      >●</span
                    >
                    <span
                      class="capture-sequence truncate pr-3 text-right tabular-nums text-secondaryLight"
                      :title="t('workbench_capture.col_sequence')"
                    >
                      {{ entry.sequence ?? "—" }}
                    </span>
                    <span
                      v-for="col in columns"
                      :key="col"
                      class="truncate pr-3"
                      :class="{
                        'text-red-500':
                          col === 'status' && (entry.status ?? 0) >= 400,
                      }"
                      :title="cellTitle(entry, col)"
                      :style="
                        col === 'method'
                          ? { color: getMethodLabelColor(entry.method) }
                          : undefined
                      "
                      >{{ cell(entry, col) }}</span
                    >
                  </div>
                </div>
                <p
                  v-if="
                    !visibleEntries.length &&
                    !initialLoading &&
                    !pageLoading &&
                    !pageError &&
                    !error
                  "
                  class="p-6 text-secondaryLight"
                >
                  {{
                    t(
                      filterCount
                        ? "ui_detail.no_matches"
                        : "workbench_capture.empty"
                    )
                  }}
                </p>
              </div>
            </div>
            <div
              v-if="total > pageSize"
              class="flex shrink-0 items-center justify-between border-t border-divider px-2 py-1"
            >
              <HoppButtonSecondary
                :label="t('workbench_capture.previous')"
                :disabled="offset === 0 || busy"
                @click="changePage(-1)"
              /><span
                >{{ offset + 1 }}–{{ Math.min(offset + pageSize, total) }} /
                {{ total }}</span
              ><HoppButtonSecondary
                :label="t('workbench_capture.next')"
                :disabled="offset + pageSize >= total || busy"
                @click="changePage(1)"
              />
            </div>
          </section>
          <section
            v-if="selectedID"
            class="capture-detail flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-divider"
            :class="bottom ? 'border-t' : 'border-l'"
          >
            <DetailToolbar
              :detail="detail"
              :comparison="comparison"
              :can-open="!!draft"
              :can-replay="
                !!(active && detail?.originalRequest && detail?.replayable)
              "
              :busy="busy"
              @open-request="openRequest"
              @copy-curl="copyCurl"
              @download-har="downloadHar"
              @replay="detail && (confirmReplay = [detail.id])"
              @mark-comparison="markComparison"
              @clear-comparison="clearComparison"
              @close="select('')"
            />
            <template v-if="detail">
              <nav
                class="flex shrink-0 gap-1 overflow-x-auto border-b border-divider px-2 py-1"
                :aria-label="t('workbench_capture.request')"
              >
                <button
                  v-for="tab in tabs"
                  :key="tab"
                  class="shrink-0 rounded px-3 py-1.5"
                  :class="
                    pane === tab
                      ? 'bg-primaryLight text-accent'
                      : 'text-secondaryLight'
                  "
                  :aria-pressed="pane === tab"
                  @click="pane = tab"
                >
                  {{ t(`workbench_capture.${tab}`) }}
                </button>
              </nav>
              <div class="min-h-0 flex-1 overflow-auto p-3">
                <BreakpointEditor
                  v-if="!archiveID && active && detail.paused"
                  :key="detail.id + detail.paused"
                  :phase="detail.paused"
                  :original-u-r-l="detail.url"
                  :original-status="detail.status"
                  :busy="busy"
                  class="mb-3"
                  @resume="resume"
                />
                <ResponseDiff
                  v-if="pane === 'compare' && comparison"
                  :before="comparisonText(comparison)"
                  :after="comparisonText(detail)"
                />
                <div v-else-if="pane === 'timing'" class="space-y-4">
                  <p class="text-secondaryLight">
                    {{ detail.protocol }} · {{ detail.client || "—" }} →
                    {{ detail.server || "—" }}
                  </p>
                  <div
                    v-for="timing in timingRows"
                    :key="timing.name"
                    class="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-center gap-3"
                  >
                    <span>{{
                      t(`workbench_capture.timing_${timing.name}`)
                    }}</span>
                    <div class="h-4 rounded bg-primaryLight">
                      <div
                        class="h-full min-w-[2px] rounded bg-accent/60"
                        :style="{
                          width: `${timing.width}%`,
                          marginLeft: `${timing.left}%`,
                        }"
                      />
                    </div>
                    <span class="font-mono text-tiny"
                      >{{ timing.value }} ms</span
                    >
                  </div>
                  <p v-if="!timingRows.length">
                    {{ t("workbench_capture.timing_pending") }}
                  </p>
                  <p class="text-tiny text-secondaryLight">
                    {{ t("workbench_capture.timing_note") }}
                  </p>
                </div>
                <div v-else-if="pane === 'frames'" class="space-y-2">
                  <input
                    v-model="frameFilter"
                    :placeholder="t('action.search')"
                    class="w-full rounded border border-divider bg-primaryLight p-2"
                  />
                  <article
                    v-for="(frame, index) in shownFrames"
                    :key="index"
                    class="rounded border border-divider p-2"
                  >
                    <p class="mb-1 text-accent">
                      {{ frame.outgoing ? "↑" : "↓" }} {{ frame.size }} B
                      <span v-if="frame.timestamp"
                        >·
                        {{
                          new Date(frame.timestamp).toLocaleTimeString()
                        }}</span
                      >
                    </p>
                    <ConsoleValue
                      :value="frame.text ?? t('workbench_capture.binary')"
                    />
                  </article>
                  <div v-if="storedSession" class="flex gap-2">
                    <HoppButtonSecondary
                      :label="t('workbench_capture.previous')"
                      :disabled="frameOffset === 0 || busy"
                      @click="loadFrames(Math.max(0, frameOffset - 200))"
                    />
                    <HoppButtonSecondary
                      :label="t('action.refresh')"
                      :disabled="busy"
                      @click="loadFrames()"
                    />
                    <HoppButtonSecondary
                      :label="t('workbench_capture.next')"
                      :disabled="moreFrames === null || busy"
                      @click="loadFrames(moreFrames ?? frameOffset)"
                    />
                  </div>
                </div>
                <ol v-else-if="pane === 'rule_trace'" class="space-y-2">
                  <li
                    v-for="(trace, index) in detail.ruleTrace"
                    :key="index"
                    class="rounded border border-divider p-3"
                  >
                    <span class="text-accent"
                      >{{ index + 1 }}.
                      {{ t(`workbench_capture.${trace.action}`) }}</span
                    >
                    {{ trace.name }}
                    <p
                      class="mt-1 break-all font-mono text-tiny text-secondaryLight"
                    >
                      {{ trace.match }}
                    </p>
                  </li>
                  <li
                    v-if="!detail.ruleTrace?.length"
                    class="text-secondaryLight"
                  >
                    {{ t("workbench_capture.no_rules") }}
                  </li>
                </ol>
                <template v-else>
                  <details
                    :open="(shownHeaders?.length ?? 0) <= 8"
                    class="mb-4"
                  >
                    <summary
                      class="mb-2 cursor-pointer font-semibold text-secondaryLight"
                    >
                      {{ t("workbench_capture.headers") }} ·
                      {{ shownHeaders?.length ?? 0 }}
                    </summary>
                    <dl
                      class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1 text-tiny"
                    >
                      <template
                        v-for="([name, value], index) in shownHeaders"
                        :key="index"
                        ><dt class="break-all text-secondaryLight">
                          {{ name }}
                        </dt>
                        <dd class="break-all font-mono">
                          {{ value }}
                        </dd></template
                      >
                    </dl>
                  </details>
                  <details
                    v-if="pane === 'request' && query.length"
                    open
                    class="mb-4"
                  >
                    <summary
                      class="mb-2 cursor-pointer font-semibold text-secondaryLight"
                    >
                      {{ t("workbench_capture.parameters") }}
                    </summary>
                    <dl class="grid grid-cols-2 gap-2 text-tiny">
                      <template
                        v-for="([name, value], index) in query"
                        :key="index"
                        ><dt class="break-all">{{ name }}</dt>
                        <dd class="break-all font-mono">
                          {{ value }}
                        </dd></template
                      >
                    </dl>
                  </details>
                  <BodyViewer
                    :key="detail.id + pane"
                    :body="body"
                    :headers="shownHeaders"
                    @download="downloadBody"
                  />
                </template>
              </div>
            </template>
            <div
              v-else-if="detailError"
              class="p-3 ui-status-error"
              role="alert"
            >
              <p>{{ t("ui_detail.detail_failed") }}</p>
              <HoppButtonSecondary
                :label="t('action.retry')"
                outline
                @click="select(selectedID)"
              />
            </div>
            <p
              v-else-if="detailLoading"
              class="p-3 text-secondaryLight"
              role="status"
              aria-busy="true"
            >
              {{ t("state.loading") }}
            </p>
          </section>
        </div>
      </div>
      <div
        v-if="tool"
        class="absolute inset-0 z-30 flex justify-end bg-black/20"
        @click.self="tool = undefined"
      >
        <section
          ref="toolDialog"
          tabindex="-1"
          @keydown="trapDialogTab"
          role="dialog"
          aria-modal="true"
          :aria-label="toolLabels[tool]"
          class="flex h-full w-full max-w-lg flex-col border-l border-divider bg-primary shadow-xl"
        >
          <div
            class="flex shrink-0 flex-wrap items-center gap-2 border-b border-divider p-3"
          >
            <h2 class="font-semibold">
              {{ toolLabels[tool] }}
            </h2>
            <HoppButtonPrimary
              v-if="tool === 'sessions'"
              :label="t('workbench_capture.new_session')"
              :disabled="busy || !state?.archiveID"
              @click="newSession"
            />
            <HoppButtonSecondary
              class="ml-auto"
              :label="t('action.close')"
              @click="tool = undefined"
            />
          </div>
          <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <template v-if="tool === 'sessions'">
              <article
                v-for="item in saved"
                :key="item.id"
                class="rounded border border-divider p-3"
              >
                <p class="truncate font-semibold">
                  {{ item.name }}
                  <span v-if="item.active" class="text-accent">●</span>
                </p>
                <p class="mt-1 text-tiny text-secondaryLight">
                  {{ new Date(item.date).toLocaleString() }} · {{ item.count }}
                  {{ t("workbench_capture.requests_count") }} ·
                  {{ formatSize(item.bytes) }}
                </p>
                <p v-if="item.dropped" class="text-amber-600">
                  {{
                    t("workbench_capture.archive_incomplete", {
                      count: item.dropped,
                    })
                  }}
                </p>
                <div class="mt-2 flex gap-1">
                  <HoppButtonSecondary
                    :label="t('action.open')"
                    @click="openSaved(item)"
                  /><HoppButtonSecondary
                    :label="t('action.rename')"
                    :disabled="busy"
                    @click="openRename(item)"
                  /><HoppButtonSecondary
                    :label="t('action.delete')"
                    :disabled="item.active || busy"
                    @click="deleteCandidate = item"
                  />
                </div>
              </article>
            </template>
            <template v-else-if="tool === 'rules'">
              <RuleEditor
                v-model="rules"
                :busy="busy"
                :active="true"
                @apply="applyRules"
              />
            </template>
            <CaptureSettings
              v-else-if="tool === 'system' && state"
              :state="state"
              @updated="updateSettings"
            />
          </div>
        </section>
      </div>
      <HoppSmartModal
        v-if="renameCandidate"
        dialog
        :title="t('workbench_capture.session_name')"
        @close="renameCandidate = undefined"
        ><template #body
          ><input
            v-model="renameName"
            :aria-label="t('workbench_capture.session_name')"
            maxlength="120"
            class="w-full rounded border border-divider bg-primaryLight p-2"
            @keyup.enter="renameSaved" /></template
        ><template #footer
          ><HoppButtonPrimary
            :label="t('action.save')"
            :loading="busy"
            :aria-busy="busy"
            :disabled="busy || !renameName.trim()"
            @click="renameSaved" /><HoppButtonSecondary
            :label="t('action.cancel')"
            :disabled="busy"
            @click="renameCandidate = undefined" /></template
      ></HoppSmartModal>
      <HoppSmartConfirmModal
        :show="!!confirmReplay.length"
        :title="t('workbench_capture.replay_confirm')"
        @hide-modal="confirmReplay = []"
        @resolve="replay"
      />
      <HoppSmartConfirmModal
        :show="!!deleteCandidate"
        :title="t('workbench_capture.delete_archive')"
        @hide-modal="deleteCandidate = undefined"
        @resolve="deleteSaved"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import { trapDialogTab } from "~/helpers/ui-states"
import { getMethodLabelColor } from "~/helpers/rest/labelColoring"
import { useWorkbenchLiveQuery } from "~/composables/workbenchLive"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { invoke } from "@tauri-apps/api/core"
import { onClickOutside, useStorage, useVirtualList } from "@vueuse/core"
import { useRouter } from "vue-router"
import { useService } from "dioc/vue"
import { useI18n } from "~/composables/i18n"
import { useToast } from "~/composables/toast"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { useClipboard } from "~/composables/clipboard"
import { requestAsCurl } from "~/helpers/request-as-curl"
import {
  captureAPI as baseCaptureAPI,
  captureHar,
  captureToRequest,
  savedCaptures,
  newCaptureRule,
  type SavedCapture,
  type CaptureArchive,
  type CapturePage,
  type CaptureColumnFilter,
  type CaptureColumnFilters,
  type CaptureSummary,
  type CaptureEntry,
  type CaptureState,
  type CaptureRule,
  type CaptureFrame,
} from "~/helpers/workbench-capture"
import DetailToolbar from "~/components/capture/DetailToolbar.vue"
import ColumnMenu from "~/components/capture/ColumnMenu.vue"
import CaptureSettings from "~/components/capture/Settings.vue"
import BodyViewer from "~/components/capture/BodyViewer.vue"
import {
  captureBodyDownload,
  loadCaptureEntryBodies,
} from "~/helpers/workbench-capture-body"
import RuleEditor from "~/components/capture/RuleEditor.vue"
import BreakpointEditor from "~/components/capture/BreakpointEditor.vue"
import ResponseDiff from "~/components/capture/ResponseDiff.vue"
import IconClose from "~icons/lucide/x"
import IconDisplay from "~icons/lucide/sliders-horizontal"
import IconChevron from "~icons/lucide/chevron-down"
import ConsoleValue from "~/components/console/Value.vue"

const available = true
const captureAPI = <T,>(path = "", body?: object, signal?: AbortSignal) =>
  ["/certificate", "/archive_export"].includes(path)
    ? baseCaptureAPI<T>(path, body, signal)
    : baseCaptureAPI<T>(
        "/capture_api",
        {
          action: path.replace(/^\//, "") || "status",
          input: body ?? {},
        },
        signal
      )
const { copy: copyToClipboard } = useClipboard()
const t = useI18n(),
  toast = useToast(),
  router = useRouter(),
  workspaceTabs = useService(WorkspaceTabsService)
const initialLoading = ref(true),
  pageLoading = ref(false),
  pageError = ref(false)
const detailLoading = ref(false),
  detailError = ref(false)
const state = ref<CaptureState>(),
  detail = ref<CaptureEntry>(),
  selectedID = ref("")
const active = computed(() => !!state.value && state.value.state !== "stopped")
const toolTabs = ["sessions", "rules", "system"] as const,
  tool = ref<(typeof toolTabs)[number]>()
const toolLabels = computed(() => ({
  sessions: t("workbench_capture.sessions"),
  rules: t("workbench_capture.rules"),
  system: t("workbench_capture.system"),
}))
const toolDialog = ref<HTMLElement>()
let toolTrigger: HTMLElement | undefined
watch(tool, async (value, previous) => {
  if (value && !previous) toolTrigger = document.activeElement as HTMLElement
  await nextTick()
  if (value) toolDialog.value?.focus()
  else if (toolTrigger?.isConnected) toolTrigger.focus()
})
const saved = ref<CaptureArchive[]>([]),
  archiveID = ref(""),
  sessionName = ref(""),
  rules = ref<CaptureRule[]>([])
const rulesRevision = ref(0)
const archiveStatus = ref<{ dropped: number }>(),
  deleteCandidate = ref<CaptureArchive>()
const renameCandidate = ref<CaptureArchive>(),
  renameName = ref("")
const batchIDs = ref<string[]>([]),
  confirmReplay = ref<string[]>([]),
  comparison = ref<CaptureEntry>()
const selectedHosts = ref<string[]>([]),
  selectedClients = ref<string[]>([]),
  selectedApplications = ref<string[]>([])
const filter = ref(""),
  error = ref(""),
  busy = ref(false),
  bottom = useStorage("capture.detail-bottom", true)
const displayMenu = ref<HTMLDetailsElement>()
// 点击外部只收起设置，Esc 另外把焦点交还按钮，避免打断搜索输入。
onClickOutside(displayMenu, () => closeDisplay())
function closeDisplay(restoreFocus = false) {
  const menu = displayMenu.value
  if (!menu) return
  menu.open = false
  if (restoreFocus) menu.querySelector("summary")?.focus()
}
const columnOptions = [
  "application",
  "method",
  "url",
  "status",
  "protocol",
  "contentType",
  "elapsedMs",
  "responseSize",
  "client",
  "server",
] as const
type Column = (typeof columnOptions)[number]
const columnPreference = useStorage<Column[]>("capture.columns", [
  "application",
  "method",
  "url",
  "status",
  "elapsedMs",
  "responseSize",
])
const columns = computed({
  get: () =>
    columnPreference.value.filter((col) => columnOptions.includes(col)),
  set: (value: Column[]) => {
    columnPreference.value = value.length ? value : ["url"]
  },
})
const sortBy = ref<Column | "sequence" | "startedAt">("sequence"),
  sortDescending = ref(true),
  columnFilters = ref<CaptureColumnFilters>({}),
  offset = ref(0),
  pageBoundary = ref<number>(),
  pageSize = 200,
  page = ref<CapturePage>({ entries: [], total: 0, hosts: [], clients: [] })
const pane = ref<
    "request" | "response" | "frames" | "timing" | "compare" | "rule_trace"
  >("request"),
  frameFilter = ref(""),
  archiveFrames = ref<CaptureFrame[]>([]),
  frameOffset = ref(0),
  moreFrames = ref<number | null>(0)
const controller = new AbortController()
let filterTimer: ReturnType<typeof setTimeout> | undefined,
  revision = 0,
  selectionRevision = 0,
  pageRevision = 0,
  disposed = false
const command = <T,>(action: string, body: object = {}) =>
  captureAPI<T>(`/${action}`, body, controller.signal)
const storedSession = computed(
  () => archiveID.value || state.value?.archiveID || ""
)
const query = computed(() =>
  detail.value ? [...new URL(detail.value.url).searchParams] : []
)
const tabs = computed(
  () =>
    [
      "request",
      "response",
      "timing",
      ...(detail.value?.status === 101 ||
      detail.value?.frames?.length ||
      detail.value?.frameCount
        ? ["frames"]
        : []),
      "rule_trace",
      ...(comparison.value && comparison.value.id !== detail.value?.id
        ? ["compare"]
        : []),
    ] as (typeof pane.value)[]
)
const shownHeaders = computed(() =>
  pane.value === "request"
    ? detail.value?.requestHeaders
    : detail.value?.responseHeaders
)
const body = computed(() =>
  pane.value === "request"
    ? detail.value?.requestBody
    : detail.value?.responseBody
)
const draft = computed(() =>
  detail.value ? captureToRequest(detail.value) : undefined
)
// 实时和历史共用磁盘分页，显示缓存淘汰不再改变可访问的记录集合。
const entries = computed(() => page.value.entries)
// 筛选和排序由引擎对整个会话执行，再返回这一页。
const visibleEntries = entries
const total = computed(() => page.value.total)
const hosts = computed(() => page.value.hosts)
const applications = computed(() => page.value.applications ?? [])

const {
  list: virtualRows,
  containerProps,
  wrapperProps,
} = useVirtualList(visibleEntries, { itemHeight: 34, overscan: 12 })
const tableColumns = computed(
  () =>
    `24px 64px ${columns.value.map((col) => (col === "url" ? "minmax(200px,1fr)" : col === "contentType" ? "140px" : col === "application" || col === "client" || col === "server" ? "120px" : "80px")).join(" ")}`
)
const tableWidth = computed(
  () =>
    `${24 + 64 + columns.value.reduce((width, col) => width + (col === "url" ? 200 : col === "contentType" ? 140 : col === "application" || col === "client" || col === "server" ? 120 : 80), 0)}px`
)
const shownFrames = computed(() =>
  (detail.value?.frames ?? archiveFrames.value).filter(
    (frame) =>
      !frameFilter.value ||
      frame.text?.toLowerCase().includes(frameFilter.value.toLowerCase())
  )
)
const timingRows = computed(() => {
  const values = Object.entries(detail.value?.timings ?? {}).filter(
    (pair): pair is [string, number] =>
      typeof pair[1] === "number" && pair[1] >= 0
  )
  let cumulative = 0
  const rows = values.map(([name, value]) => {
    const left =
      detail.value?.timingOffsets?.[
        name as keyof NonNullable<CaptureEntry["timingOffsets"]>
      ] ?? cumulative
    cumulative += value
    return { name, value, left }
  })
  const total = Math.max(1, ...rows.map((row) => row.left + row.value))
  return rows.map((row) => ({
    ...row,
    width: (100 * row.value) / total,
    left: (100 * row.left) / total,
  }))
})

const filterCount = computed(
  () =>
    Object.keys(columnFilters.value).length +
    Number(!!selectedApplications.value.length) +
    Number(!!selectedHosts.value.length) +
    Number(!!selectedClients.value.length) +
    Number(!!filter.value)
)
function clearFilters() {
  columnFilters.value = {}
  filter.value = ""
  selectedApplications.value = []
  selectedHosts.value = []
  selectedClients.value = []
}
function setColumnFilter(col: Column, value: CaptureColumnFilter | undefined) {
  if (col === "application") {
    selectedApplications.value = Array.isArray(value) ? value : []
    return
  }
  const next = { ...columnFilters.value }
  if (value === undefined) delete next[col]
  else next[col] = value
  columnFilters.value = next
}
function setSort(col: Column | "sequence", descending: boolean | null) {
  sortBy.value = descending === null ? "sequence" : col
  sortDescending.value = descending ?? true
}
function changePage(delta: number) {
  // 浏览旧页时固定索引边界，新到请求不会把正在查看的记录挤到别页。
  if (offset.value === 0 && delta > 0) pageBoundary.value = page.value.boundary
  offset.value = Math.max(0, offset.value + delta * pageSize)
  if (offset.value === 0) pageBoundary.value = undefined
  void loadPage()
}
function formatSize(size = 0) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / 1024 / 1024).toFixed(1)} MiB`
}
function columnLabel(col: string) {
  return t(`workbench_capture.col_${col}`)
}
function cellTitle(entry: CaptureSummary, col: Column) {
  if (col === "application")
    return entry.application
      ? `${entry.application}${entry.processId ? ` · PID ${entry.processId}` : ""}`
      : t("workbench_capture.application_help")
  return String(cell(entry, col))
}
function cell(entry: CaptureSummary, col: Column) {
  if (col === "application")
    return entry.application || t("workbench_capture.application_unavailable")
  return col === "status" && entry.paused
    ? t("workbench_capture.paused")
    : col === "responseSize"
      ? formatSize(entry.responseSize)
      : col === "elapsedMs"
        ? entry.elapsedMs === undefined
          ? "…"
          : `${entry.elapsedMs} ms`
        : (entry[col] ?? "—")
}
function stepSelection(delta: number) {
  const index = visibleEntries.value.findIndex(
    (entry) => entry.id === selectedID.value
  )
  const next =
    visibleEntries.value[
      Math.max(0, Math.min(visibleEntries.value.length - 1, index + delta))
    ]
  if (next) {
    select(next.id)
    containerProps.ref.value?.scrollTo({
      top: Math.max(0, (index + delta) * 34 - 100),
    })
  }
}
async function withControl(callback: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    await callback()
  } catch (e) {
    if (!disposed) error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function loadPage() {
  const id = storedSession.value
  if (!id) {
    ++pageRevision
    pageLoading.value = false
    pageError.value = false
    page.value = { entries: [], total: 0, hosts: [], clients: [] }
    return
  }
  const current = ++pageRevision
  pageLoading.value = true
  pageError.value = false
  try {
    const result = await command<CapturePage>("archive_page", {
      session: id,
      offset: offset.value,
      before: pageBoundary.value,
      limit: pageSize,
      search: filter.value,
      hosts: selectedHosts.value,
      clients: selectedClients.value,
      applications: selectedApplications.value,
      filters: columnFilters.value,
      sort: { field: sortBy.value, descending: sortDescending.value },
    })
    if (current === pageRevision && id === storedSession.value)
      page.value = result
  } catch {
    if (!disposed && current === pageRevision && id === storedSession.value)
      pageError.value = true
  } finally {
    if (current === pageRevision) pageLoading.value = false
  }
}
watch(
  [
    filter,
    selectedHosts,
    selectedClients,
    selectedApplications,
    columnFilters,
    sortBy,
    sortDescending,
  ],
  () => {
    offset.value = 0
    pageBoundary.value = undefined
    clearTimeout(filterTimer)
    if (storedSession.value)
      filterTimer = setTimeout(() => void loadPage(), 180)
  }
)
async function readConfig() {
  const config = await command<{
    rules: CaptureRule[]
    revision?: number
    archive?: { dropped: number }
  }>("session_status")
  rulesRevision.value = config.revision ?? 0
  rules.value = config.rules.map((rule) => ({ ...newCaptureRule(), ...rule }))
  archiveStatus.value = config.archive
}
async function refresh() {
  const current = ++revision
  const latest = await captureAPI<CaptureState>(
    "",
    undefined,
    controller.signal
  )
  if (current !== revision || disposed) return
  const started =
    latest.state === "running" &&
    (state.value?.state !== "running" ||
      latest.archiveID !== state.value?.archiveID)
  const changedSession = latest.archiveID !== state.value?.archiveID
  state.value = latest
  if (changedSession && !archiveID.value) {
    page.value = { entries: [], total: 0, hosts: [], clients: [] }
    resetView()
    error.value = ""
  }
  if (latest.archiveStatus) archiveStatus.value = latest.archiveStatus
  if (!state.value || started || !rulesRevision.value) await readConfig()
  if (latest.state === "running") {
    const result = await command<{
      archive?: { dropped: number }
      replayError?: string
    }>("session_status")
    archiveStatus.value = result.archive
    if (result.replayError) error.value = result.replayError
  }
  batchIDs.value = batchIDs.value.filter(
    (id) =>
      latest.state === "running" &&
      page.value.entries.some((entry) => entry.id === id && entry.replayable)
  )
  if (!archiveID.value) await loadPage()
  if (!archiveID.value && selectedID.value) {
    const id = selectedID.value
    const entry = await readEntry(id).catch(() => undefined)
    if (id === selectedID.value && current === revision && entry) {
      const previousFrameCount = detail.value?.frameCount
      detail.value = entry
      if (pane.value === "frames" && entry.frameCount !== previousFrameCount)
        await loadFrames()
    }
  }
}
async function refreshLive() {
  if (!state.value) initialLoading.value = true
  error.value = ""
  try {
    if (!busy.value) {
      await refresh()
      if (tool.value === "sessions") await listSaved()
    }
  } catch (e) {
    if (!disposed) error.value = (e as Error).message
  } finally {
    initialLoading.value = false
  }
}
async function updateSettings(next: CaptureState) {
  ++revision
  state.value = next
  rulesRevision.value = 0
  await refresh()
}
async function setRecording(recording: boolean) {
  await withControl(async () => {
    // 以控制命令返回的服务端状态更新按钮，避免等待下一轮轮询才显示暂停入口。
    ++revision
    state.value = await command<CaptureState>("record", { recording })
    await refresh()
  })
}
async function newSession() {
  await withControl(async () => {
    await command("new_session")
    showLive()
    await refresh()
    await listSaved()
  })
}
function resetView() {
  comparison.value = undefined
  batchIDs.value = []
  filter.value = ""
  selectedHosts.value = []
  selectedClients.value = []
  selectedApplications.value = []
  columnFilters.value = {}
  offset.value = 0
  pageBoundary.value = undefined
  select("")
}
function showLive() {
  archiveID.value = ""
  ++pageRevision
  page.value = { entries: [], total: 0, hosts: [], clients: [] }
  resetView()
  void loadPage()
}
async function readEntry(id: string): Promise<CaptureEntry> {
  const entry = await command<CaptureEntry>("archive_entry", {
    session:
      page.value.entries.find((entry) => entry.id === id)?.sessionId ??
      storedSession.value,
    id,
    live: !archiveID.value,
  })
  return loadCaptureEntryBodies(
    entry,
    (side, offset) =>
      command("archive_body", {
        session: entry.sessionId ?? storedSession.value,
        id,
        side,
        offset,
      }),
    detail.value,
    () => !disposed && selectedID.value === id
  )
}
async function select(id: string) {
  const current = ++selectionRevision
  selectedID.value = id
  detail.value = undefined
  detailError.value = false
  detailLoading.value = !!id
  pane.value = "request"
  frameFilter.value = ""
  archiveFrames.value = []
  frameOffset.value = 0
  moreFrames.value = 0
  if (!id) return
  try {
    const entry = await readEntry(id)
    if (current !== selectionRevision) return
    detail.value = entry
    if (!entry.frames?.length && entry.frameCount) await loadFrames()
  } catch {
    if (!disposed && current === selectionRevision) detailError.value = true
  } finally {
    if (current === selectionRevision) detailLoading.value = false
  }
}
async function openRequest() {
  if (!draft.value) return
  workspaceTabs.createNewTab({
    type: "request",
    request: draft.value,
    isDirty: true,
  })
  await router.push("/")
}
const copy = copyToClipboard
async function copyCurl() {
  if (draft.value) await copy(await requestAsCurl(draft.value))
}
function download(filename: string, contents: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function downloadHar() {
  if (detail.value)
    download(
      "apirequest.har",
      JSON.stringify(captureHar(detail.value, true), null, 2),
      "application/json"
    )
}
async function listSaved() {
  saved.value = await command<CaptureArchive[]>("archive_list")
}
async function openSaved(item: CaptureArchive) {
  archiveID.value = item.id
  sessionName.value = item.name
  resetView()
  await loadPage()
  tool.value = undefined
}
function openRename(item: CaptureArchive) {
  renameCandidate.value = item
  renameName.value = item.name
}
async function renameSaved() {
  const item = renameCandidate.value
  if (!item || !renameName.value.trim()) return
  await withControl(async () => {
    await command("archive_rename", {
      session: item.id,
      name: renameName.value,
    })
    if (archiveID.value === item.id) sessionName.value = renameName.value.trim()
    renameCandidate.value = undefined
    await listSaved()
  })
}

async function deleteSaved() {
  const item = deleteCandidate.value
  deleteCandidate.value = undefined
  if (!item) return
  await withControl(async () => {
    await command("archive_delete", { session: item.id })
    if (archiveID.value === item.id) showLive()
    await listSaved()
  })
}
async function persistImport(name: string, entries: CaptureEntry[]) {
  const session = await command<CaptureArchive>("archive_create", { name })
  try {
    for (const entry of entries)
      await command("archive_import", { session: session.id, entry })
  } catch (e) {
    await command("archive_delete", { session: session.id })
    throw e
  }
  return session
}
async function migrateSaved() {
  const items = await savedCaptures<SavedCapture[]>("readonly", (store) =>
    store.getAll()
  )
  for (const item of items) {
    await persistImport(item.name, item.entries)
    await savedCaptures("readwrite", (store) => store.delete(item.id))
  }
}
async function toggleTool(tab: (typeof toolTabs)[number]) {
  tool.value = tool.value === tab ? undefined : tab
  if (tool.value === "sessions")
    await withControl(async () => {
      await migrateSaved()
      await listSaved()
    })
  if (tool.value === "rules") await withControl(readConfig)
}
async function applyRules() {
  await withControl(async () => {
    await command("configure", {
      rules: rules.value,
      revision: rulesRevision.value,
    })
    await readConfig()
    toast.success(t("workbench_capture.rules_applied"))
  })
}
async function resume(patch: object) {
  await withControl(async () => {
    await command("resume", { id: selectedID.value, patch })
    await refresh()
  })
}
async function replay() {
  const ids = confirmReplay.value
  confirmReplay.value = []
  await withControl(async () => {
    await command("replay", { session: storedSession.value, ids })
    batchIDs.value = []
    await refresh()
  })
}
function markComparison() {
  comparison.value = detail.value
  if (pane.value === "compare") pane.value = "response"
}
function clearComparison() {
  comparison.value = undefined
  if (pane.value === "compare") pane.value = "response"
}
function comparisonText(entry: CaptureEntry) {
  let content = entry.responseBody?.text
  try {
    content = JSON.parse(content ?? "")
  } catch {}
  return JSON.stringify(
    { status: entry.status, headers: entry.responseHeaders, body: content },
    null,
    2
  )
}
async function loadFrames(offset = frameOffset.value) {
  if (!storedSession.value || !selectedID.value) return
  const id = selectedID.value
  const result = await command<{
    entries: CaptureFrame[]
    next: number | null
  }>("archive_frames", {
    session:
      page.value.entries.find((entry) => entry.id === id)?.sessionId ??
      storedSession.value,
    id,
    offset,
  })
  if (id === selectedID.value) {
    archiveFrames.value = result.entries
    frameOffset.value = offset
    moreFrames.value = result.next
  }
}
async function downloadBody() {
  await withControl(async () => {
    if (!detail.value) return
    const side = pane.value === "request" ? "requestBody" : "responseBody",
      session = detail.value.sessionId ?? storedSession.value,
      id = detail.value.id,
      { filename, type } = captureBodyDownload(detail.value, side)
    if (session) {
      if (import.meta.env.VITE_WORKBENCH_NATIVE) {
        const destination = await invoke<string | null>("plugin:dialog|save", {
          options: { defaultPath: filename },
        })
        if (destination)
          await command("archive_export", { session, id, side, destination })
        return
      }
      const response = await fetch("/__workbench_capture/archive_download", {
        method: "POST",
        headers: {
          "X-Workbench-Capture": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session, id, side }),
        signal: controller.signal,
      })
      if (!response.ok) throw Error("entry_unavailable")
      download(filename, await response.blob(), type)
      return
    }
    if (body.value?.base64) {
      const bytes = Uint8Array.from(atob(body.value.base64), (ch) =>
        ch.charCodeAt(0)
      )
      download(filename, bytes, type)
    } else download(filename, body.value?.text ?? "", type)
  })
}
useWorkbenchLiveQuery(["capture"], refreshLive, { blocked: busy })
onBeforeUnmount(() => {
  disposed = true
  controller.abort()
  clearTimeout(filterTimer)
  revision++
  selectionRevision++
  pageRevision++
})
</script>
<style scoped>
/* 同组多选取并集，空选择表示不筛选；窄窗口复用这一组控件，避免双份入口。 */
.capture-filter-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.capture-split {
  flex-direction: row;
}
.capture-rows {
  height: calc(100% - 32px);
  overflow-y: auto;
  overflow-anchor: none;
}
.capture-content.flex-col > .capture-list {
  flex: 1 1 48%;
  min-height: 140px;
}
.capture-content.flex-col > .capture-detail {
  flex: 1 1 52%;
}
.capture-table-head {
  font-size: 11px;
}
@media (max-width: 1100px) {
  .capture-main {
    flex-direction: column;
  }
  .capture-sidebar {
    display: flex;
    flex-wrap: wrap;
    width: auto;
    max-height: 9rem;
    border-right: 0;
    border-bottom-width: 1px;
  }
  .capture-filter-group {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .capture-filter-options {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .capture-filter-option {
    max-width: 100%;
  }
  .capture-split {
    flex-direction: column;
  }
}
@media (max-width: 767px) {
  .capture-list.capture-mobile-hidden,
  .capture-sidebar.capture-mobile-hidden {
    display: none;
  }
  .capture-detail {
    border-left: 0;
  }
  .capture-content.flex-col > .capture-detail {
    flex: 1;
  }
  .capture-content.flex-col > .capture-list {
    flex: 1;
  }
}
</style>
