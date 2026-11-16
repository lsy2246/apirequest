<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <button
          v-if="scopeServer"
          type="button"
          class="icon-button"
          :title="t('mock_list.back')"
          :aria-label="t('mock_list.back')"
          @click="scopeID = null"
        >
          <IconArrowLeft />
        </button>
        <div class="min-w-0">
          <h2 class="truncate font-semibold text-secondaryDark">
            {{ scopeServer?.name || t("mock_list.all") }}
          </h2>
          <p class="mt-1 text-tiny text-secondaryLight">
            {{
              scopeServer
                ? t("mock_list.collection_count", {
                    active: activeRules(scopeServer),
                    total: scopeServer.rules.length,
                  })
                : t("mock_list.overview", {
                    singles: servers.filter((s) => s.kind === "single").length,
                    collections: servers.filter((s) => s.kind === "collection")
                      .length,
                    active: servers.filter((s) =>
                      s.kind === "collection" ? s.isActive : activeRules(s) > 0
                    ).length,
                  })
            }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <HoppButtonSecondary
          v-if="scopeServer"
          :label="t('mock_tools.settings')"
          @click="openTools(scopeServer, 'settings')"
        />
        <HoppButtonPrimary
          :icon="IconPlus"
          :label="t(scopeServer ? 'mock_list.new_single' : 'action.new')"
          :disabled="busy"
          @click="scopeServer ? addRule() : (showCreate = true)"
        />
      </div>
    </div>

    <div
      v-if="scopeServer"
      class="flex flex-wrap items-center gap-3 rounded-lg border border-divider bg-primary p-3"
    >
      <code class="min-w-0 flex-1 break-all text-tiny text-secondaryLight">{{
        scopeServer.url
      }}</code>
      <button
        type="button"
        class="icon-button"
        :title="t('action.copy')"
        :aria-label="t('action.copy')"
        @click="copyURL(scopeServer)"
      >
        <IconCopy />
      </button>
      <span
        class="status"
        :class="scopeServer.isActive ? 'status-active' : 'status-disabled'"
        >{{
          t(scopeServer.isActive ? "mock_list.active" : "mock_list.stopped")
        }}</span
      >
      <WorkbenchToggle
        :on="scopeServer.isActive"
        :title="t('mock_list.collection_switch')"
        :aria-label="t('mock_list.collection_switch')"
        :disabled="busy"
        @change="toggleServer(scopeServer)"
      />
    </div>

    <p
      v-if="error && rows.length"
      role="alert"
      class="rounded border border-red-300 p-3 text-red-600"
    >
      {{ error }}
    </p>
    <div
      v-if="movedURL"
      role="status"
      class="flex items-center gap-3 rounded-lg border border-divider bg-primary p-3"
    >
      <span class="text-tiny text-secondaryLight">{{
        t("mock_list.moved")
      }}</span
      ><code class="min-w-0 flex-1 break-all text-tiny">{{ movedURL }}</code
      ><button
        type="button"
        class="icon-button"
        :title="t('action.copy')"
        :aria-label="t('action.copy')"
        @click="copyToClipboard(movedURL)"
      >
        <IconCopy />
      </button>
    </div>
    <div class="flex flex-wrap gap-2">
      <input
        v-model="search"
        type="search"
        class="mock-field min-w-36 flex-1"
        :placeholder="t('mock_list.search')"
        :title="t('action.search')"
        :aria-label="t('action.search')"
      />
      <RuleSelect
        v-if="!scopeServer"
        v-model="typeFilter"
        :options="typeOptions"
        :label="t('mock_list.type')"
        class="min-w-28"
      />
      <RuleSelect
        v-model="statusFilter"
        :options="statusOptions"
        :label="t('mock_list.status')"
        class="min-w-28"
      />
    </div>

    <section
      class="overflow-hidden rounded-lg border border-divider bg-primary"
    >
      <div
        class="mock-row list-heading text-tiny text-secondaryLight"
        aria-hidden="true"
      >
        <span>{{ t("mock_list.name") }}</span
        ><span>{{ t("mock_list.status") }}</span
        ><span>{{ t("mock_list.response") }}</span
        ><span class="text-right">{{ t("mock_list.actions") }}</span>
      </div>
      <div class="max-h-[60vh] divide-y divide-divider overflow-auto">
        <article
          v-for="row in rows"
          :key="row.id"
          class="mock-row"
          :data-mock-id="row.id"
        >
          <button
            type="button"
            class="row-name flex min-w-0 items-start gap-3 text-left"
            @click="openRow(row)"
          >
            <span class="mt-0.5 rounded bg-primaryLight p-2 text-accent"
              ><IconLayers v-if="row.kind === 'collection'" /><IconRoute v-else
            /></span>
            <span class="min-w-0 flex-1">
              <strong class="block truncate text-secondaryDark">{{
                row.name
              }}</strong>
              <span
                v-if="row.rule"
                class="mt-1 flex min-w-0 items-center gap-2 text-tiny"
                ><b class="text-accent">{{ row.rule.method }}</b
                ><code class="truncate text-secondaryLight">{{
                  row.rule.path
                }}</code></span
              >
              <span v-else class="mt-1 block text-tiny text-secondaryLight"
                >{{ t("mock_list.collection") }} ·
                {{
                  t("mock_list.collection_count", {
                    active: activeRules(row.server),
                    total: row.server.rules.length,
                  })
                }}</span
              >
            </span>
          </button>
          <div class="row-status">
            <span class="status" :class="'status-' + row.status"
              ><span class="h-1.5 w-1.5 rounded-full bg-current" />{{
                t(
                  row.status === "expired"
                    ? "mock_tools.expired"
                    : "mock_list." + row.status
                )
              }}</span
            >
          </div>
          <div class="row-response min-w-0 text-tiny text-secondaryLight">
            <template v-if="row.rule"
              ><p class="truncate">{{ responseSummary(row.rule) }}</p>
              <p class="mt-1">
                {{ t("mock_rule.hits", { count: row.rule.hits })
                }}<span
                  v-if="row.rule.steps.length > 1 && nextMockStep(row.rule)"
                >
                  ·
                  {{
                    t("mock_list.step_progress", {
                      current: nextStepNumber(row.rule),
                      total: row.rule.steps.length,
                    })
                  }}</span
                >
              </p></template
            >
            <span v-else>{{ t("mock_list.collection_summary") }}</span>
          </div>
          <div class="row-actions flex items-center justify-end gap-1">
            <WorkbenchToggle
              class="mr-2"
              :on="
                row.kind === 'collection'
                  ? row.server.isActive
                  : !!row.rule?.enabled && row.server.isActive
              "
              :title="t('mock_list.toggle', { name: row.name })"
              :aria-label="t('mock_list.toggle', { name: row.name })"
              :disabled="busy || (!!scopeServer && !row.server.isActive)"
              @change="toggleRow(row)"
            />
            <button
              v-if="row.rule"
              type="button"
              class="icon-button"
              :title="t('mock_list.copy_url')"
              :aria-label="t('mock_list.copy_url')"
              @click="copyURL(row.server, row.rule)"
            >
              <IconCopy />
            </button>
            <button
              v-if="row.rule && row.rule.hits"
              type="button"
              class="icon-button"
              :title="t('mock_rule.reset')"
              :aria-label="t('mock_rule.reset')"
              :disabled="busy"
              @click="resetRow(row)"
            >
              <IconReset />
            </button>
            <button
              v-if="!scopeServer"
              type="button"
              class="icon-button"
              :title="t('mock_tools.settings')"
              :aria-label="t('mock_tools.settings')"
              :disabled="busy"
              @click="openTools(row.server, 'settings')"
            >
              <IconSettings />
            </button>
            <button
              type="button"
              class="icon-button"
              :title="t('mock_rule.logs')"
              :aria-label="t('mock_rule.logs')"
              :disabled="busy"
              @click="openLogs(row)"
            >
              <IconLogs />
            </button>
            <button
              v-if="row.rule"
              type="button"
              class="icon-button"
              :title="t('mock_list.move')"
              :aria-label="t('mock_list.move')"
              :disabled="busy"
              @click="startMove(row)"
            >
              <IconMove />
            </button>
            <button
              type="button"
              class="icon-button"
              :title="t('action.delete')"
              :aria-label="t('action.delete')"
              :disabled="busy"
              @click="
                requestDelete(
                  row.server,
                  scopeServer ? row.rule?.id : undefined
                )
              "
            >
              <IconTrash />
            </button>
          </div>
        </article>
        <WorkbenchState
          v-if="busy && !rows.length"
          kind="loading"
          :title="t('mock_list.loading')"
        />
        <WorkbenchState
          v-else-if="error && !rows.length"
          kind="error"
          :title="t('workbench.load_failed')"
          :description="t('workbench.load_failed_description')"
          :detail="error"
        >
          <HoppButtonSecondary
            :label="t('action.retry')"
            outline
            @click="refresh"
          />
        </WorkbenchState>
        <WorkbenchState
          v-else-if="!rows.length"
          :title="t('mock_list.empty')"
          :icon="IconRoute"
        />
      </div>
    </section>

    <HoppSmartModal
      v-if="showCreate"
      dialog
      :title="t('action.new')"
      @close="showCreate = false"
    >
      <template #body
        ><form
          id="mock-create"
          class="space-y-5"
          @submit.prevent="createServer"
        >
          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="kind in ['single', 'collection'] as const"
              :key="kind"
              type="button"
              class="rounded-lg border p-4 text-left"
              :class="
                newKind === kind
                  ? 'border-accent bg-primaryLight text-accent'
                  : 'border-divider'
              "
              :aria-pressed="newKind === kind"
              @click="newKind = kind"
            >
              <component
                :is="kind === 'single' ? IconRoute : IconLayers"
                class="mb-2"
              /><strong class="block">{{ t("mock_list." + kind) }}</strong
              ><span class="mt-1 block text-tiny text-secondaryLight">{{
                t("mock_list." + kind + "_hint")
              }}</span>
            </button>
          </div>
          <label class="block"
            >{{ t("mock_list.name")
            }}<input
              v-model.trim="name"
              required
              maxlength="100"
              class="mock-field mt-2 w-full"
              :placeholder="t('mock_rule.service_placeholder')"
          /></label></form
      ></template>
      <template #footer
        ><HoppButtonPrimary
          type="submit"
          form="mock-create"
          :label="t(newKind === 'single' ? 'action.proceed' : 'action.save')"
          :loading="busy"
          :disabled="busy || !name" /><HoppButtonSecondary
          type="button"
          :label="t('action.cancel')"
          @click="showCreate = false"
      /></template>
    </HoppSmartModal>

    <HoppSmartModal
      v-if="editorOpen"
      dialog
      :title="rule?.name || t('mock_rule.rule')"
      @close="closeEditor"
    >
      <template #body>
        <p v-if="error" role="alert" class="mb-3 text-red-600">{{ error }}</p>
        <form
          v-if="rule"
          id="mock-rule-editor"
          class="mock-form min-w-0"
          @submit.prevent="save"
        >
          <fieldset :disabled="busy" class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold">{{ t("mock_rule.rule") }}</h2>
              <div
                v-if="selected?.kind === 'collection'"
                class="flex flex-wrap gap-1"
              >
                <button
                  type="button"
                  class="small"
                  :disabled="ruleIndex === 0"
                  :aria-label="
                    t('settings.navigation_move_up', {
                      name: t('mock_rule.rule'),
                    })
                  "
                  @click="move(drafts, ruleIndex, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="small"
                  :disabled="ruleIndex === drafts.length - 1"
                  :aria-label="
                    t('settings.navigation_move_down', {
                      name: t('mock_rule.rule'),
                    })
                  "
                  @click="move(drafts, ruleIndex, 1)"
                >
                  ↓
                </button>
                <HoppButtonSecondary
                  type="button"
                  :label="t('action.delete')"
                  @click="requestDelete(selected!, rule!.id)"
                />
              </div>
            </div>
            <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
              <label
                >{{ t("request.method") }}
                <RuleSelect
                  v-model="rule.method"
                  :options="methodOptions"
                  :label="t('request.method')"
                  class="mt-1"
                />
              </label>
              <label
                >{{ t("request.path") }}
                <input
                  v-model.trim="rule.path"
                  required
                  maxlength="1000"
                  class="mock-field mt-1 w-full"
                  placeholder="/orders/:id"
                />
              </label>
            </div>

            <label class="block"
              >{{ t("environment.name") }}
              <input
                v-model.trim="rule.name"
                maxlength="100"
                class="mock-field mt-1 w-full"
              />
            </label>
            <WorkbenchToggle
              v-model="rule.enabled"
              class="flex items-center gap-2"
              >{{ t("state.enabled") }}</WorkbenchToggle
            >
            <details>
              <summary class="cursor-pointer font-medium">
                {{ t("mock_rule.conditions") }}
                <span v-if="rule.conditions.length"
                  >· {{ rule.conditions.length }}</span
                >
              </summary>
              <div class="mt-3 space-y-2">
                <div
                  v-for="(condition, index) in rule.conditions"
                  :key="index"
                  class="flex flex-wrap items-center gap-2"
                >
                  <RuleSelect
                    v-model="condition.source"
                    :options="conditionOptions"
                    :label="t('mock_rule.conditions')"
                    class="min-w-28"
                  />
                  <input
                    v-model.trim="condition.key"
                    required
                    :title="t('documentation.key')"
                    :aria-label="t('documentation.key')"
                    class="mock-field min-w-28 flex-1"
                    :placeholder="
                      condition.operator === 'jsonpath'
                        ? '$.orders[?(@.total > 100)].id'
                        : condition.operator === 'xpath'
                          ? '/orders/order/@id'
                          : condition.source === 'body'
                            ? 'order.sku'
                            : 'X-Mock-Case'
                    "
                  />
                  <RuleSelect
                    :model-value="condition.operator || 'equals'"
                    :options="operatorOptions"
                    :label="t('mock_tools.operator')"
                    @update:model-value="setOperator(condition, $event)"
                  />
                  <input
                    v-if="
                      !['exists', 'absent', 'json_schema'].includes(
                        condition.operator || 'equals'
                      )
                    "
                    v-model="condition.value"
                    :title="t('documentation.value')"
                    :aria-label="t('documentation.value')"
                    class="mock-field min-w-24 flex-1"
                    placeholder="rate-limit"
                  />
                  <textarea
                    v-if="condition.operator === 'json_schema'"
                    v-model="condition.value"
                    :aria-label="t('mock_tools.json_schema')"
                    rows="5"
                    class="mock-field w-full font-mono"
                  />
                  <JsonMapField
                    v-if="condition.operator === 'xpath'"
                    v-model="condition.namespaces"
                    :label="t('mock_tools.namespaces')"
                    class="w-full"
                  />
                  <p
                    v-if="
                      ['json_schema', 'jsonpath', 'xpath'].includes(
                        condition.operator || ''
                      )
                    "
                    class="w-full text-tiny text-secondaryLight"
                  >
                    {{ t("mock_tools.structure_hint") }}
                  </p>
                  <HoppButtonSecondary
                    type="button"
                    :label="t('action.delete')"
                    @click="rule.conditions.splice(index, 1)"
                  />
                </div>
                <HoppButtonSecondary
                  type="button"
                  outline
                  :label="t('mock_rule.add_condition')"
                  :disabled="rule.conditions.length >= 20"
                  @click="
                    rule.conditions.push({
                      source: 'header',
                      key: '',
                      value: '',
                    })
                  "
                />
              </div>
            </details>

            <details>
              <summary class="cursor-pointer font-medium">
                {{ t("mock_tools.advanced") }}
              </summary>
              <div class="mt-3 space-y-3">
                <label class="block"
                  >{{ t("mock_tools.secure")
                  }}<RuleSelect
                    :model-value="
                      rule.secure == null
                        ? 'any'
                        : rule.secure
                          ? 'https'
                          : 'http'
                    "
                    :options="protocolOptions"
                    :label="t('mock_tools.secure')"
                    class="mt-1 w-full"
                    @update:model-value="
                      rule.secure = $event === 'any' ? null : $event === 'https'
                    "
                /></label>
                <label class="block"
                  >{{ t("mock_tools.path_mode")
                  }}<RuleSelect
                    :model-value="rule.pathMode || 'template'"
                    :options="pathModeOptions"
                    :label="t('mock_tools.path_mode')"
                    class="mt-1 w-full"
                    @update:model-value="rule.pathMode = $event"
                /></label>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label
                    >{{ t("mock_tools.priority")
                    }}<input
                      v-model.number="rule.priority"
                      type="number"
                      min="-100000"
                      max="100000"
                      class="mock-field mt-1 w-full" /></label
                  ><label
                    >{{ t("mock_tools.expires")
                    }}<input
                      type="datetime-local"
                      :value="localDate(rule.expiresAt)"
                      class="mock-field mt-1 w-full"
                      @change="
                        rule.expiresAt = ($event.target as HTMLInputElement)
                          .value
                          ? new Date(
                              ($event.target as HTMLInputElement).value
                            ).toISOString()
                          : null
                      "
                  /></label>
                </div>
                <template v-if="rule.scenario"
                  ><label class="block"
                    >{{ t("mock_tools.scenario")
                    }}<input
                      v-model="rule.scenario.name"
                      maxlength="100"
                      class="mock-field mt-1 w-full"
                  /></label>
                  <div v-if="rule.scenario.name" class="grid grid-cols-2 gap-3">
                    <label
                      >{{ t("mock_tools.required_state")
                      }}<input
                        v-model="rule.scenario.requiredState"
                        maxlength="100"
                        class="mock-field mt-1 w-full" /></label
                    ><label
                      >{{ t("mock_tools.next_state")
                      }}<input
                        v-model="rule.scenario.nextState"
                        maxlength="100"
                        class="mock-field mt-1 w-full"
                    /></label></div
                ></template>
                <p class="text-tiny text-secondaryLight">
                  {{ t("mock_tools.scenario_hint") }}
                </p>
              </div>
            </details>

            <div class="space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-semibold">
                  {{
                    t(
                      rule.steps.length > 1
                        ? "mock_rule.steps"
                        : "mock_rule.response"
                    )
                  }}
                </h3>
                <HoppButtonSecondary
                  type="button"
                  outline
                  :label="t('mock_rule.add_step')"
                  :disabled="rule.steps.length >= 30"
                  @click="rule.steps.push(newStep())"
                />
              </div>
              <div
                v-for="(step, index) in rule.steps"
                :key="step.key"
                class="space-y-2 rounded border border-divider p-3"
              >
                <div
                  v-if="rule.steps.length > 1"
                  class="flex flex-wrap items-center justify-between gap-2"
                >
                  <strong>{{
                    t("mock_rule.step", { number: index + 1 })
                  }}</strong>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="small"
                      :disabled="index === 0"
                      :aria-label="
                        t('settings.navigation_move_up', {
                          name: t('mock_rule.step', { number: index + 1 }),
                        })
                      "
                      @click="move(rule.steps, index, -1)"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="small"
                      :disabled="index === rule.steps.length - 1"
                      :aria-label="
                        t('settings.navigation_move_down', {
                          name: t('mock_rule.step', { number: index + 1 }),
                        })
                      "
                      @click="move(rule.steps, index, 1)"
                    >
                      ↓
                    </button>
                    <HoppButtonSecondary
                      type="button"
                      :label="t('action.delete')"
                      @click="rule.steps.splice(index, 1)"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <label
                    >{{ t("mock_rule.response_type") }}
                    <RuleSelect
                      :model-value="step.action"
                      :options="responseOptions"
                      :label="t('mock_rule.response_type')"
                      class="mt-1"
                      @update:model-value="seedStream(step, $event)"
                    />
                  </label>
                  <label v-if="step.action === 'http' || step.action === 'file'"
                    >HTTP {{ t("response.status") }}
                    <input
                      v-model.number="step.statusCode"
                      type="number"
                      min="200"
                      max="599"
                      required
                      class="mock-field mt-1 w-full"
                    />
                  </label>
                  <label
                    >{{ t("mock_server.delay_ms") }}
                    <input
                      v-model.number="step.delayMs"
                      type="number"
                      min="0"
                      max="60000"
                      placeholder="0"
                      class="mock-field mt-1 w-full"
                    />
                  </label>
                  <label
                    v-if="
                      rule.steps.length > 1 || rule.exhausted !== 'repeat_last'
                    "
                    >{{ t("mock_rule.times") }}
                    <input
                      v-model.number="step.times"
                      type="number"
                      min="1"
                      max="10000"
                      required
                      class="mock-field mt-1 w-full"
                    />
                  </label>
                  <label
                    v-if="step.action === 'sse' || step.action === 'websocket'"
                    >{{ t("mock_rule.event_interval") }}
                    <input
                      v-model.number="step.intervalMs"
                      type="number"
                      min="0"
                      max="60000"
                      required
                      class="mock-field mt-1 w-full"
                    />
                  </label>
                </div>
                <ScriptFields
                  v-if="step.action === 'script' && step.script"
                  v-model="step.script"
                />
                <CallbackFields
                  v-if="step.action === 'callback' && step.callback"
                  v-model="step.callback"
                />
                <ForwardFields
                  v-if="step.action === 'forward' && step.forward"
                  v-model="step.forward"
                />
                <WebSocketFields
                  v-if="step.action === 'websocket' && step.websocket"
                  v-model="step.websocket"
                />
                <label v-if="step.action === 'sse'" class="block"
                  >{{ t("mock_rule.events") }}
                  <textarea
                    v-model="step.body"
                    rows="5"
                    class="mock-field mt-1 w-full font-mono"
                    :placeholder="sseExample"
                    spellcheck="false"
                  />
                </label>
                <WorkbenchToggle
                  v-if="step.action === 'sse' || step.action === 'websocket'"
                  v-model="step.disconnectAfter"
                  class="flex items-center gap-2"
                  >{{ t("mock_rule.disconnect_after") }}</WorkbenchToggle
                >
                <label
                  v-if="
                    step.action === 'http' &&
                    ![204, 205, 304].includes(step.statusCode)
                  "
                  class="block"
                  >{{ t("response.body") }}
                  <textarea
                    v-model="step.body"
                    rows="4"
                    class="mock-field mt-1 w-full font-mono"
                    spellcheck="false"
                  />
                </label>
                <div v-if="step.action === 'file'" class="space-y-3">
                  <div>
                    <p class="font-medium">
                      {{ t("mock_rule.response_file") }}
                    </p>
                    <div
                      class="mt-1 flex flex-wrap items-center gap-3 rounded border border-dashed border-divider bg-primaryLight p-3"
                    >
                      <IconFile class="shrink-0 text-secondaryLight" />
                      <div class="min-w-0 flex-1">
                        <p class="break-all text-secondaryDark">
                          {{ step.file?.name || t("mock_rule.file_empty") }}
                        </p>
                        <p
                          v-if="step.file"
                          class="mt-1 text-tiny text-secondaryLight"
                        >
                          {{ fileSize(step.file.data) }}
                        </p>
                      </div>
                      <label
                        :for="`mock-response-file-${step.key}`"
                        class="shrink-0 cursor-pointer rounded border border-divider bg-primary px-3 py-2 font-medium text-secondaryDark transition hover:bg-primaryDark"
                        >{{
                          step.file
                            ? t("mock_rule.file_replace")
                            : t("action.choose_file")
                        }}</label
                      >
                      <input
                        :id="`mock-response-file-${step.key}`"
                        type="file"
                        :aria-label="t('mock_rule.response_file')"
                        :disabled="busy"
                        :required="!step.file"
                        class="sr-only"
                        @change="selectResponseFile(step, $event)"
                      />
                    </div>
                  </div>
                  <p class="text-tiny text-secondaryLight">
                    {{ t("mock_rule.file_limit") }}
                  </p>
                  <template v-if="step.file">
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label class="block"
                        >{{ t("mock_rule.file_name") }}
                        <input
                          v-model="step.file.name"
                          required
                          maxlength="255"
                          class="mock-field mt-1 w-full"
                        />
                      </label>
                      <label class="block"
                        >{{ t("mock_rule.file_content_type") }}
                        <input
                          v-model="step.file.contentType"
                          required
                          class="mock-field mt-1 w-full"
                          placeholder="application/octet-stream"
                        />
                      </label>
                    </div>
                    <label class="block"
                      >{{ t("mock_rule.file_disposition") }}
                      <RuleSelect
                        v-model="step.file.disposition"
                        :options="fileDispositionOptions"
                        :label="t('mock_rule.file_disposition')"
                        class="mt-1"
                      />
                    </label>
                  </template>
                </div>
                <details
                  v-if="['http', 'sse', 'websocket'].includes(step.action)"
                >
                  <summary class="cursor-pointer">
                    {{ t("mock_tools.template") }}
                  </summary>
                  <WorkbenchToggle
                    v-model="step.template"
                    class="my-2 flex gap-2"
                    >{{ t("mock_tools.template") }}</WorkbenchToggle
                  >
                  <template v-if="step.template"
                    ><p class="text-tiny text-secondaryLight">
                      {{ t("mock_tools.template_hint") }}
                    </p>
                    <div
                      v-if="step.action !== 'websocket'"
                      class="mt-2 flex flex-wrap gap-1"
                    >
                      <button
                        v-for="value in templateValues"
                        :key="value"
                        type="button"
                        class="small bg-primaryLight text-tiny"
                        @click="step.body += value"
                      >
                        {{ value }}
                      </button>
                    </div></template
                  >
                </details>
                <details v-if="step.action !== 'disconnect'">
                  <summary class="cursor-pointer">
                    {{ t("mock_tools.response_cookies") }}
                  </summary>
                  <p class="my-2 text-tiny text-secondaryLight">
                    {{ t("mock_tools.cookies_hint") }}
                  </p>
                  <textarea
                    v-model="step.cookiesText"
                    rows="3"
                    :aria-label="t('mock_tools.response_cookies')"
                    class="mock-field mt-1 w-full font-mono"
                    placeholder="session=abc; HttpOnly; SameSite=Lax&#10;old_session=; Max-Age=0"
                  />
                </details>
                <details
                  v-if="step.action !== 'disconnect'"
                  :open="step.headersText !== '{}'"
                >
                  <summary class="cursor-pointer">
                    {{ t("mock_server.response_headers") }} · JSON
                  </summary>
                  <textarea
                    v-model="step.headersText"
                    :title="t('mock_server.response_headers')"
                    :aria-label="t('mock_server.response_headers')"
                    rows="3"
                    class="mock-field mt-2 w-full font-mono"
                    spellcheck="false"
                  />
                </details>
              </div>
              <WorkbenchToggle
                v-if="rule.steps.length === 1"
                class="flex items-center gap-2"
                :on="rule.exhausted === 'fallthrough'"
                @change="
                  rule.exhausted = $event ? 'fallthrough' : 'repeat_last'
                "
                >{{ t("mock_rule.limit_hits") }}</WorkbenchToggle
              >
              <label v-else class="flex flex-wrap items-center gap-2">
                {{ t("mock_rule.after_steps") }}
                <RuleSelect
                  v-model="rule.exhausted"
                  :options="exhaustedOptions"
                  :label="t('mock_rule.after_steps')"
                  class="min-w-56 max-w-full flex-1"
                />
              </label>
            </div>
            <DebugRequest
              v-if="selected && previewRules"
              :key="rule.id"
              :server-i-d="selected.id"
              :rules="previewRules"
              :initial-path="
                rule.pathMode === 'regex'
                  ? '/'
                  : rule.path.replace(/:[^/]+/g, '1')
              "
              :initial-method="rule.method"
            />
          </fieldset>
        </form>
      </template>
      <template v-if="rule" #footer>
        <div class="flex w-full flex-wrap items-center gap-2">
          <HoppButtonPrimary
            type="submit"
            form="mock-rule-editor"
            :label="t('action.save')"
            :loading="busy"
            :disabled="busy"
          />
          <HoppButtonSecondary
            type="button"
            outline
            :label="t('mock_rule.reset')"
            :disabled="busy || dirty"
            @click="resetRule"
          />
          <span v-if="!dirty" class="text-tiny text-secondaryLight">{{
            t("mock_rule.hits", { count: state?.hits[rule.id] ?? 0 })
          }}</span>
        </div>
      </template>
    </HoppSmartModal>

    <MockTools
      v-if="toolsServer"
      :server="toolsServer"
      :mode="toolsMode"
      @close="toolsServer = undefined"
      @changed="refresh"
      @capture="captureRule"
    />

    <HoppSmartModal
      v-if="moving"
      dialog
      :title="t('mock_list.move')"
      @close="moving = null"
    >
      <template #body
        ><div class="space-y-4">
          <strong>{{ moving.name }}</strong
          ><label class="block"
            >{{ t("mock_list.destination")
            }}<RuleSelect
              v-model="targetID"
              :options="destinationOptions"
              :label="t('mock_list.destination')"
              :placeholder="t('mock_list.choose_destination')"
              class="mt-2"
          /></label>
          <p class="text-tiny text-secondaryLight">
            {{ t("mock_list.move_notice") }}
          </p>
          <code
            v-if="moveTargetURL"
            class="block break-all rounded bg-primaryLight p-3 text-tiny"
            >{{ moveTargetURL }}</code
          >
          <p v-if="error" role="alert" class="text-red-600">{{ error }}</p>
        </div></template
      >
      <template #footer
        ><HoppButtonPrimary
          :label="t('mock_list.move')"
          :disabled="busy || !targetID"
          @click="moveRule" /><HoppButtonSecondary
          type="button"
          :label="t('action.cancel')"
          @click="moving = null"
      /></template>
    </HoppSmartModal>
    <HoppSmartConfirmModal
      :show="!!deleteTarget"
      :title="t('mock_list.confirm_delete')"
      @hide-modal="deleteTarget = null"
      @resolve="deleteItem"
    />
    <HoppSmartConfirmModal
      :show="confirmDiscard"
      :title="t('mock_list.discard')"
      @hide-modal="confirmDiscard = false"
      @resolve="discardChanges"
    />
  </div>
</template>

<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import "./fields.css"
import { useWorkbenchLiveQuery } from "~/composables/workbenchLive"
import WorkbenchState from "~/components/workbench/State.vue"
import { computed, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import RuleSelect from "~/components/workbench/Select.vue"
import { getMethodLabelColor } from "~/helpers/rest/labelColoring"
import IconBraces from "~icons/lucide/braces"
import IconRadio from "~icons/lucide/radio"
import IconFile from "~icons/lucide/file"
import IconUnplug from "~icons/lucide/unplug"
import { useClipboard } from "~/composables/clipboard"
import ForwardFields from "./ForwardFields.vue"
import WebSocketFields from "./WebSocketFields.vue"
import ScriptFields from "./ScriptFields.vue"
import CallbackFields from "./CallbackFields.vue"
import JsonMapField from "./JsonMapField.vue"
import DebugRequest from "./DebugRequest.vue"
import MockTools from "./MockTools.vue"
import {
  defaultForward,
  defaultWebSocket,
  mockRuleAPI,
  mockRuleStatus,
  nextMockStep,
  type MockRule,
  type MockRulePreview,
  type MockRuleLog,
  type MockRuleState,
  type RuleServer,
} from "~/helpers/mockServer/rules"
import IconPlus from "~icons/lucide/plus"
import IconArrowLeft from "~icons/lucide/arrow-left"
import IconLayers from "~icons/lucide/layers"
import IconRoute from "~icons/lucide/route"
import IconCopy from "~icons/lucide/copy"
import IconMove from "~icons/lucide/folder-input"
import IconSettings from "~icons/lucide/settings"
import IconLogs from "~icons/lucide/list"
import IconTrash from "~icons/lucide/trash-2"
import IconReset from "~icons/lucide/rotate-ccw"

const { copy: copyToClipboard } = useClipboard()
const t = useI18n()
const emit = defineEmits<{ "server-ids": [string[]] }>()
const methods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "ANY",
]
const methodOptions = methods.map((value) => ({
  value,
  label: value,
  color: getMethodLabelColor(value),
}))
const operatorOptions = computed(() =>
  operators.map((value) => ({ value, label: t(`mock_tools.${value}`) }))
)
const protocolOptions = computed(() => [
  { value: "any", label: t("mock_tools.any_protocol") },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
])
const pathModeOptions = computed(
  () =>
    [
      { value: "template", label: t("mock_tools.template_path") },
      { value: "exact", label: t("mock_tools.exact") },
      { value: "glob", label: t("mock_tools.glob") },
      { value: "regex", label: t("mock_tools.regex") },
    ] as const
)
const conditionOptions = computed(
  () =>
    [
      { value: "query", label: t("tab.parameters") },
      { value: "header", label: t("tab.headers") },
      { value: "body", label: `${t("request.body")} · JSON` },
      { value: "cookie", label: "Cookie" },
    ] as const
)
const responseOptions = computed(
  () =>
    [
      { value: "http", label: "HTTP", icon: IconBraces },
      { value: "script", label: t("mock_tools.script"), icon: IconBraces },
      { value: "callback", label: t("mock_tools.callback"), icon: IconRoute },
      { value: "forward", label: t("mock_tools.forward"), icon: IconRoute },
      { value: "websocket", label: "WebSocket", icon: IconRadio },
      { value: "file", label: t("mock_rule.file_response"), icon: IconFile },
      { value: "sse", label: "SSE", icon: IconRadio },
      {
        value: "disconnect",
        label: t("mock_rule.disconnect"),
        icon: IconUnplug,
      },
    ] as const
)
const fileDispositionOptions = computed(
  () =>
    [
      { value: "inline", label: t("mock_rule.file_inline") },
      { value: "attachment", label: t("mock_rule.file_attachment") },
    ] as const
)
const exhaustedOptions = computed(
  () =>
    [
      { value: "repeat_last", label: t("mock_rule.repeat_last") },
      { value: "loop", label: t("mock_rule.loop") },
      { value: "fallthrough", label: t("mock_rule.fallthrough") },
    ] as const
)
const typeOptions = computed(() => [
  { value: "all", label: t("mock_list.all_types") },
  { value: "single", label: t("mock_list.single") },
  { value: "collection", label: t("mock_list.collection") },
])
const statusOptions = computed(() => [
  { value: "all", label: t("mock_list.all_status") },
  { value: "active", label: t("mock_list.active") },
  { value: "disabled", label: t("mock_list.stopped") },
  { value: "exhausted", label: t("mock_list.exhausted") },
])
const sseExample = "data: first\n\ndata: second"
const operators = [
  "equals",
  "not_equals",
  "contains",
  "regex",
  "exists",
  "absent",
  "gt",
  "gte",
  "lt",
  "lte",
  "json_contains",
  "json_schema",
  "jsonpath",
  "xpath",
] as const
const templateValues = [
  "{{query.id}}",
  "{{path.id}}",
  "{{body.name}}",
  "{{headers.x-request-id}}",
  "{{uuid}}",
  "{{timestamp}}",
  "{{isoDate}}",
  "{{randomInt:1:100}}",
]
const toolsServer = ref<RuleServer>()
const toolsMode = ref<"logs" | "settings">("logs")
const name = ref("")
const newKind = ref<"single" | "collection">("single")
const showCreate = ref(false)
const servers = ref<RuleServer[]>([])
const selected = ref<RuleServer>()
const newServerName = ref<string | null>(null)
const state = ref<MockRuleState>()
const logs = ref<MockRuleLog[]>([])
const busy = ref(false)
const error = ref("")
const movedURL = ref("")
const scopeID = ref<string | null>(null)
const scopeServer = computed(() =>
  servers.value.find((s) => s.id === scopeID.value)
)
const search = ref("")
const typeFilter = ref("all")
const statusFilter = ref("all")
const editorOpen = ref(false)
const confirmDiscard = ref(false)
const activeID = ref("")
const deleteTarget = ref<{ server: RuleServer; ruleID?: string } | null>(null)
type Row = {
  id: string
  name: string
  kind: "single" | "collection"
  server: RuleServer
  rule?: MockRulePreview
  status: string
}
const logRow = ref<Row | null>(null)
const moving = ref<Row | null>(null)
const targetID = ref("")
const moveTargets = computed(() =>
  servers.value.filter(
    (s) => s.kind === "collection" && s.id !== moving.value?.server.id
  )
)
const destinationOptions = computed(() => [
  ...(scopeServer.value
    ? [{ value: "__standalone__", label: t("mock_list.standalone") }]
    : []),
  ...moveTargets.value.map((server) => ({
    value: server.id,
    label: server.name,
  })),
])
const moveTargetURL = computed(() => {
  const target = servers.value.find((s) => s.id === targetID.value)
  return target ? target.url + moving.value?.rule?.path : ""
})
const rows = computed<Row[]>(() => {
  const scope = scopeServer.value
  const entries: Row[] = scope
    ? scope.rules.map((rule) => ({
        id: rule.id,
        name: rule.name || rule.path,
        kind: "single",
        server: scope,
        rule,
        status: mockRuleStatus(rule, scope.isActive),
      }))
    : servers.value.map((server) => {
        const rule = server.kind === "single" ? server.rules[0] : undefined
        return {
          id: server.id,
          name: rule?.name || server.name,
          kind: server.kind,
          server,
          rule,
          status: !server.isActive
            ? "stopped"
            : rule
              ? mockRuleStatus(rule, true)
              : "running",
        }
      })
  return entries.filter(
    (row) =>
      (scope || typeFilter.value === "all" || row.kind === typeFilter.value) &&
      (statusFilter.value === "all" ||
        row.status === statusFilter.value ||
        (statusFilter.value === "active" && row.status === "running") ||
        (statusFilter.value === "disabled" &&
          ["stopped", "paused"].includes(row.status))) &&
      (row.name + " " + (row.rule?.path || ""))
        .toLowerCase()
        .includes(search.value.toLowerCase())
  )
})
type DraftStep = Omit<MockRule["steps"][number], "headers" | "delayMs"> & {
  key: string
  headersText: string
  cookiesText: string
  delayMs: number | ""
}
type Draft = Omit<MockRule, "steps"> & { steps: DraftStep[] }
const drafts = ref<Draft[]>([])
const snapshot = ref("[]")
const dirty = computed(
  () =>
    newServerName.value !== null ||
    JSON.stringify(drafts.value) !== snapshot.value
)
const ruleIndex = computed(() =>
  drafts.value.findIndex((item) => item.id === activeID.value)
)
const rule = computed(() => drafts.value[ruleIndex.value])
function localDate(value?: string | null) {
  if (!value) return ""
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
function activeRules(server: RuleServer) {
  return server.rules.filter(
    (rule) => mockRuleStatus(rule, server.isActive) === "active"
  ).length
}
function nextStepNumber(rule: MockRulePreview) {
  return rule.steps.indexOf(nextMockStep(rule)!) + 1
}
function responseSummary(rule: MockRulePreview) {
  return rule.steps
    .map(
      (step) =>
        `${step.action === "script" ? t("mock_tools.script") : step.action === "callback" ? t("mock_tools.callback") : step.action === "forward" ? t("mock_tools.forward") : step.action === "websocket" ? "WebSocket" : step.action === "http" ? step.statusCode : step.action === "file" ? `${t("mock_rule.file_response")} · ${step.statusCode}` : step.action === "sse" ? "SSE" : t("mock_rule.disconnect")}${step.delayMs ? ` · ${step.delayMs} ms` : ""}`
    )
    .join(" → ")
}
function setOperator(condition: MockRule["conditions"][number], value: string) {
  condition.operator = value as typeof condition.operator
  if (["json_schema", "jsonpath", "xpath"].includes(value)) {
    condition.source = "body"
    condition.key = value === "xpath" ? "/*" : "$"
    if (value === "json_schema") condition.value = '{"type":"object"}'
  }
}
function newStep(): DraftStep {
  return {
    key: crypto.randomUUID(),
    action: "http",
    intervalMs: 250,
    disconnectAfter: false,
    statusCode: 200,
    body: "{}",
    headersText: "{}",
    cookiesText: "",
    times: 1,
    delayMs: "",
  }
}
function seedStream(step: DraftStep, action: DraftStep["action"]) {
  step.action = action
  if (action === "script")
    step.script ??= {
      code: "const items = request.body?.items ?? [];\nconst total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\nreturn { statusCode: 200, body: { total } };",
      timeoutMs: 1000,
    }
  if (action === "callback")
    step.callback ??= { url: "", headers: {}, timeoutMs: 10000 }
  if (action === "forward") step.forward ??= defaultForward()
  if (action === "websocket") step.websocket ??= defaultWebSocket()
  if (action === "file" && [204, 205, 304].includes(step.statusCode))
    step.statusCode = 200
  if (step.action === "sse" && (!step.body || step.body === "{}"))
    step.body = sseExample
}
function fileSize(data: string) {
  const bytes =
    (data.length * 3) / 4 -
    (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
function selectResponseFile(step: DraftStep, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    error.value = t("mock_rule.file_too_large")
    input.value = ""
    return
  }
  void run(async () => {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(",")[1])
      reader.onerror = () => reject(new Error(t("mock_rule.file_read_failed")))
      reader.onabort = () => reject(new Error(t("mock_rule.file_read_failed")))
      reader.readAsDataURL(file)
    })
    step.file = {
      name: file.name,
      contentType: file.type || "application/octet-stream",
      data,
      disposition: step.file?.disposition ?? "inline",
    }
  })
}
function restore() {
  drafts.value = JSON.parse(snapshot.value)
  if (!drafts.value.some(({ id }) => id === activeID.value))
    activeID.value = drafts.value[0]?.id ?? ""
}
function setState(value: MockRuleState) {
  state.value = value
  snapshot.value = JSON.stringify(
    value.rules.map((rule) => ({
      ...rule,
      pathMode: rule.pathMode ?? "template",
      priority: rule.priority ?? 0,
      scenario: rule.scenario ?? {
        name: "",
        requiredState: "STARTED",
        nextState: "",
      },
      conditions: rule.conditions.map((condition) => ({
        ...condition,
        operator: condition.operator ?? "equals",
      })),
      steps: rule.steps.map(({ headers, delayMs, ...step }) => ({
        ...step,
        key: crypto.randomUUID(),
        headersText: JSON.stringify(headers, null, 2),
        cookiesText: (step.cookies ?? []).join("\n"),
        delayMs: delayMs ?? "",
      })),
    }))
  )
  restore()
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    await action()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function loadEntries() {
  servers.value = await mockRuleAPI<RuleServer[]>()
  emit(
    "server-ids",
    servers.value.map(({ id }) => id)
  )
  if (scopeID.value && !scopeServer.value) scopeID.value = null
}
function refresh() {
  void run(loadEntries)
}
useWorkbenchLiveQuery(
  ["mock"],
  async () => {
    try {
      await loadEntries()
      if (logRow.value)
        logs.value = await mockRuleAPI<MockRuleLog[]>(
          `${logRow.value.server.id}/logs`
        )
      error.value = ""
    } catch (failure) {
      error.value = (failure as Error).message
      throw failure
    }
  },
  {
    blocked: computed(
      () =>
        busy.value ||
        !!toolsServer.value ||
        editorOpen.value ||
        !!moving.value ||
        showCreate.value
    ),
  }
)
function openRow(row: Row) {
  if (row.kind === "collection") {
    scopeID.value = row.server.id
    search.value = ""
    statusFilter.value = "all"
  } else void run(() => openEditor(row.server, row.rule?.id))
}
async function openEditor(server: RuleServer, ruleID?: string) {
  setState(await mockRuleAPI<MockRuleState>(server.id))
  newServerName.value = null
  selected.value = server
  activeID.value = ruleID || state.value?.rules[0]?.id || ""
  editorOpen.value = true
}
function closeEditor() {
  if (dirty.value) confirmDiscard.value = true
  else editorOpen.value = false
}
function discardChanges() {
  newServerName.value = null
  editorOpen.value = false
  confirmDiscard.value = false
  restore()
}
function startMove(row: Row) {
  moving.value = row
  targetID.value = ""
  error.value = ""
}
function createServer() {
  void run(async () => {
    if (newKind.value === "single") {
      const draft = newDraft(name.value)
      setState({ kind: "single", revision: 0, rules: [], hits: {} })
      drafts.value = [draft]
      newServerName.value = name.value
      selected.value = {
        id: "",
        name: name.value,
        kind: "single",
        url: "",
        isActive: true,
        revision: 0,
        rules: [],
      }
      activeID.value = draft.id
      name.value = ""
      showCreate.value = false
      editorOpen.value = true
      return
    }
    const server = await mockRuleAPI<RuleServer>("", {
      name: name.value,
      kind: newKind.value,
    })
    name.value = ""
    showCreate.value = false
    await loadEntries()
    if (server.kind === "collection") scopeID.value = server.id
    else await openEditor(server)
  })
}
async function setServerStatus(server: RuleServer, isActive: boolean) {
  await mockRuleAPI(`${server.id}/status`, { isActive })
}
function toggleServer(server: RuleServer) {
  void run(async () => {
    await setServerStatus(server, !server.isActive)
    await loadEntries()
  })
}
function toggleRow(row: Row) {
  if (scopeServer.value && !row.server.isActive) return
  if (row.kind === "collection") {
    toggleServer(row.server)
    return
  }
  void run(async () => {
    const value = await mockRuleAPI<MockRuleState>(row.server.id)
    const rule = value.rules.find((rule) => rule.id === row.rule?.id)
    if (!rule) return
    rule.enabled = !rule.enabled || !row.server.isActive
    await mockRuleAPI(row.server.id, {
      revision: value.revision,
      rules: value.rules,
    })
    if (!scopeServer.value && !row.server.isActive)
      await setServerStatus(row.server, true)
    await loadEntries()
  })
}
function requestDelete(server: RuleServer, ruleID?: string) {
  deleteTarget.value = { server, ruleID }
}
function deleteItem() {
  const target = deleteTarget.value
  if (!target) return
  void run(async () => {
    if (target.ruleID) {
      const value = await mockRuleAPI<MockRuleState>(target.server.id)
      await mockRuleAPI(target.server.id, {
        revision: value.revision,
        rules: value.rules.filter((rule) => rule.id !== target.ruleID),
      })
    } else await mockRuleAPI(`${target.server.id}/delete`, {})
    deleteTarget.value = null
    editorOpen.value = false
    await loadEntries()
  })
}
async function copyURL(server: RuleServer, rule?: MockRulePreview) {
  await copyToClipboard(
    (rule?.steps[0]?.action === "websocket"
      ? server.url.replace(/^http/, "ws")
      : server.url) + (rule?.path || "")
  )
}
function newDraft(name = ""): Draft {
  return {
    id: crypto.randomUUID(),
    name,
    method: "GET",
    path: "/hello",
    enabled: true,
    pathMode: "template",
    priority: 0,
    scenario: { name: "", requiredState: "STARTED", nextState: "" },
    conditions: [],
    steps: [newStep()],
    exhausted: "repeat_last",
  }
}
function addRule() {
  const server = scopeServer.value
  if (!server) return
  void run(async () => {
    await openEditor(server)
    const draft = newDraft()
    drafts.value.push(draft)
    activeID.value = draft.id
  })
}
function move<T>(items: T[], index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= items.length) return
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item)
}
function serializedRules(): MockRule[] {
  return drafts.value.map(({ steps, ...rule }) => ({
    ...rule,
    steps: steps.map(
      ({ headersText, cookiesText, key: _key, delayMs, ...step }) => ({
        ...step,
        delayMs: delayMs === "" ? null : delayMs,
        headers: JSON.parse(headersText || "{}"),
        cookies: cookiesText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      })
    ),
  }))
}
const previewRules = computed(() => {
  try {
    return serializedRules()
  } catch {
    return undefined
  }
})
async function captureRule(server: RuleServer, captured: MockRule) {
  toolsServer.value = undefined
  await run(async () => {
    await openEditor(server)
    if (server.kind === "single") drafts.value = []
    drafts.value.push({
      ...captured,
      steps: captured.steps.map(({ headers, delayMs, ...step }) => ({
        ...step,
        key: crypto.randomUUID(),
        headersText: JSON.stringify(headers, null, 2),
        cookiesText: (step.cookies ?? []).join("\n"),
        delayMs: delayMs ?? "",
      })),
    })
    activeID.value = captured.id
  })
}
function save() {
  const server = selected.value
  const revision = state.value?.revision
  if (!server || revision === undefined) return
  void run(async () => {
    const rules = drafts.value.map(({ steps, ...rule }) => ({
      ...rule,
      steps: steps.map(
        ({ headersText, cookiesText, key: _key, delayMs, file, ...step }) => ({
          ...step,
          ...(step.action === "file" ? { file, body: "" } : {}),
          delayMs: delayMs === "" ? null : delayMs,
          cookies: cookiesText
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
          headers:
            step.action === "disconnect" ? {} : JSON.parse(headersText || "{}"),
        })
      ),
    }))
    if (newServerName.value !== null) {
      selected.value = await mockRuleAPI<RuleServer>("", {
        name: newServerName.value,
        kind: "single",
        rules,
      })
      newServerName.value = null
    } else {
      setState(await mockRuleAPI<MockRuleState>(server.id, { revision, rules }))
    }
    editorOpen.value = false
    await loadEntries()
  })
}
function resetRule() {
  const id = selected.value?.id
  const ruleID = rule.value?.id
  if (id && ruleID)
    void run(async () => {
      setState(await mockRuleAPI<MockRuleState>(`${id}/reset`, { ruleID }))
      await loadEntries()
    })
}
function resetRow(row: Row) {
  void run(async () => {
    await mockRuleAPI(`${row.server.id}/reset`, { ruleID: row.rule?.id })
    await loadEntries()
  })
}
function openTools(server: RuleServer, mode: "logs" | "settings") {
  toolsMode.value = mode
  toolsServer.value = server
}
function openLogs(row: Row) {
  openTools(row.server, "logs")
}
function moveRule() {
  const row = moving.value
  if (!row?.rule) return
  void run(async () => {
    const target = servers.value.find((s) => s.id === targetID.value)
    const result = await mockRuleAPI<{ destinationID: string }>(
      `${row.server.id}/move`,
      {
        revision: row.server.revision,
        ruleID: row.rule!.id,
        targetID: target?.id ?? null,
        targetRevision: target?.revision,
      }
    )
    moving.value = null
    await loadEntries()
    const destination = servers.value.find((s) => s.id === result.destinationID)
    if (destination) movedURL.value = destination.url + row.rule!.path
  })
}
</script>

<style scoped>
.small {
  @apply rounded px-2 py-1.5 hover:bg-primaryLight disabled:opacity-40;
}
.icon-button {
  @apply inline-flex shrink-0 items-center justify-center rounded p-2 text-secondaryLight hover:bg-primaryLight hover:text-accent disabled:opacity-40;
}
.mock-row {
  @apply grid items-center gap-4 px-4 py-4;
  grid-template-columns: minmax(10rem, 1.3fr) 6rem minmax(8rem, 1fr) 15rem;
}
.status {
  @apply inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-tiny font-medium;
}
.status-active,
.status-running {
  @apply bg-green-500/10 text-green-600;
}
.status-exhausted,
.status-expired {
  @apply bg-amber-500/10 text-amber-600;
}
.status-disabled,
.status-paused,
.status-stopped {
  @apply bg-primaryLight text-secondaryLight;
}
@media (max-width: 1000px) {
  .mock-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
  }
  .list-heading {
    display: none;
  }
  .row-name {
    grid-column: 1;
    grid-row: 1;
  }
  .row-status {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }
  .row-response {
    grid-column: 1;
    grid-row: 2;
  }
  .row-actions {
    grid-column: 2;
    grid-row: 2;
  }
}
@media (max-width: 480px) {
  .row-response {
    grid-column: 1 / -1;
  }
  .row-actions {
    grid-row: 3;
    grid-column: 1 / -1;
  }
}
</style>
