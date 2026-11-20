import { updateInheritedPropertiesForAffectedRequests } from "~/helpers/collection/collection"
import { ensureRemoteRequest, ensureRemoteCollection } from "~/helpers/remote-collections"
import { WorkspaceType } from "~/helpers/backend/enums"
import { getWebBackend } from "~/platform/web-backend"
import { Service } from "dioc"
import {
  computed,
  nextTick,
  ref,
  shallowRef,
  watch,
  type ShallowRef,
} from "vue"
import * as E from "fp-ts/Either"
import type {
  HoppCollection,
  HoppCollectionVariable,
  HoppGQLRequest,
  HoppRESTAuth,
  HoppRESTHeader,
  HoppRESTRequest,
} from "@apirequest/data"
import {
  generateUniqueRefId,
  isRESTRequest,
  makeCollection,
} from "@apirequest/data"
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { type GQLError } from "~/helpers/backend/GQLClient"
import type {
  CreatePublishedDocsArgs,
  UpdatePublishedDocsArgs,
} from "~/helpers/backend/graphql"
import { parse as parseGQLDocument } from "graphql"
import type { OperationDefinitionNode } from "graphql"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { GQLQueryBuilderService } from "~/services/gql-query-builder.service"
import {
  GQLTabConnectionService,
  type GQLResponseEvent,
} from "~/services/gql-tab-connection.service"
import { ScrollService } from "~/services/scroll.service"
import {
  switchActiveTabToGQL,
  switchActiveTabToREST,
} from "~/helpers/tab/protocol-switch"
import { WorkspaceService, type Workspace } from "~/services/workspace.service"
import { platform } from "~/platform"
import type { AIChatModelOption, AIChatSelection } from "~/platform/experiments"
import {
  BUILT_IN_SKILLS,
  mergeSkills,
  type ChatSkill,
} from "~/helpers/aichat/skills"
import {
  invokeAction,
  isActionBound,
  type HoppAction,
  type HoppActionWithOptionalArgs,
} from "~/helpers/actions"
import { settingsStore } from "~/newstore/settings"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { getI18n } from "~/modules/i18n"
import {
  createEnvironment,
  environmentsStore,
  getCurrentEnvironment,
  getSelectedEnvironmentIndex,
  setEnvironmentVariables,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"
import {
  flushLocalStoresForCollectionTree,
  populateLocalStoresFromVariables,
  stripClientLocalValuesForWire,
} from "~/helpers/clientLocalVariables"
import { uniqueID } from "~/helpers/utils/uniqueID"
import {
  addRESTCollection,
  addRESTFolder,
  cascadeParentCollectionForProperties,
  editRESTCollection,
  editRESTFolder,
  editRESTRequest,
  getRESTCollectionInheritedProps,
  removeRESTCollection,
  removeRESTFolder,
  restCollectionStore,
  saveRESTRequestAs,
} from "~/newstore/collections"
import {
  serializeCollections,
  serializeGQLSchema,
} from "~/helpers/aichat/context-serializers"
import {
  DocumentationService,
  type PublishedDocInfo,
} from "~/services/documentation.service"
import {
  describeAmbiguous,
  findRequestInTree,
  findTopLevelCollection,
  listRequestNames,
  lookupCollection,
  lookupRequest,
  pickByName,
} from "~/helpers/aichat/collections"
import {
  getFoldersByPath,
  resolveSaveContextOnCollectionReorder,
} from "~/helpers/collection/collection"
import {
  runChatCommand,
  applyToolCall,
  applyGQLToolCall,
} from "~/helpers/aichat/commands"
import {
  buildCollectionRequest,
  parseCollectionRequestDefinitions,
  type CollectionRequestDefinition,
} from "~/helpers/aichat/collection-requests"
import { scriptSends } from "~/helpers/aichat/script-hosts"
import {
  containsLocalSecretReference,
  LOCAL_SECRET_REFERENCE_GLOBAL,
  makeLocalSecretReference,
  REDACTED_VALUE,
  redactSensitiveChatValues,
  replaceSensitiveChatValues,
} from "~/helpers/aichat/secret-references"
import {
  APP_ACTION_TOOLS,
  parseAppActionCommand,
  splitCommands,
} from "~/helpers/aichat/app-actions"
import { repliesFailure } from "~/helpers/aichat/step-lines"
import {
  COLLECTION_UNTESTED,
  upsertWritesTests,
} from "~/helpers/aichat/suggestions"
import type { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse"
import type {
  HoppTabSaveContext,
  HoppTestRunnerDocument,
  TestRunnerMeta,
} from "~/helpers/tab/document"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { TestRunnerService } from "~/services/test-runner/test-runner.service"
import type { HoppTab } from "~/services/tab"
export type ChatRole = "user" | "assistant"
export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /**
   * Sanitized content sent to the model when the displayed text has a secret.
   * On a step line or error notice, what the model is told (others stay
   * UI-only).
   */
  modelContent?: string
  /** True while the assistant message is still streaming in. */
  pending?: boolean
  /**
   * `"tool"` marks a compact "step" line describing one executed action (run,
   * edit, env change…), shown distinctly from normal assistant prose.
   */
  kind?: "tool" | "error"
  /**
   * How long the model "thought" before this reply's first token — set once
   * the round-trip resolves, so the thinking indicator settles into a
   * "Thought for …" note instead of vanishing.
   */
  thinkingMs?: number
}
/**
 * A single attachable piece of context for the AI chat (the active request, its
 * response, the environment, or ad-hoc context registered by an open modal).
 */
export interface ChatContextItem {
  id: string
  /** Short chip label. */
  label: string
  /** Secondary text shown on hover. */
  detail: string
  /** Serializes this context into the string sent to the model. */
  serialize: () => string
}
/** Builds the context for the tab a turn is pinned to (null: the active tab). */
export type ChatContextSource = (tabId: string | null) => string
/** A tool waiting on the user's yes/no. */
export interface PendingConfirmation {
  kind:
    | "collection"
    | "mock-server"
    | "run"
    | "publish-docs"
    | "unpublish-docs"
    | "public-mock-server"
    | "save"
  name: string
  /** Team name, or null for the personal workspace. */
  workspace: string | null
  /** For a run or save: the hosts the chat pointed it at. */
  hosts?: string[]
  /** For docs: the version, and an environment whose values go public. */
  version?: string
  environment?: string
  resolve: (confirmed: boolean) => void
}
/** What a confirmation shows besides its target; workspace overrides the current one. */
type ConfirmDetail = Partial<
  Pick<PendingConfirmation, "hosts" | "version" | "environment" | "workspace">
>
/** A v2 environment variable as edited from the chat. */
interface EnvVar {
  key: string
  currentValue: string
  initialValue: string
  secret: boolean
}
interface CollectionRunSnapshot {
  status: "idle" | "running" | "completed" | "stopped" | "error"
  meta: TestRunnerMeta
  resultCollection?: HoppCollection
}
/** A handle to the active REST request tab, used to apply + commit edits. */
interface ActiveRequestHandle {
  request: HoppRESTRequest
  /** Reactive getter for the request's latest run response. */
  getResponse: () => HoppRESTResponse | null | undefined
  /** Reassign the request with fresh array refs so the editor re-renders. */
  commit: () => void
  /**
   * Binds the tab to a collection entry after a save-as (mirrors the Save
   * dialog): the tab shows the saved copy and is no longer dirty.
   */
  bindToCollection: (
    saveContext: HoppTabSaveContext,
    saved: HoppRESTRequest,
    inheritedProperties?: HoppInheritedProperty
  ) => void
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** A handle to the active GraphQL request tab (unified workspace). */
interface ActiveGQLRequestHandle {
  request: HoppGQLRequest
  /** Reactive getter for the tab's run/subscription event stream. */
  getEvents: () => GQLResponseEvent[] | null | undefined
  /** Reassign the request with fresh array refs so the editor re-renders. */
  commit: () => void
}
/** A content block in a model-format chat message (Anthropic shape). */
type ChatContentBlock =
  | {
      type: "text"
      text: string
    }
  | {
      type: "tool_use"
      id: string
      name: string
      input: Record<string, unknown>
    }
  | {
      type: "tool_result"
      tool_use_id: string
      content: string
      /** Marks a tool that did not do what was asked. */
      is_error?: boolean
    }
/** A chat message in model format — plain text, or content blocks mid tool loop. */
interface ChatRequestMessage {
  role: ChatRole
  // Plain text, our tool_use/tool_result blocks, or the assistant's own
  // blocks echoed back verbatim (they may carry tool-search results and
  // thinking blocks the API must see unchanged).
  content: string | ChatContentBlock[] | unknown[]
}
/** A tool call returned by the backend chat endpoint. */
interface ChatToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}
/** The backend chat function (LLM + tool use). */
type ChatFn = (
  messages: ChatRequestMessage[],
  context: string,
  selection?: AIChatSelection,
  options?: {
    signal?: AbortSignal
  }
) => Promise<
  E.Either<
    string,
    {
      content: string
      tool_calls: ChatToolCall[]
      trace_id: string
      /** The model that served the turn, where the backend reports one. */
      model?: string
      usage?: ChatUsage
      assistant_content?: unknown[]
      loaded_tools?: string[]
    }
  >
>
/**
 * Token accounting for one model round-trip. Every counter is optional: the
 * cache figures exist only where the provider implements prompt caching.
 */
interface ChatUsage {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens?: number
}
/** Most recent messages sent as conversation history to the model. */
const MAX_HISTORY_MESSAGES = 12
/**
 * Total history budget (chars) and per-message caps for older turns: the
 * assistant's prose is summarizable, but a user's earlier message may be the
 * spec (a pasted body, an endpoint list) a follow-up refers to, so it keeps
 * far more before the oldest-first budget trim takes over.
 */
const MAX_HISTORY_CHARS = 8000
const MAX_OLD_ASSISTANT_CHARS = 800
const MAX_OLD_USER_CHARS = 4000
/**
 * Moves a cut index off the middle of a surrogate pair: a lone surrogate makes
 * the provider reject the whole request body.
 */
const surrogateSafeCut = (text: string, cut: number): number => {
  const code = text.charCodeAt(cut - 1)
  return code >= 0xd800 && code <= 0xdbff ? cut - 1 : cut
}
/** A cut at or before `max` that splits no `<<local-ref:…>>` token. */
const refSafeCut = (text: string, max: number): number => {
  let cut = max
  const open = text.lastIndexOf("<<", cut)
  // The token ends after its `>>`: a cut between the two splits it too.
  const close = open === -1 ? -1 : text.indexOf(">>", open)
  if (close !== -1 && close + 2 > cut) cut = open
  return surrogateSafeCut(text, cut)
}
/** Cuts `text` at `max` without splitting a `<<local-ref:…>>` token. */
const truncateForHistory = (text: string, max: number): string => {
  if (text.length <= max) return text
  const cut = refSafeCut(text, max)
  return `${text.slice(0, cut)}\n[… ${text.length - cut} more characters from this earlier message were omitted — ask the user to re-send them if needed]`
}
/** Longest line per tool in a note to the model on what ran. */
const MAX_RAN_LINE_CHARS = 160
/** A tool's line in a note to the model, and whether it failed with no effect. */
interface RanOutcome {
  line: string
  failed: boolean
}
/** A tool's line in such a note: its name and how it ended. */
const ranLine = (name: string, result: string, short?: string): string => {
  const text =
    short && result.startsWith("### ")
      ? short
      : (result.split("\n").find((l) => l.trim()) ?? "Done.").trim()
  const line =
    text.length > MAX_RAN_LINE_CHARS
      ? `${text.slice(0, refSafeCut(text, MAX_RAN_LINE_CHARS))}…`
      : text
  return `- ${name.replace(/[^\w-]/g, "").slice(0, 64) || "tool"}: ${line}`
}
/** Longest tool reply echoed back to the model (the UI still shows it all). */
const MAX_TOOL_RESULT_CHARS = 800
/**
 * The host a request sends to, as the send path resolves it: a REST endpoint
 * without http(s):// gets "https://" (Request.vue), a GraphQL URL resolves
 * against the page. So "//evil.example" is evil.example, not "". A templated
 * host (`<<baseUrl>>`) counts as itself.
 */
const hostOf = (url: string, rest = true): string => {
  const raw = url.replace(/[\t\n\r]/g, "").trim()
  if (!raw) return ""
  // Templated: skip the scheme (`<<protocol>>://` too) and any slashes, drop
  // userinfo.
  const authorityOf = (text: string) => {
    const [, scheme = "", authority = ""] =
      /^([a-z][\w+.-]*:|<<[^<>]+>>:?(?=[/\\]{2}))?[/\\]*([^/\\?#]*)/i.exec(
        text
      ) ?? []
    const host = authority.slice(authority.lastIndexOf("@") + 1).toLowerCase()
    // `<<x>>//host`: x may hold a scheme or a whole base URL, so both count.
    return scheme.endsWith(">>") ? `${scheme}//${host}` : host
  }
  if (raw.startsWith("<<")) return authorityOf(raw)
  const full = rest && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw
  try {
    const base = rest ? undefined : globalThis.location?.href
    return new URL(full, base).host.toLowerCase()
  } catch (_e) {
    return authorityOf(full)
  }
}
/** Key words naming a URL or host: `baseUrl`, `API_HOST`, `apiBase`. */
const URL_KEY_WORD =
  /^(?:url|uri|host|hostname|domain|endpoint|origin|server|base|baseurl)$/
/** Whether a variable key names a URL or host. */
const isURLKey = (key: string) =>
  key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => URL_KEY_WORD.test(word))
/**
 * The host a variable value names, else "": a URL (`<<proto>>://` too), or,
 * when `bare`, a bare host or `<<var>>` (`john.doe` is no host).
 */
const valueHost = (value: string, bare: boolean): string => {
  const v = value.trim()
  return /^(?:https?:|<<[^<>]+>>:?)?\/\//i.test(v) ||
    (bare &&
      /^(?:<<[^<>]+>>|localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[\w-]+\.)+[a-z]{2,24})(?::\d+)?(?:[/?#]|$)/i.test(
        v
      ))
    ? hostOf(v)
    : ""
}
/**
 * Context-fetching tools: their whole point is a large result for the model,
 * so they get a bigger echo budget and only a short line in the UI.
 */
const CONTEXT_FETCH_TOOLS = new Map<string, string>([
  ["get_graphql_schema", "📚 Shared the GraphQL schema with the assistant."],
  ["list_collections", "📚 Shared the collection outline with the assistant."],
])
const MAX_CONTEXT_RESULT_CHARS = 8000
/** App actions that act on the turn's pinned tab. */
const TURN_TAB_TOOLS = new Set<string>([
  "run_request",
  "save_request",
  "close_tab",
  "duplicate_tab",
  "switch_protocol",
  "save_request_to_collection",
  "get_graphql_schema",
])
/** Platform chat error code → its `ai_experiments.chat.errors` key. */
const CHAT_ERROR_KEYS = new Map<string, string>([
  ["UNAUTHORIZED", "unauthorized"],
  ["RATE_LIMITED", "rate_limited"],
  ["INPUT_TOO_LARGE", "input_too_large"],
  ["INVALID_INPUT", "invalid_input"],
  ["MODEL_UNAVAILABLE", "model_unavailable"],
  ["CHAT_DISABLED", "chat_disabled"],
  ["PROVIDER_MISCONFIGURED", "provider_misconfigured"],
  ["PROVIDER_TIMEOUT", "provider_timeout"],
  ["NETWORK", "network"],
  ["UNABLE_TO_PARSE_RESPONSE", "unable_to_parse_response"],
  ["CANNOT_RUN_CHAT", "cannot_run_chat"],
  ["ABORTED", "aborted"],
])
/** Resolved secrets shorter than this stay as they are in the context. */
const MIN_MASKED_SECRET_LENGTH = 4
/** Below this length a masked value must stand alone, not inside a word. */
const WHOLE_WORD_SECRET_LENGTH = 12
/**
 * Worth masking: long, or mixing character classes. "admin", "test", "true"
 * or "1234" also name paths, roles and flags the model needs to read.
 */
const looksLikeSecret = (value: string): boolean => {
  if (value.length >= 8) return true
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) =>
    re.test(value)
  ).length
  return value.length >= MIN_MASKED_SECRET_LENGTH && classes >= 2
}
/**
 * Replaces `value` with `ref`. A short value is replaced only where it is a
 * whole word: "adm1n" inside "adm1nistrator" stays.
 */
const replaceSecretIn = (text: string, value: string, ref: string): string => {
  if (value.length >= WHOLE_WORD_SECRET_LENGTH)
    return text.split(value).join(ref)
  const joined = (a = "", b = "") => /[a-z\d]/i.test(a) && /[a-z\d]/i.test(b)
  let out = ""
  let last = 0
  let i = text.indexOf(value)
  while (i !== -1) {
    const end = i + value.length
    if (
      joined(text[i - 1], value[0]) ||
      joined(value[value.length - 1], text[end])
    ) {
      i = text.indexOf(value, i + 1)
      continue
    }
    out += text.slice(last, i) + ref
    last = end
    i = text.indexOf(value, end)
  }
  return out + text.slice(last)
}
const TAB_CLOSED_REPLY =
  "⚠️ The tab I was working on was closed — nothing changed."
/** Tab tools without their own page check; the rest use unavailableReply. */
const WORKSPACE_PAGE_TOOLS = new Set<string>([
  "open_request",
  "run_collection",
  "save_request_to_collection",
  "get_graphql_schema",
])
const OFF_WORKSPACE_REPLY =
  "⚠️ Open the workspace to edit requests — nothing changed."
/** App actions that never read the current workspace. */
const WORKSPACE_FREE_TOOLS = new Set<string>([
  "run_request",
  "save_request",
  "open_new_tab",
  "close_tab",
  "duplicate_tab",
  "switch_tab",
  "switch_protocol",

  "get_graphql_schema",
])
const WORKSPACE_MOVED_REPLY =
  "⚠️ The workspace changed during this reply — nothing changed."
/** What the model reads for a Stop: the message before it is cancelled. */
const STOPPED_NOTE =
  "[The user pressed Stop: don't act on the message before this unless asked again.]"
/** A run's line when its turn was stopped after the request went out. */
const SENT_BEFORE_STOP = "■ Sent before the stop — see the response panel."
/** Input copied from redacted context would write the marker in. */
const REDACTED_INPUT_REPLY = `⚠️ A value was redacted; ask the user for it — nothing changed. A literal "${REDACTED_VALUE}" must be added by hand.`
/** Occurrences of the redaction marker in a string or tool input. */
const redactedCount = (value: unknown): number =>
  (typeof value === "string"
    ? value
    : (JSON.stringify(value ?? {}) ?? "")
  ).split(REDACTED_VALUE).length - 1
/** Longest a chat-triggered save may take (token check, team mutation). */
const SAVE_TIMEOUT_MS = 10000
/** Longest run_request waits for the response before reporting it later. */
const RUN_WAIT_MS = 30000
/** Upper bound on the cosmetic typing of one reply, and its frame length. */
const MAX_TYPING_MS = 240
const TYPING_TICK_MS = 16
/** A started run and its outcome. */
interface RunStep {
  /** The step message holding the ▶ line, once the batch posts it. */
  stepId: string | null
  /** True until the batch that started the run posts its step. */
  awaitingStep: boolean
  /** An outcome that settled before its step line existed. */
  parked: string | null
  /** Set when the batch was abandoned: the outcome is not reported. */
  dropped: boolean
  /** The outcome, once the response landed (or the watch timed out). */
  outcome: string | null
  /** Set once run_request stopped waiting: the step line takes the outcome. */
  reportLater: boolean
  /** Called with the outcome while run_request is still waiting on it. */
  onOutcome: ((text: string) => void) | null
  /** Stops the watcher and its timer. */
  cancel: () => void
}
/** What a tool batch threads into its handlers. */
interface ToolBatch {
  generation: number
  /** Runs this batch leaves running; null outside the agent loop. */
  runs: RunStep[] | null
  /** Aborted when the turn is stopped. */
  signal?: AbortSignal
  /** The tab the running tool activated; the pin moves there after it. */
  activatedTabId?: string | null
  /** Set by the running tool when it switched workspace itself. */
  switchedWorkspace?: boolean
  /** Set once a run's request went out: a failed outcome still took effect. */
  sent?: boolean
}
/**
 * Hosts the chat pointed requests at this conversation that the user never
 * typed, by content: a copy in another tab, turn or saved request still asks.
 */
interface ChatRisks {
  /** Hosts the chat set in a request URL. */
  hosts: Set<string>
  /** Values the chat wrote into variables, by lowercased key. */
  vars: Map<string, string>
  /** Hosts approved for a run. */
  runApproved: Set<string>
  /** Saves approved, as "target\0host": one target doesn't cover another. */
  saveApproved: Set<string>
  /** Scripts the chat wrote, by trimmed text: where each sends unasked. */
  scripts: Map<string, string[]>
}
const noRisks = (): ChatRisks => ({
  hosts: new Set(),
  vars: new Map(),
  runApproved: new Set(),
  saveApproved: new Set(),
  scripts: new Map(),
})
/**
 * Marks a chat script's send that only a run can place; the script follows.
 * No host can match it: a host with a "/" starts with "<<".
 */
const OPAQUE_SEND = "\0script/"
/** Where a request sends, and the scripts that run with it. */
interface RunSurface {
  host: string
  scripts: string[]
}
/** Each level's pre-request and test scripts. */
const scriptsOf = (
  levels: Array<{
    preRequestScript?: string
    testScript?: string
  }>
): string[] =>
  levels.flatMap((level) => [
    level.preRequestScript ?? "",
    level.testScript ?? "",
  ])
/** Where a save writes: a stable key, its name, and its workspace label. */
interface SaveTarget {
  key: string
  name: string
  /** Team name or null (personal); undefined means the current workspace. */
  workspace?: string | null
}
/** Max model round-trips per user message (bounds the agentic tool loop). */
const MAX_TOOL_STEPS = 6
/**
 * Tools that take `<<local-ref:…>>` values as-is: `toEnvVars` resolves the
 * reference itself and insists the target variable is a secret.
 */
const ENV_VARIABLE_TOOLS = new Set<string>([
  "create_environment",
  "add_or_update_environment_variables",
])
/** Longest message the offline (regex) command parser will look at. */
const MAX_OFFLINE_COMMAND_LENGTH = 4000
/** Human-readable capability families for the "loaded tools" step line. */
const TOOL_FAMILIES: Array<[RegExp, string]> = [
  [/mock_server/, "mock servers"],
  [/documentation|description/, "documentation"],
  [/team|workspace/, "teams and workspaces"],
  [/collection|open_request/, "collections"],
  [/environment/, "environments"],
  [/tab|protocol/, "tabs"],
  [/interceptor/, "the interceptor"],
]
/** Maps tool names to the distinct families they belong to, in order. */
const describeToolFamilies = (names: string[]): string[] => {
  const out: string[] = []
  for (const name of names) {
    const family = TOOL_FAMILIES.find(([re]) => re.test(name))?.[1]
    if (family && !out.includes(family)) out.push(family)
  }
  return out
}
/**
 * Holds the state for the single, global AI chat thread.
 *
 * It is a `dioc` service (singleton) so the conversation + open state persist as
 * the user navigates around the app — there is one assistant that "follows" the
 * user and reads whatever context is currently in scope.
 *
 * A turn is a loop, not one round-trip: the backend owns the model and the tool
 * contract but executes nothing, so every tool runs here — against the pinned
 * tab and the surrounding workspace — and its result is fed back until the model
 * stops calling tools or hits `MAX_TOOL_STEPS`. `turnTabId` pins the turn to the
 * tab it was sent from, secrets travel as `<<local-ref:id>>` placeholders only
 * `localSecretValues` can resolve, and bulky context (schemas, collection trees)
 * is fetched on demand by tool call. With no backend chat function the service
 * falls back to an offline regex parser.
 */
export class AIChatService extends Service {
  public static readonly ID = "AI_CHAT_SERVICE"
  /** Whether the chat panel is open. */
  public readonly isOpen = ref(false)
  /** The conversation history (single thread). */
  public readonly messages = ref<ChatMessage[]>([])
  /** True while an assistant reply is streaming. */
  public readonly isStreaming = ref(false)
  /**
   * Tool names executed during the most recently completed turn (empty for a
   * prose-only answer). Drives the contextual follow-up suggestion chips.
   */
  public readonly lastTurnTools = ref<string[]>([])
  /** Outcome of the most recent turn — follow-ups only show after "ok". */
  public readonly lastTurnStatus = ref<"idle" | "ok" | "error">("idle")
  /**
   * Models this instance offers, refreshed when the pane opens.
   *
   * Empty is meaningful: it means an administrator has registered nothing, and
   * every message would fail. `availabilityKnown` separates that from "not
   * asked yet", because a failed lookup must not be read as "no models".
   */
  public readonly modelOptions = ref<AIChatModelOption[]>([])
  /**
   * Whether the administrator has switched the assistant on. Null until the
   * server has answered.
   */
  public readonly instanceEnabled = ref<boolean | null>(null)
  /** True once a lookup has succeeded, whatever it returned. */
  public readonly availabilityKnown = ref(false)
  /** Numbers each lookup, so an older answer can't replace a newer one. */
  private availabilityRequests = 0
  /** The newest lookup applied; `clearAvailability` moves it past any in flight. */
  private availabilityApplied = 0
  /**
   * Whether the assistant may be offered. Unknown counts as no; a platform
   * with no server-side switch offers it whenever it can chat.
   */
  public readonly available = computed(() => {
    const ai = platform.experiments?.aiExperiments
    if (ai?.getChatAvailability) return this.instanceEnabled.value === true
    return !!ai?.chat
  })
  /**
   * The skills the composer offers under "/": the built-in set with any the
   * admin defined laid over it. Starts as the built-ins so the menu works
   * before the first lookup answers.
   */
  public readonly skills = ref<ChatSkill[]>(BUILT_IN_SKILLS)
  /**
   * The connection and model the next turn will use.
   *
   * Never read inside a turn — `sendMessage` snapshots it, so changing the
   * choice mid-reply cannot swap the provider between steps of one turn.
   */
  public readonly selectedModel = ref<AIChatSelection | null>(null)
  /**
   * Ad-hoc context registered by currently-open surfaces (e.g. modals), merged
   * into the chat context alongside the active request/response/environment.
   */
  public readonly registeredContext = ref<ChatContextItem[]>([])
  private readonly tabService = this.bind(WorkspaceTabsService)
  private readonly workspaceService = this.bind(WorkspaceService)
  private readonly gqlQueryBuilder = this.bind(GQLQueryBuilderService)
  private readonly gqlTabConnection = this.bind(GQLTabConnectionService)
  private readonly scrollService = this.bind(ScrollService)
  private readonly secretEnvironmentService = this.bind(
    SecretEnvironmentService
  )
  private readonly currentEnvironmentValueService =
    this.bind(CurrentValueService)
  private readonly testRunnerService = this.bind(TestRunnerService)
  private readonly documentationService = this.bind(DocumentationService)
  private readonly t = getI18n()
  private idCounter = 0
  private secretReferenceCounter = 0
  private readonly localSecretValues = new Map<string, string>()
  /** Encoded forms of a captured secret → their own id in localSecretValues. */
  private readonly localSecretForms = new Map<string, string>()
  /**
   * Bumped whenever the conversation is torn down or a new turn starts. A turn
   * captures the value when it begins and abandons itself once it no longer
   * matches, so a round-trip that outlives its conversation cannot write back
   * into the one that replaced it.
   */
  private turnGeneration = 0
  /**
   * The tab the current turn acts on, pinned when the message was sent so a
   * user switching tabs while the model thinks does not redirect its edits.
   * Tab tools (open/close/switch/…) move the pin to the tab they activated.
   */
  private turnTabId: string | null = null
  /**
   * The workspace the current turn acts on, pinned like the tab: a user
   * switching workspace mid-reply must not redirect creates or deletes.
   */
  private turnWorkspace: Workspace | null = null
  /** Aborts the current turn's round-trip and waits (Stop, logout). */
  private turnAbort: AbortController | null = null
  /** The current turn's user message, raw. */
  private turnUserText = ""
  /** What the chat changed that a run or save would send, and what's approved. */
  private chatRisks: ChatRisks = noRisks()
  /** Runs still watching for their response, across turns. */
  private readonly liveRuns = new Set<RunStep>()
  /** The last Stop: the turn it ended, its "■ Stopped." line, what ran first. */
  private stopped: {
    generation: number
    stepId: string
    ran: RanOutcome[]
  } | null = null
  /**
   * The running turn's tool outcomes so far, for a Stop's note, and the
   * step-cap reply that already lists them.
   */
  private turnRan: {
    generation: number
    outcomes: RanOutcome[]
    listedIn?: string
  } | null = null
  private nextId(): string {
    this.idCounter += 1
    return `msg_${Date.now()}_${this.idCounter}`
  }
  private captureLocalSecret(secret: string): string {
    const id = `secret_${++this.secretReferenceCounter}`
    this.localSecretValues.set(id, secret)
    return id
  }
  /** The id resolving to exactly this encoded form, minted once. */
  private localSecretFormId(form: string): string {
    const known = this.localSecretForms.get(form)
    if (known) return known
    const id = this.captureLocalSecret(form)
    this.localSecretForms.set(form, id)
    return id
  }
  private contentForModel(content: string): string {
    return replaceSensitiveChatValues(content, (secret) =>
      this.captureLocalSecret(secret)
    )
  }
  /**
   * Puts every credential this conversation resolved back behind its
   * reference, so one a tool wrote into the request can't reach the model
   * through the context. A short or plain word ("admin", "true") is left:
   * masking it would mangle URLs and fields that merely contain it.
   */
  public maskLocalSecrets(text: string): string {
    const forms = new Set(this.localSecretForms.values())
    return [...this.localSecretValues]
      .filter(([id, value]) => !forms.has(id) && looksLikeSecret(value))
      .flatMap(([id, value]) => [
        [id, value] as const,
        // A JSON string body or URL component shows it too. That form gets
        // its own ref: resolving to the raw value would decode it in place.
        ...[
          ...new Set([
            JSON.stringify(value).slice(1, -1),
            encodeURIComponent(value),
          ]),
        ]
          .filter((form) => form !== value && text.includes(form))
          .map((form) => [this.localSecretFormId(form), form] as const),
      ])
      .filter(([, value]) => value.length >= MIN_MASKED_SECRET_LENGTH)
      .sort(([, a], [, b]) => b.length - a.length)
      .reduce(
        (out, [id, value]) =>
          replaceSecretIn(out, value, makeLocalSecretReference(id)),
        text
      )
  }
  public open() {
    this.isOpen.value = true
    void this.loadAvailability()
  }
  /**
   * Asks the server whether the assistant is on and what it offers.
   *
   * A failed lookup changes nothing: an instance that chatted fine a moment ago
   * should not be declared switched-off by one flaky request. Called when a
   * session starts and again whenever the pane opens, because an administrator
   * can change either while the app is loaded.
   */
  public async loadAvailability() {
    const getAvailability =
      platform.experiments?.aiExperiments?.getChatAvailability
    if (!getAvailability) return
    const request = ++this.availabilityRequests
    const result = await getAvailability()
    // Stale: a newer lookup answered, or the session it asked for ended.
    if (E.isLeft(result) || request <= this.availabilityApplied) return
    this.availabilityApplied = request
    this.instanceEnabled.value = result.right.enabled
    this.modelOptions.value = result.right.models
    this.skills.value = mergeSkills(result.right.skills)
    this.availabilityKnown.value = true
    this.reconcileSelection()
  }
  /** Forgets the last answer: it belonged to the session that ended. */
  public clearAvailability() {
    this.availabilityApplied = this.availabilityRequests
    this.instanceEnabled.value = null
    this.availabilityKnown.value = false
    this.modelOptions.value = []
    this.skills.value = BUILT_IN_SKILLS
  }
  /**
   * Keeps the choice pointing at something the instance still offers.
   *
   * Falls back to the instance default, then to whatever is first: a default
   * can go missing (an admin disabling that connection), and a picker with
   * nothing selected would send no selection at all.
   */
  private reconcileSelection() {
    const options = this.modelOptions.value
    const current = this.selectedModel.value
    const stillOffered =
      current &&
      options.some(
        (option) =>
          option.connectionID === current.connectionID &&
          option.model === current.model
      )
    if (stillOffered) return
    const fallback = options.find((option) => option.isDefault) ?? options[0]
    this.selectedModel.value = fallback
      ? { connectionID: fallback.connectionID, model: fallback.model }
      : null
  }
  /** Records the user's choice for subsequent turns. */
  public selectModel(option: AIChatModelOption) {
    this.selectedModel.value = {
      connectionID: option.connectionID,
      model: option.model,
    }
  }
  public close() {
    this.isOpen.value = false
  }
  public toggle() {
    this.isOpen.value = !this.isOpen.value
  }
  /**
   * Clears the conversation, unless a reply is arriving — a user should not be
   * able to wipe a turn out from under itself. Use `reset` when the teardown is
   * not the user's choice.
   */
  public clear() {
    if (this.isStreaming.value) return
    this.reset()
  }
  /**
   * A tool waiting on the user, or null: a delete, or a run after this turn
   * changed what the run sends.
   *
   * The model picked this target from a sentence rather than the user clicking
   * it, so the prompt has to name what is about to go. The handler awaits
   * `resolve`; nothing happens until the UI settles it.
   */
  public readonly pendingConfirmation = ref<PendingConfirmation | null>(null)
  /** Settles the open confirmation. A second call is a no-op. */
  public resolveConfirmation(confirmed: boolean) {
    const pending = this.pendingConfirmation.value
    this.pendingConfirmation.value = null
    pending?.resolve(confirmed)
  }
  /** Asks the user. Resolves false if declined or the turn was abandoned. */
  private confirm(
    kind: PendingConfirmation["kind"],
    name: string,
    generation: number,
    detail: ConfirmDetail = {}
  ): Promise<boolean> {
    // A stopped turn must not prompt, nor close a live turn's prompt.
    if (this.isStaleTurn(generation)) return Promise.resolve(false)
    // Only one can be open: a turn executes its tools in sequence.
    this.resolveConfirmation(false)
    const ws = this.workspaceService.currentWorkspace.value
    const { workspace, ...rest } = detail
    return new Promise((resolve) => {
      this.pendingConfirmation.value = {
        kind,
        name,
        workspace: workspace !== undefined ? workspace : null,
        ...rest,
        resolve,
      }
    })
  }
  /**
   * Abandons the turn in flight: its round-trip is aborted, any prompt is
   * declined, and no further tool runs. A tool already mid-flight finishes.
   */
  public stop() {
    if (!this.isStreaming.value) return
    const generation = this.turnGeneration
    this.abandonTurn()
    // Settle the bubbles the abandoned step left open.
    this.messages.value = this.messages.value.filter(
      (m) => !(m.pending && !m.content)
    )
    for (const m of this.messages.value) m.pending = false
    const stepId = this.pushStep("■ Stopped.")
    // Told to the model too: the stopped message is not a live request, and
    // what earlier steps did must not be redone on "go ahead".
    const turn = this.turnRan?.generation === generation ? this.turnRan : null
    // A step-cap reply that is typing lists them already.
    const listed = this.messages.value.some((m) => m.id === turn?.listedIn)
    const ran = turn && !listed ? [...turn.outcomes] : []
    const step = this.messages.value.find((m) => m.id === stepId)
    if (step) step.modelContent = this.stoppedNote(ran)
    this.stopped = { generation, stepId, ran }
    this.lastTurnStatus.value = "idle"
  }
  /** Lists what a stopped batch already did above its "■ Stopped." line. */
  private reportStoppedBatch(
    generation: number,
    replies: string[],
    outcomes: RanOutcome[]
  ) {
    const stopped = this.stopped
    if (!replies.length || stopped?.generation !== generation) return
    const step = this.messages.value.find((m) => m.id === stopped.stepId)
    if (!step) return
    this.pushStepBefore(step.id, replies.join("\n\n"))
    step.modelContent = this.stoppedNote([...stopped.ran, ...outcomes])
  }
  /** What the model reads for a Stop: the cancel, and what already ran. */
  private stoppedNote(ran: RanOutcome[]): string {
    if (!ran.length) return STOPPED_NOTE
    const budget = MAX_OLD_ASSISTANT_CHARS - STOPPED_NOTE.length - 20
    return `${STOPPED_NOTE} ${this.outcomesNote("Done before the stop:", ran, budget)}`
  }
  /**
   * Tool outcomes for the model, whole lines within `budget`: what took
   * effect under `head`, failures and refusals apart so a retry redoes them.
   */
  private outcomesNote(
    head: string,
    ran: RanOutcome[],
    budget: number
  ): string {
    const done = ran.filter((r) => !r.failed)
    const failed = ran.filter((r) => r.failed)
    const items = [
      ...(done.length ? [head, ...done.map((r) => r.line)] : []),
      ...(failed.length
        ? ["These failed or were refused:", ...failed.map((r) => r.line)]
        : []),
    ]
    const lines: string[] = []
    let size = 0
    for (const item of items) {
      // Masked again: a credential resolved after the line was written.
      const line = this.maskLocalSecrets(item)
      if (size + line.length + 1 > budget) break
      lines.push(line)
      size += line.length + 1
    }
    const more = ran.length - lines.filter((l) => l.startsWith("- ")).length
    if (more) lines.push(`- …${more} more`)
    return lines.join("\n")
  }
  /** Invalidates the current turn and releases everything it awaits. */
  private abandonTurn() {
    this.turnGeneration++
    this.turnAbort?.abort()
    this.turnAbort = null
    // An abandoned turn would otherwise leave the handler awaiting forever.
    this.resolveConfirmation(false)
    this.isStreaming.value = false
  }
  /**
   * Tears the conversation down unconditionally and abandons any turn still in
   * flight. Unlike `clear`, this never defers: it exists for the case where the
   * session itself has ended (logout), and the transcript, the pinned tab and
   * the local secret values all belong to the session that just ended.
   *
   * A turn already awaiting a round-trip is aborted and invalidated — it
   * discards its result rather than repopulating a conversation that is meant
   * to be gone. Runs still waiting on a response are dropped with it.
   */
  public reset() {
    this.abandonTurn()
    for (const run of this.liveRuns) this.dropRun(run)
    this.messages.value = []
    this.lastTurnTools.value = []
    this.lastTurnStatus.value = "idle"
    this.localSecretValues.clear()
    this.localSecretForms.clear()
    // The counter is deliberately NOT rewound. A turn abandoned mid-batch can
    // still resolve `<<local-ref:secret_N>>`, so re-minting that id would hand
    // it the next session's credential. Monotonic ids make a stale reference
    // resolve to nothing, which every consumer already handles.
    this.turnTabId = null
    this.turnWorkspace = null
    this.turnUserText = ""
    this.chatRisks = noRisks()
    this.stopped = null
    this.turnRan = null
  }
  /** True once `reset` (or a newer turn) has abandoned the given turn. */
  private isStaleTurn(generation: number): boolean {
    return generation !== this.turnGeneration
  }
  /** Records a tool/action executed by the current turn. */
  private recordTool(name: string) {
    this.lastTurnTools.value = [...this.lastTurnTools.value, name]
  }
  /** A refused action isn't recorded; a run that went out is, even if it failed. */
  private tookEffect(name: string, reply: string, batch: ToolBatch) {
    return (
      !!batch.sent ||
      !repliesFailure(reply ?? "", !CONTEXT_FETCH_TOOLS.has(name))
    )
  }
  /**
   * Registers an ad-hoc context item (e.g. the doc being edited in an open
   * modal). Returns an unregister function. Re-registering the same `id`
   * replaces the previous entry.
   */
  public registerContext(item: ChatContextItem): () => void {
    this.registeredContext.value = [
      ...this.registeredContext.value.filter((i) => i.id !== item.id),
      item,
    ]
    return () => {
      this.registeredContext.value = this.registeredContext.value.filter(
        (i) => i.id !== item.id
      )
    }
  }
  /**
   * Sends a user message and streams back an assistant reply.
   * @param text The user's message.
   * @param context The attached context: a snapshot, or a source re-read for
   * the pinned tab before every step so the model sees what its tools changed.
   */
  public async sendMessage(text: string, context: string | ChatContextSource) {
    const content = text.trim()
    if (!content || this.isStreaming.value) return
    const generation = ++this.turnGeneration
    const abort = new AbortController()
    this.turnAbort = abort
    // Snapshotted, not read per step: one turn is served by one connection,
    // even if the user changes the picker while the reply is still arriving.
    const selection = this.selectedModel.value
      ? { ...this.selectedModel.value }
      : undefined
    this.messages.value.push({
      id: this.nextId(),
      role: "user",
      content,
      modelContent: this.contentForModel(content),
    })
    this.isStreaming.value = true
    this.lastTurnTools.value = []
    this.lastTurnStatus.value = "idle"
    this.syncTurnTab()
    this.pinWorkspace()
    this.turnUserText = content
    const readContext = () =>
      typeof context === "function" ? context(this.turnTabId) : context
    const batch: ToolBatch = { generation, runs: null, signal: abort.signal }
    try {
      const chatFn = platform.experiments?.aiExperiments?.chat
      if (chatFn) {
        // Online: run the agentic loop, surfacing each step live.
        await this.runAgentLoop(chatFn, readContext, batch, selection)
      } else {
        // Offline fallback: a single synchronous reply.
        const id = this.pushPending()
        const startedAt = Date.now()
        const reply = await this.buildReply(content, readContext(), batch)
        if (this.isStaleTurn(generation)) return
        this.setThinkingDuration(id, startedAt)
        await this.streamText(id, reply)
        if (this.isStaleTurn(generation)) return
        this.finalizeById(id)
        this.lastTurnStatus.value = "ok"
      }
    } finally {
      // An abandoned turn must not clear the flag for whatever replaced it.
      if (!this.isStaleTurn(generation)) {
        this.isStreaming.value = false
        this.turnAbort = null
      }
    }
  }
  /** Adds an empty, pending assistant bubble (shows the "thinking" state). */
  private pushPending(): string {
    const id = this.nextId()
    this.messages.value.push({
      id,
      role: "assistant",
      content: "",
      pending: true,
    })
    return id
  }
  /** Inserts a step line just before the message with `beforeId` (else appends). */
  private pushStepBefore(beforeId: string, content: string): string {
    const id = this.nextId()
    const message: ChatMessage = {
      id,
      role: "assistant",
      content,
      kind: "tool",
    }
    const i = this.messages.value.findIndex((m) => m.id === beforeId)
    if (i === -1) this.messages.value.push(message)
    else this.messages.value.splice(i, 0, message)
    return id
  }
  /** Adds a compact "tool step" line describing one executed action. */
  private pushStep(content: string): string {
    const id = this.nextId()
    this.messages.value.push({
      id,
      role: "assistant",
      content,
      kind: "tool",
    })
    return id
  }
  /** Tracks a run just started; its watcher fills in `cancel`. */
  private trackRun(): RunStep {
    const run: RunStep = {
      stepId: null,
      awaitingStep: false,
      parked: null,
      dropped: false,
      outcome: null,
      reportLater: false,
      onOutcome: null,
      cancel: () => {},
    }
    this.liveRuns.add(run)
    return run
  }
  /** Records a run's outcome: to run_request if it still waits, else its step. */
  private finishRun(run: RunStep, text: string) {
    this.liveRuns.delete(run)
    run.outcome = text
    run.onOutcome?.(text)
    if (run.reportLater) this.settleRun(run, text)
  }
  /** Stops watching a run whose turn or conversation is gone. */
  private dropRun(run: RunStep) {
    run.dropped = true
    run.cancel()
    this.liveRuns.delete(run)
  }
  /** The run's outcome, or null after RUN_WAIT_MS or once the turn stops. */
  private awaitRunOutcome(
    run: RunStep,
    signal?: AbortSignal
  ): Promise<string | null> {
    if (run.outcome !== null) return Promise.resolve(run.outcome)
    if (signal?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const settle = (value: string | null) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        run.onOutcome = null
        resolve(value)
      }
      const onAbort = () => settle(null)
      const timer = setTimeout(onAbort, RUN_WAIT_MS)
      signal?.addEventListener("abort", onAbort)
      run.onOutcome = settle
    })
  }
  /**
   * Waits for a started run so its outcome is the tool result. A run still
   * going after RUN_WAIT_MS says so, and settles its step line later. One
   * that isn't awaited (a subscription) settles its step line from the start.
   */
  private async runReply(
    run: RunStep,
    batch: ToolBatch,
    running: string,
    wait = true
  ): Promise<string> {
    const outcome = wait
      ? await this.awaitRunOutcome(run, batch.signal)
      : run.outcome
    if (outcome !== null) return outcome
    if (this.isStaleTurn(batch.generation)) {
      this.dropRun(run)
      return SENT_BEFORE_STOP
    }
    run.reportLater = true
    run.awaitingStep = !!batch.runs
    batch.runs?.push(run)
    return wait
      ? `${running} No response after ${RUN_WAIT_MS / 1000}s yet.`
      : running
  }
  /**
   * Settles a run's "▶ Running…" step line with its outcome, in place. Falls
   * back to a fresh step message when the line is gone (offline path).
   */
  private settleRun(run: RunStep, text: string) {
    if (run.dropped) return
    if (run.awaitingStep) {
      run.parked = text
      return
    }
    const msg = run.stepId
      ? this.messages.value.find((m) => m.id === run.stepId)
      : undefined
    if (msg) {
      const updated = msg.content.replace(/^▶ .*$/m, text)
      if (updated !== msg.content) {
        msg.content = updated
        return
      }
    }
    void this.postAssistantMessage(text, "tool")
  }
  /** Hands a batch's runs their step line and flushes outcomes parked meanwhile. */
  private releaseRuns(runs: RunStep[], stepId: string | null) {
    for (const run of runs) {
      run.stepId = stepId
      run.awaitingStep = false
      const parked = run.parked
      run.parked = null
      if (parked !== null) this.settleRun(run, parked)
    }
  }
  /** Clears the pending flag on a message, by id. */
  private finalizeById(id: string) {
    const i = this.messages.value.findIndex((m) => m.id === id)
    if (i !== -1) this.messages.value[i].pending = false
  }
  /** Stamps how long a pending message "thought" before its reply arrived. */
  private setThinkingDuration(id: string, startedAt: number) {
    const i = this.messages.value.findIndex((m) => m.id === id)
    if (i !== -1) this.messages.value[i].thinkingMs = Date.now() - startedAt
  }
  /** Removes a still-empty pending placeholder (a step produced no text). */
  private dropPlaceholder(id: string) {
    const i = this.messages.value.findIndex((m) => m.id === id)
    const m = this.messages.value[i]
    if (m && m.pending && !m.content) this.messages.value.splice(i, 1)
  }
  /**
   * Drives the agentic tool-use loop against the backend chat endpoint, showing
   * each step live: the model's text streams into a bubble, and every tool it
   * runs is appended as a compact step line. Tool calls execute locally against
   * the pinned tab and the surrounding workspace, and their results are fed
   * back, so the model can take further (dependent) steps — until it stops
   * calling tools or hits the step cap.
   */
  private async runAgentLoop(
    chatFn: ChatFn,
    readContext: () => string,
    batch: ToolBatch,
    selection?: AIChatSelection
  ) {
    const { generation, signal } = batch
    // Working transcript in model format. Each step appends the assistant's
    // tool_use turn and our tool_result turn (real Anthropic round-trips).
    const working: ChatRequestMessage[] = this.sanitizeHistory(
      this.messages.value
    )
    // This turn's tool outcomes, told to the model if the turn then fails,
    // stops or hits the step cap.
    const ran: RanOutcome[] = []
    this.turnRan = { generation, outcomes: ran }
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      // Re-read every step: the last one may have opened, edited or run a
      // request, and the model must reason over that, not the turn's start.
      const context = redactSensitiveChatValues(readContext())
      const pendingId = this.pushPending()
      const stepStartedAt = Date.now()
      const result = await chatFn(working, context, selection, { signal })
      if (this.isStaleTurn(generation)) return
      // A stop the platform reports rather than the stale check (defensive).
      if (E.isLeft(result) && result.left === "ABORTED") {
        this.dropPlaceholder(pendingId)
        return
      }
      if (E.isLeft(result)) {
        const i = this.messages.value.findIndex((m) => m.id === pendingId)
        if (i !== -1) {
          const notice = this.messages.value[i]
          notice.content = this.describeChatError(result.left)
          notice.pending = false
          notice.kind = "error"
          // The model gets what already ran, not the notice: a retry
          // continues rather than repeats it.
          notice.modelContent = this.failedTurnNote(result.left, ran)
        }
        this.lastTurnStatus.value = "error"
        // The chosen model is gone, or the assistant was switched off.
        // Clearing the chat cannot fix either, so re-read what the server
        // offers: the picker settles, or the launcher goes.
        if (
          result.left === "MODEL_UNAVAILABLE" ||
          result.left === "CHAT_DISABLED"
        ) {
          void this.loadAvailability()
        }
        return
      }
      const {
        content,
        tool_calls,
        usage,
        model,
        assistant_content,
        loaded_tools,
      } = result.right
      if (usage) {
        // A missing counter is reported as such rather than as zero, so a
        // provider that does not cache is not mistaken for one whose cache
        // never warms.
        const count = (value?: number) => value ?? "n/a"
        console.debug(
          `[AIChat] step ${step + 1}${model ? ` (${model})` : ""}: in=${count(usage.input_tokens)} cache_read=${count(usage.cache_read_input_tokens)} cache_write=${count(usage.cache_creation_input_tokens)} out=${count(usage.output_tokens)}`
        )
      }
      // The model searched for (and loaded) extra tools — show that as a
      // step so the extra wait is visible and explained, in user terms.
      if (loaded_tools?.length) {
        const used = loaded_tools.filter((name) =>
          tool_calls.some((c) => c.name === name)
        )
        const families = describeToolFamilies(used.length ? used : loaded_tools)
        this.pushStepBefore(
          pendingId,
          families.length
            ? `🔎 Loaded tools for ${families.join(", ")}.`
            : "🔎 Loaded additional tools."
        )
      }
      // Stream the model's text for this step into its bubble (or drop the
      // placeholder if this step was tool-only). The thinking duration is
      // stamped first so the indicator settles into a "Thought for …" note
      // the moment tokens start.
      if (content) {
        this.setThinkingDuration(pendingId, stepStartedAt)
        await this.streamText(pendingId, content)
        if (this.isStaleTurn(generation)) return
        this.finalizeById(pendingId)
      } else {
        this.dropPlaceholder(pendingId)
      }
      // No tool calls → the text above is the final reply.
      if (!tool_calls.length) {
        this.lastTurnStatus.value = "ok"
        return
      }
      // Echo the assistant's turn so the next round has full context. Prefer
      // the provider's own blocks: they include the tool-search results that
      // keep discovered tools loaded for the rest of this turn.
      if (assistant_content?.length) {
        working.push({ role: "assistant", content: assistant_content })
      } else {
        const assistantBlocks: ChatContentBlock[] = []
        if (content) assistantBlocks.push({ type: "text", text: content })
        for (const call of tool_calls) {
          assistantBlocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.input,
          })
        }
        working.push({ role: "assistant", content: assistantBlocks })
      }
      // Execute the calls, show each as a step, and feed the results back.
      if (this.isStaleTurn(generation)) return
      // Runs this batch leaves running; each settles its own ▶ line later.
      const runs: RunStep[] = []
      const { replies, toolResults, outcomes } = await this.executeToolCalls(
        tool_calls,
        generation,
        runs,
        signal
      )
      if (this.isStaleTurn(generation)) {
        for (const run of runs) this.dropRun(run)
        // A request already sent must not vanish behind "■ Stopped.".
        this.reportStoppedBatch(generation, replies, outcomes)
        return
      }
      ran.push(...outcomes)
      // Blank line between replies: each tool's reply owns its own step, so
      // one that carries no status glyph cannot inherit the previous icon.
      const stepId = replies.length ? this.pushStep(replies.join("\n\n")) : null
      // A run started in this batch reports back into this step line.
      this.releaseRuns(runs, stepId)
      working.push({ role: "user", content: toolResults })
    }
    // Step cap reached — the turn still did useful work, but the model never
    // got to wrap up; say so instead of ending on a bare step line. The model
    // never sees step lines, so it gets what ran: "continue" must not redo it.
    const capped = `I stopped after ${MAX_TOOL_STEPS} tool steps`
    const lead = `[${capped} before finishing. `
    const capId = this.nextId()
    // A Stop while it types keeps this reply, and so its list.
    if (this.turnRan?.generation === generation) this.turnRan.listedIn = capId
    await this.postAssistantMessage(
      `${capped}. The actions above were applied — ask me to continue if something is still missing.`,
      undefined,
      `${lead}${this.outcomesNote("These already ran; don't redo them:", ran, MAX_OLD_ASSISTANT_CHARS - lead.length - 20)}]`,
      capId
    )
    if (this.isStaleTurn(generation)) return
    this.lastTurnStatus.value = "ok"
  }
  /** Maps a platform chat error code to something the user can act on. */
  private describeChatError(code: string): string {
    const key = CHAT_ERROR_KEYS.get(code) ?? "cannot_run_chat"
    return `⚠️ ${this.t(`ai_experiments.chat.errors.${key}`)}`
  }
  /** What the model reads for a failed turn: the error and what already ran. */
  private failedTurnNote(code: string, ran: RanOutcome[]): string {
    const key = CHAT_ERROR_KEYS.get(code) ?? "cannot_run_chat"
    const head = `[The last reply failed (${key}) before finishing`
    if (!ran.length) return `${head}; no tool ran.]`
    const lead = `${head}. `
    // Fits whole: older assistant turns are cut at MAX_OLD_ASSISTANT_CHARS.
    return `${lead}${this.outcomesNote("These already ran; on a retry, don't redo them:", ran, MAX_OLD_ASSISTANT_CHARS - lead.length - 20)}]`
  }
  /**
   * Executes one model turn's tool calls against the active request and returns
   * the human-readable confirmations plus the matching tool_result blocks to
   * send back. Request-field edits are applied (and committed) before app
   * actions in model-emitted order, refreshing the active tab before each one.
   */
  private async executeToolCalls(
    toolCalls: ChatToolCall[],
    generation: number,
    runs: RunStep[] | null = null,
    signal?: AbortSignal
  ): Promise<{
    replies: string[]
    toolResults: ChatContentBlock[]
    /** Each call that ran, in order: for a failed, stopped or capped turn. */
    outcomes: RanOutcome[]
  }> {
    const batch: ToolBatch = { generation, runs, signal }
    // What the user sees per tool vs what the model gets back.
    const replyById = new Map<string, string>()
    const resultById = new Map<string, string>()
    /** Calls whose result must travel back flagged as an error. */
    const failedCalls = new Set<string>()
    const outcomes: RanOutcome[] = []
    for (const call of toolCalls) {
      // Abandoned mid-batch: stop before touching the workspace again.
      if (this.isStaleTurn(generation)) break
      batch.sent = false
      // Environment tools resolve `<<local-ref:…>>` themselves (and insist the
      // target is a secret variable). Every other tool gets the real value —
      // it never leaves the client, and the echo below is masked again.
      const resolved = new Map<string, string>()
      const input = ENV_VARIABLE_TOOLS.has(call.name)
        ? call.input
        : call.name === "set_collection_properties"
          ? {
              // Auth/header values get the real credential; the variables
              // keep their references so toEnvVars can insist on secret:true.
              ...(this.resolveLocalSecrets(
                { ...call.input, variables: undefined },
                resolved
              ) as Record<string, unknown>),
              variables: call.input.variables,
            }
          : (this.resolveLocalSecrets(call.input, resolved) as Record<
              string,
              unknown
            >)
      let reply = ""
      let threw = false
      try {
        if (this.writesRedacted(call, input)) {
          reply = REDACTED_INPUT_REPLY
        } else if (
          APP_ACTION_TOOLS.has(call.name) &&
          !WORKSPACE_FREE_TOOLS.has(call.name) &&
          this.workspaceMoved()
        ) {
          reply = WORKSPACE_MOVED_REPLY
        } else if (APP_ACTION_TOOLS.has(call.name)) {
          // Recorded on this batch: a stopped turn's tool that finishes late
          // must not move this turn's pins.
          batch.activatedTabId = null
          batch.switchedWorkspace = false
          reply = await this.runAppAction(
            call.name,
            input,
            this.getActiveRequest(),
            batch
          )
          // This turn's own switch moves the workspace pin with it.
          if (batch.switchedWorkspace && !this.isStaleTurn(generation)) {
            this.pinWorkspace()
          }
          // Follow a tab the tool activated. Otherwise the pin stays put, even
          // if the user browsed elsewhere while a long tool ran.
          const activated = batch.activatedTabId
          if (activated) {
            await nextTick()
            // A call that was already in flight when the turn was abandoned
            // must not re-pin the tab for the turn that replaced it.
            if (!this.isStaleTurn(generation)) this.turnTabId = activated
          }
        } else if (!this.isRequestFieldTool(call.name)) {
          reply = `⚠️ Unknown tool${call.name ? ` \`${call.name.replace(/`/g, "")}\`` : ""} — nothing changed.`
        } else if (!this.onWorkspacePage()) {
          reply = OFF_WORKSPACE_REPLY
        } else if (this.turnTabClosed()) {
          reply = TAB_CLOSED_REPLY
        } else {
          const active = this.getActiveRequest()
          const gqlActive = active ? null : this.getActiveGQLRequest()
          const edited = active?.request ?? gqlActive?.request
          const before = edited ? this.runSurface(edited) : null
          const varsBefore =
            active?.request.requestVariables.map((v) => ({ ...v })) ?? []
          const res = active
            ? applyToolCall(active.request, call.name, input)
            : applyGQLToolCall(gqlActive?.request ?? null, call.name, input)
          if (res.changed && edited && before) {
            this.noteEditRisks(before, this.runSurface(edited))
          }
          if (res.changed && call.name === "add_or_update_request_variables")
            this.noteVariableWrites(
              (Array.isArray(input.variables) ? input.variables : []).map(
                (v: { key?: unknown; value?: unknown }) => ({
                  key: String(v?.key ?? ""),
                  value: String(v?.value ?? ""),
                })
              ),
              varsBefore
            )
          if (res.changed) {
            if (active) {
              active.commit()
            } else if (gqlActive) {
              gqlActive.commit()
              if (call.name === "set_query") {
                this.moveGQLCursorToOperation(
                  gqlActive.request.query,
                  undefined,
                  "last"
                )
              }
            }
          }
          reply = res.reply
        }
      } catch (e) {
        // One failing tool must not abort the turn with no trace of it.
        console.error(`[AIChat] tool "${call.name}" failed:`, e)
        threw = true
        reply = `⚠️ ${call.name} failed: ${e instanceof Error ? e.message : "unexpected error"}`
      }
      // Any credential the conversation resolved goes back as its reference,
      // not only this call's: a tool may echo one an earlier call wrote.
      const masked = this.maskLocalSecrets(
        this.maskResolvedSecrets(reply || "Done.", resolved)
      )
      resultById.set(call.id, masked)
      // A tool that failed or refused has to say so in the RESULT, not only in
      // the prose beside it: a weaker model reads a success-shaped result as
      // proof the action happened. The step glyph is the vocabulary for this,
      // so the parser decides. Context tools are the one exception — their
      // unmarked payload IS the success.
      if (
        threw ||
        repliesFailure(masked, !CONTEXT_FETCH_TOOLS.has(call.name))
      ) {
        failedCalls.add(call.id)
      }
      // Context tools show a short line instead of the payload — but a notice
      // or error must stay visible to the user.
      const short = CONTEXT_FETCH_TOOLS.get(call.name)
      replyById.set(
        call.id,
        short && masked.startsWith("### ") ? short : masked
      )
      // A 500 or a failing test still went out: a retry mustn't resend it.
      const failed = failedCalls.has(call.id) && !batch.sent
      outcomes.push({ line: ranLine(call.name, masked, short), failed })
      // Follow-up chips read only what took effect.
      if (!failed && !this.isStaleTurn(generation)) {
        this.recordTool(call.name)
        if (
          call.name === "add_or_update_collection_requests" &&
          !upsertWritesTests(input.requests)
        ) {
          this.recordTool(COLLECTION_UNTESTED)
        }
      }
    }
    const replies = toolCalls
      .map((c) => replyById.get(c.id) ?? "")
      .filter(Boolean)
    const toolResults: ChatContentBlock[] = toolCalls.map((c) => {
      const result = resultById.get(c.id) ?? "Done."
      const cap = CONTEXT_FETCH_TOOLS.has(c.name)
        ? MAX_CONTEXT_RESULT_CHARS
        : MAX_TOOL_RESULT_CHARS
      return {
        type: "tool_result",
        tool_use_id: c.id,
        content:
          result.length > cap
            ? `${result.slice(0, surrogateSafeCut(result, cap))}…`
            : result,
        ...(failedCalls.has(c.id) ? { is_error: true } : {}),
      }
    })
    return { replies, toolResults, outcomes }
  }
  /**
   * Whether a call writes a `[REDACTED]` copied from the sanitized context.
   * One the edited field already holds (a test asserting masking) is the
   * user's own text, so an edit that keeps it goes through.
   */
  private writesRedacted(
    call: ChatToolCall,
    input: Record<string, unknown>
  ): boolean {
    if (!redactedCount(call.input)) return false
    const active = this.getActiveRequest()
    const request = (active ?? this.getActiveGQLRequest())?.request
    if (this.isRequestFieldTool(call.name)) {
      // No request, no write: the edit path says so.
      if (!request) return false
      // Dry-run on a copy: only markers the edit adds are copied ones.
      const draft = JSON.parse(JSON.stringify(request))
      const res = active
        ? applyToolCall(draft, call.name, input)
        : applyGQLToolCall(draft, call.name, input)
      return !!res.changed && redactedCount(draft) > redactedCount(request)
    }
    if (call.name === "set_request_description" && !call.input?.request) {
      return (
        redactedCount(String(call.input?.description ?? "")) >
        redactedCount(request?.description ?? "")
      )
    }
    return true
  }
  /**
   * Swaps every `<<local-ref:id>>` in a tool input for the credential the user
   * typed, recording each substitution so the tool's reply can be masked.
   * Unknown references are left in place.
   */
  private resolveLocalSecrets(
    value: unknown,
    resolved: Map<string, string>
  ): unknown {
    if (typeof value === "string") {
      return value.replace(LOCAL_SECRET_REFERENCE_GLOBAL, (match, id) => {
        const secret = this.localSecretValues.get(id)
        if (secret === undefined) return match
        resolved.set(match, secret)
        return secret
      })
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.resolveLocalSecrets(entry, resolved))
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          this.resolveLocalSecrets(entry, resolved),
        ])
      )
    }
    return value
  }
  /** Puts the opaque references back before text is echoed to the model. */
  private maskResolvedSecrets(
    text: string,
    resolved: Map<string, string>
  ): string {
    let out = text
    for (const [reference, secret] of resolved) {
      if (secret) out = out.split(secret).join(reference)
    }
    return out
  }
  /**
   * Builds an Anthropic-valid conversation history from the thread: drops empty
   * and still-streaming messages, keeps the most recent `MAX_HISTORY_MESSAGES`,
   * ensures it starts with a user turn, and merges consecutive same-role turns
   * (e.g. a reply followed by its async run-outcome) — the API requires roles to
   * alternate, so this is what gives the assistant memory of the session.
   */
  private sanitizeHistory(messages: ChatMessage[]): {
    role: ChatRole
    content: string
  }[] {
    const out: {
      role: ChatRole
      content: string
    }[] = []
    // Count only what the model will see: step lines, error notices, and
    // pending placeholders are UI artifacts and must not eat the window. A
    // step or notice with its own modelContent (a Stop, a failed turn's
    // note) is meant for the model.
    const visible = messages.filter(
      (m) =>
        !m.pending &&
        (!m.kind || m.modelContent !== undefined) &&
        (m.modelContent ?? m.content).trim()
    )
    const recent = visible.slice(-MAX_HISTORY_MESSAGES)
    const newest = recent[recent.length - 1]
    for (const m of recent) {
      let content = (m.modelContent ?? m.content).trim()
      // Older turns are context, not the task: keep them bounded. The newest
      // (the message being answered) always goes through intact.
      if (m !== newest) {
        content = truncateForHistory(
          content,
          m.role === "user" ? MAX_OLD_USER_CHARS : MAX_OLD_ASSISTANT_CHARS
        )
      }
      // The conversation must start with a user message.
      if (out.length === 0 && m.role !== "user") continue
      const last = out[out.length - 1]
      if (last && last.role === m.role) {
        last.content += `\n\n${content}`
      } else {
        out.push({ role: m.role, content })
      }
    }
    // Drop the oldest exchanges until the whole history fits the budget,
    // always keeping the newest user turn.
    let total = out.reduce((n, m) => n + m.content.length, 0)
    while (out.length > 1 && total > MAX_HISTORY_CHARS) {
      total -= out[0].content.length
      out.shift()
      // Keep the user-first invariant after trimming.
      while (out.length > 1 && out[0].role !== "user") {
        total -= out[0].content.length
        out.shift()
      }
    }
    return out
  }
  /**
   * Offline fallback (no backend): interprets a few request-editing commands
   * locally and otherwise returns a short guidance message.
   */
  private async buildReply(
    userText: string,
    contextString: string,
    batch: ToolBatch
  ): Promise<string> {
    // Off the workspace page its tabs are hidden, so none is edited.
    let active = this.onWorkspacePage() ? this.getActiveRequest() : null
    // The regex parsers are not built for essays — bound their input.
    if (userText.length > MAX_OFFLINE_COMMAND_LENGTH) {
      return "That message is too long for the offline command parser. Send a shorter command, e.g. `set url to https://…`."
    }
    // Chained commands, e.g. "open a new tab and run the request". Body edits
    // are freeform, so a message that sets a body is never split.
    const segments = /\bbody\b/i.test(userText)
      ? [userText]
      : splitCommands(userText)
    if (segments.length > 1) {
      const replies: string[] = []
      let changed = false
      let handledAny = false
      for (const segment of segments) {
        const appAction = parseAppActionCommand(segment)
        if (appAction) {
          // Persist pending edits before an app action reads/runs the request.
          if (changed && active) {
            active.commit()
            changed = false
          }
          handledAny = true
          batch.sent = false
          batch.activatedTabId = null
          const reply = await this.runAppAction(
            appAction.name,
            appAction.input,
            active,
            batch
          )
          if (this.tookEffect(appAction.name, reply, batch)) {
            this.recordTool(appAction.name)
          }
          if (reply) replies.push(reply)
          // Later segments act on the tab this one opened.
          const activated = batch.activatedTabId
          if (activated) {
            await nextTick()
            if (this.isStaleTurn(batch.generation)) break
            this.turnTabId = activated
            active = this.onWorkspacePage() ? this.getActiveRequest() : null
          }
          continue
        }
        const result = runChatCommand(active?.request ?? null, segment)
        if (result.handled) {
          handledAny = true
          if (result.changed) {
            changed = true
            this.recordTool("request_edit")
          }
          if (result.reply) replies.push(result.reply)
        }
      }
      if (changed && active) active.commit()
      if (handledAny) return replies.join("\n\n")
    }
    const appAction = parseAppActionCommand(userText)
    if (appAction) {
      batch.sent = false
      const reply = await this.runAppAction(
        appAction.name,
        appAction.input,
        active,
        batch
      )
      if (this.tookEffect(appAction.name, reply, batch)) {
        this.recordTool(appAction.name)
      }
      return reply
    }
    const result = runChatCommand(active?.request ?? null, userText)
    if (result.handled) {
      if (result.changed) {
        this.recordTool("request_edit")
        if (active) active.commit()
      }
      return result.reply
    }
    return this.mockReply(contextString, !!active)
  }
  /** Returns the active REST request (+ a dirty marker), or null. */
  private getActiveRequest(): ActiveRequestHandle | null {
    const tab = this.resolveTurnTab()
    if (tab && tab.document?.type === "request") {
      const document = tab.document
      return {
        request: document.request,
        /** Reactive getter for the request's latest run response. */
        getResponse: () => document.response,
        // Reassign the request with fresh array references so the request editor
        // re-renders immediately. Mutating the nested arrays in place isn't
        // reflected until the tab is re-selected (matches ImportCurl's pattern).
        commit: () => {
          const r = document.request
          document.request = {
            ...r,
            params: [...r.params],
            headers: [...r.headers],
            requestVariables: [...r.requestVariables],
          }
          document.isDirty = true
        },
        bindToCollection: (saveContext, saved, inheritedProperties) => {
          document.request = saved
          document.saveContext = saveContext
          document.isDirty = false
          if (saveContext?.originLocation === "user-collection") {
            document.inheritedProperties = cascadeParentCollectionForProperties(
              saveContext.folderPath,
              "rest"
            )
          } else if (inheritedProperties) {
            document.inheritedProperties = inheritedProperties
          }
        },
      }
    }
    return null
  }
  /**
   * The tab this turn acts on: the pinned one while it exists, else the active
   * tab when nothing is pinned. A pin the user closed resolves to null rather
   * than silently re-pointing at another tab.
   */
  private resolveTurnTab() {
    const active = this.tabService.currentActiveTab.value
    if (!this.turnTabId || active?.id === this.turnTabId) return active
    return (
      this.tabService
        .getActiveTabs()
        .value.find((tab) => tab.id === this.turnTabId) ?? null
    )
  }
  /** True once the pinned tab was closed outside the turn's own tab tools. */
  private turnTabClosed(): boolean {
    const id = this.turnTabId
    return (
      !!id && !this.tabService.getActiveTabs().value.some((t) => t.id === id)
    )
  }
  /** Pins the turn to whatever tab is active right now. */
  private syncTurnTab() {
    this.turnTabId = this.tabService.currentActiveTab.value?.id ?? null
  }
  /** Pins the turn to the current workspace. */
  private pinWorkspace() {
    this.turnWorkspace = { ...this.workspaceService.currentWorkspace.value }
  }
  /** True once the user left the workspace this turn is pinned to. */
  private workspaceMoved(): boolean {
    const pinned = this.turnWorkspace
    if (!pinned) return false
    const ws = this.workspaceService.currentWorkspace.value
    if (ws.type !== pinned.type) return true
    return false
  }
  /** Whether `host` is one the user's message names, compared exactly. */
  private typedHost(host: string): boolean {
    return this.turnUserText
      .split(/[\s"'`()[\]{},;|]+/)
      .map((token) =>
        token
          .replace(/^<(?!<)/, "")
          .replace(/(?<!>)>$/, "")
          .replace(/[.,;:!?]+$/, "")
      )
      .some(
        (token) => /[.:]|^<<|^localhost$/i.test(token) && hostOf(token) === host
      )
  }
  /** Where a run of this request sends, with the collection scripts it inherits. */
  private runSurface(
    request: HoppRESTRequest | HoppGQLRequest,
    inherited: Array<{
      preRequestScript: string
      testScript: string
    }> = []
  ): RunSurface {
    return {
      host:
        "endpoint" in request
          ? hostOf(request.endpoint)
          : hostOf(request.url, false),
      scripts: scriptsOf([request, ...inherited]),
    }
  }
  /** The collection scripts the turn's tab runs its request with. */
  private tabInheritedScripts() {
    const document = this.resolveTurnTab()?.document
    return document && "inheritedProperties" in document
      ? (document.inheritedProperties?.scripts ?? [])
      : []
  }
  /** Records a host or script an edit to the pinned tab pointed it at. */
  private noteEditRisks(before: RunSurface, after: RunSurface) {
    // A host the user typed is their choice, not an injected one.
    if (after.host !== before.host && after.host && !this.typedHost(after.host))
      this.chatRisks.hosts.add(after.host)
    after.scripts.forEach((script, i) => {
      if (script !== before.scripts[i])
        this.noteScriptWrite(script, before.scripts[i])
    })
  }
  /**
   * Records where a script the chat wrote sends that the user never typed and
   * the user's own `previous` script didn't already send to.
   */
  private noteScriptWrite(script: string | undefined, previous = "") {
    const text = script?.trim()
    if (!text || text === previous.trim()) return
    const sends = scriptSends(text)
    // A script the chat wrote earlier is no baseline.
    const had = this.chatRisks.scripts.has(previous.trim())
      ? []
      : scriptSends(previous).hosts
    const risks = [
      ...sends.hosts.filter(
        (host) => !had.includes(host) && !this.typedHost(host)
      ),
      // Any edit can move a send only a run can place, so none is a baseline.
      ...(sends.unknown ? [`${OPAQUE_SEND}${text}`] : []),
    ]
    if (!risks.length) return
    const known = this.chatRisks.scripts.get(text) ?? []
    this.chatRisks.scripts.set(text, [...new Set([...known, ...risks])])
  }
  /** Where chat-written scripts among these send unasked. */
  private scriptRisks(scripts: string[]): string[] {
    return scripts.flatMap(
      (script) => this.chatRisks.scripts.get(script.trim()) ?? []
    )
  }
  /** Risks as a prompt names them: a host, or a script's unknown address. */
  private riskLabels(risks: string[]): string[] {
    return [
      ...new Set(
        risks.map((risk) =>
          risk.startsWith(OPAQUE_SEND)
            ? this.t("ai_experiments.script_unknown_host")
            : risk
        )
      ),
    ]
  }
  /**
   * Records values the chat wrote into variables, by key; one that leaves a
   * value as it was changes nothing.
   */
  private noteVariableWrites(
    written: Array<{
      key: string
      value: string
    }>,
    existing: Array<{
      key: string
      value?: string
      initialValue?: string
    }> = []
  ) {
    for (const { key, value } of written) {
      const k = key.trim().toLowerCase()
      const v = value.trim()
      if (!k || !v) continue
      const same = existing.some(
        (e) =>
          e.key.trim().toLowerCase() === k &&
          (e.value?.trim() === v || e.initialValue?.trim() === v)
      )
      if (!same) this.chatRisks.vars.set(k, v)
    }
  }
  /**
   * Where a `<<var>>` host sends once the values the chat wrote are filled
   * in, or "" when none of its variables is the chat's (or `counts` skips it).
   */
  private chatVariableHost(
    host: string,
    counts: (key: string) => boolean = () => true
  ): string {
    let wrote = false
    const resolved = host.replace(/<<([^<>]+)>>/g, (token, name: string) => {
      const key = name.trim().toLowerCase()
      const value = this.chatRisks.vars.get(key)
      if (value === undefined || !counts(key)) return token
      wrote = true
      return value
    })
    if (!wrote) return ""
    const sendsTo = hostOf(resolved)
    return sendsTo && !this.typedHost(sendsTo) ? sendsTo : ""
  }
  /**
   * New hosts that plain variable values now name, the user never typed.
   * Synced to a team, teammates' `<<var>>` requests send there.
   */
  private variableHosts(
    incoming: EnvVar[],
    existing: Array<{
      key: string
      initialValue?: string
      secret?: boolean
    }>
  ): string[] {
    const hosts = incoming.flatMap((v) => {
      const old = existing.find((e) => e.key.trim() === v.key.trim())
      // A secret stays local, and a plain value can't overwrite one.
      if (v.secret || old?.secret) return []
      const before = old?.initialValue ?? ""
      // A bare host counts where the key or old value says it is one.
      const bare = isURLKey(v.key) || valueHost(before, false) !== ""
      const host = valueHost(v.initialValue, bare)
      return host && host !== valueHost(before, bare) && !this.typedHost(host)
        ? [host]
        : []
    })
    return [...new Set(hosts)]
  }
  /** Records a host an upserted collection request, or its script, now sends to. */
  private noteUpsertRisk(
    definition: CollectionRequestDefinition,
    existing?: HoppRESTRequest
  ) {
    const host = hostOf(definition.url)
    if (
      host &&
      host !== hostOf(existing?.endpoint ?? "") &&
      !this.typedHost(host)
    )
      this.chatRisks.hosts.add(host)
    this.noteScriptWrite(
      definition.preRequestScript,
      existing?.preRequestScript
    )
    this.noteScriptWrite(definition.testScript, existing?.testScript)
  }
  /**
   * Hosts an upsert would save into a collection whose requests send
   * elsewhere, that the user never typed. A new, empty collection has nothing
   * to redirect yet (a run still asks); a bare `<<var>>` host is the
   * environment's choice.
   */
  private upsertHosts(
    definitions: CollectionRequestDefinition[],
    saved: Array<
      | {
          endpoint: string
        }
      | undefined
    >
  ): string[] {
    const known = new Set(
      saved.map((r) => hostOf(r?.endpoint ?? "")).filter(Boolean)
    )
    if (!known.size) return []
    return [
      ...new Set(
        definitions
          .map((d) => hostOf(d.url))
          .filter(
            (host) =>
              host &&
              !known.has(host) &&
              !/^<<[^<>]+>>$/.test(host) &&
              !this.typedHost(host)
          )
      ),
    ]
  }
  /** Run surfaces of every request in a collection tree, and its scripts. */
  private collectionSurfaces(collection: HoppCollection): RunSurface[] {
    return [
      { host: "", scripts: scriptsOf([collection]) },
      ...(collection.requests ?? []).map((r) =>
        this.runSurface(r as HoppRESTRequest | HoppGQLRequest)
      ),
      ...(collection.folders ?? []).flatMap((f) => this.collectionSurfaces(f)),
    ]
  }
  /**
   * Asks before a run that sends to a host the chat chose and the user never
   * typed, in the URL, for a `<<var>>` host in a variable, or in a script it
   * wrote. Read from the requests themselves, so a duplicate or a later turn
   * still asks. Null means go ahead.
   */
  private async confirmRun(
    name: string,
    surfaces: RunSurface[],
    generation: number
  ): Promise<string | null> {
    const unapproved = (host: string) => !this.chatRisks.runApproved.has(host)
    const hosts = surfaces.flatMap(({ host, scripts }) => [
      this.chatRisks.hosts.has(host) ? host : this.chatVariableHost(host),
      ...this.scriptRisks(scripts),
    ])
    const asked = [...new Set(hosts)].filter((host) => host && unapproved(host))
    if (!asked.length) return null
    const labels = this.riskLabels(asked)
    if (!(await this.confirm("run", name, generation, { hosts: labels }))) {
      // The edit stays: a manual Send or save would still go there.
      return `⚠️ You declined the run — nothing was sent. It still points at ${labels
        .map((h) => `**${h}**`)
        .join(", ")}.`
    }
    // Approved: the same hosts don't ask twice for a run. A save still does.
    for (const host of asked) this.chatRisks.runApproved.add(host)
    return null
  }
  /** Where the chat pointed this request or its scripts, if a save would persist it. */
  private chatWritesIn(request: HoppRESTRequest | HoppGQLRequest): string[] {
    const { host, scripts } = this.runSurface(request)
    const viaScripts = this.scriptRisks(scripts)
    if (this.chatRisks.hosts.has(host)) return [host, ...viaScripts]
    // Its own variables are saved with it; environment ones are not.
    const own = new Map(
      ("requestVariables" in request ? request.requestVariables : []).map(
        (v) => [v.key.trim().toLowerCase(), v.value.trim()]
      )
    )
    const viaVariable = this.chatVariableHost(
      host,
      (key) => own.get(key) === this.chatRisks.vars.get(key)
    )
    return viaVariable ? [viaVariable, ...viaScripts] : viaScripts
  }
  /**
   * Asks before persisting a host the chat chose: saved, requests send there
   * for everyone who later runs them. An approval covers this target only; a
   * run approval covers none. Null means go ahead.
   */
  private async confirmSave(
    target: SaveTarget,
    written: string[],
    generation: number
  ): Promise<string | null> {
    const approvalKey = (host: string) => `${target.key}\0${host}`
    const hosts = [...new Set(written)].filter(
      (h) => !this.chatRisks.saveApproved.has(approvalKey(h))
    )
    if (!hosts.length) return null
    const approved = await this.confirm("save", target.name, generation, {
      hosts: this.riskLabels(hosts),
      workspace: target.workspace,
    })
    if (!approved) {
      return `Didn't save the new host to **${target.name}** — nothing changed.`
    }
    // Saved, it sends there anyway: the same hosts don't ask for a run either.
    for (const host of hosts) {
      this.chatRisks.saveApproved.add(approvalKey(host))
      this.chatRisks.runApproved.add(host)
    }
    return null
  }
  /** A personal collection's save-approval key, by identity. */
  private personalCollectionKey(found: {
    collection: HoppCollection
    path: string
  }): string {
    const c = found.collection
    return `user-coll:${c._ref_id ?? c.id ?? found.path}`
  }
  /**
   * Where save_request writes a bound tab, and that binding's workspace: a
   * team tab outlives a switch to Personal, so the current one can mislead.
   */
  private savedRequestTarget(
    saveContext: NonNullable<HoppTabSaveContext>,
    name: string
  ): SaveTarget {
    return {
      key: `user-req:${saveContext.folderPath}/${saveContext.requestRefID ?? saveContext.requestIndex}`,
      name,
      workspace: null,
    }
  }
  /** " — `METHOD url`" for the request a tab holds, so a result says what opened. */
  private describeTabRequest(tabId?: string | null): string {
    const tab = tabId
      ? this.tabService.getActiveTabs().value.find((t) => t.id === tabId)
      : this.tabService.currentActiveTab.value
    const doc = tab?.document
    const line =
      doc?.type === "request"
        ? `${doc.request.method} ${doc.request.endpoint || "(no URL)"}`
        : doc?.type === "gql-request"
          ? `GraphQL ${doc.request.url || "(no URL)"}`
          : ""
    return line
      ? ` — \`${redactSensitiveChatValues(line).replace(/`/g, "")}\``
      : ""
  }
  /** Activates a tab for a tool; the batch's pin follows it. */
  private activateTab(id: string, batch: ToolBatch) {
    this.tabService.setActiveTab(id)
    batch.activatedTabId = id
  }
  /** Records the tab a page action just activated, for the pin to follow. */
  private followActiveTab(batch: ToolBatch) {
    batch.activatedTabId = this.tabService.currentActiveTab.value?.id ?? null
  }
  /**
   * Brings the pinned tab to the front before an action whose handler acts on
   * the ACTIVE tab (run, save, close, switch protocol…).
   */
  private focusTurnTab() {
    const tab = this.resolveTurnTab()
    if (tab && this.tabService.currentActiveTab.value?.id !== tab.id) {
      this.tabService.setActiveTab(tab.id)
    }
  }
  /**
   * Focuses the pinned tab and waits for its pane to render: run/save
   * handlers bind on mount and read props, so the same tick hits stale ones.
   */
  private async bringTurnTabToFront(): Promise<boolean> {
    const tab = this.resolveTurnTab()
    if (!tab) return false
    this.focusTurnTab()
    await nextTick()
    return this.tabService.currentActiveTab.value?.id === tab.id
  }
  /** Waits for a save to clear the dirty flag; stops early if the binding is dropped. */
  private async awaitSaved(document: {
    isDirty: boolean
    saveContext?: HoppTabSaveContext
  }): Promise<boolean> {
    const started = Date.now()
    while (
      document.isDirty &&
      document.saveContext &&
      Date.now() - started < SAVE_TIMEOUT_MS
    ) {
      await delay(50)
    }
    return !document.isDirty
  }
  /** Whether `name` is a request-field edit tool (probed on a throwaway request). */
  private isRequestFieldTool(name: string): boolean {
    return applyToolCall(getDefaultRESTRequest(), name, {}).handled
  }
  /**
   * Whether the unified workspace page is mounted — only it binds
   * `rest.request.open`. Elsewhere its tabs exist but are hidden.
   */
  private onWorkspacePage(): boolean {
    return isActionBound("rest.request.open").value
  }
  /** A tab tool that would act on a hidden workspace tab off-page. */
  private needsWorkspacePage(name: string, args: Record<string, unknown>) {
    return (
      !this.onWorkspacePage() &&
      (WORKSPACE_PAGE_TOOLS.has(name) ||
        (name === "set_request_description" && !args.request))
    )
  }
  /**
   * Reply for an app action the workspace page can't take right now. Other
   * pages (/graphql, /realtime) bind the same action names, so the page itself
   * must be mounted.
   */
  private unavailableReply(
    action: HoppAction | null,
    what: string
  ): string | null {
    return this.onWorkspacePage() && (!action || isActionBound(action).value)
      ? null
      : `${what} isn't available on this page — open the REST/GraphQL workspace first.`
  }
  /**
   * Brings the pinned tab to the front, then checks its pane binds `action`:
   * a runner or example tab in front binds neither run nor save.
   */
  private async frontPaneReply(
    action: HoppAction,
    what: string,
    notInFront: string
  ): Promise<string | null> {
    if (!(await this.bringTurnTabToFront())) return notInFront
    return this.unavailableReply(action, what)
  }
  /** Named operations in a GraphQL document, or null when it doesn't parse. */
  private listGQLOperations(query: string): string[] | null {
    try {
      return parseGQLDocument(query)
        .definitions.filter(
          (d): d is OperationDefinitionNode => d.kind === "OperationDefinition"
        )
        .map((o) => o.name?.value ?? "")
        .filter(Boolean)
    } catch (_e) {
      return null
    }
  }
  /** The type of the operation a run executes: the named one, else the first. */
  private gqlOperationType(query: string, operationName?: string) {
    try {
      const operations = parseGQLDocument(query).definitions.filter(
        (d): d is OperationDefinitionNode => d.kind === "OperationDefinition"
      )
      const target =
        (operationName
          ? operations.find((o) => o.name?.value === operationName)
          : undefined) ?? operations[0]
      return target?.operation ?? null
    } catch (_e) {
      return null
    }
  }
  /**
   * Points the visible GQL query editor's cursor at an operation — the named
   * one, else the first/last per `fallback` — so the UI shows which operation
   * the chat is acting on (and cursor-driven affordances line up with it).
   */
  private moveGQLCursorToOperation(
    query: string,
    operationName: string | undefined,
    fallback: "first" | "last"
  ) {
    try {
      const operations = parseGQLDocument(query).definitions.filter(
        (d): d is OperationDefinitionNode => d.kind === "OperationDefinition"
      )
      if (!operations.length) return
      const target =
        (operationName
          ? operations.find((o) => o.name?.value === operationName)
          : undefined) ??
        (fallback === "first"
          ? operations[0]
          : operations[operations.length - 1])
      const offset = target.loc?.start
      if (offset === undefined) return
      const before = query.slice(0, offset)
      const line = (before.match(/\n/g) ?? []).length
      const ch = offset - (before.lastIndexOf("\n") + 1)
      // Pinned to the turn's tab: the user may have switched tabs meanwhile.
      const tabId = this.resolveTurnTab()?.id
      if (!tabId) return
      this.gqlQueryBuilder.moveCursorTo(line, ch, tabId)
    } catch (_e) {
      // Unparseable query — leave the cursor where it is.
    }
  }
  /** Returns the active GraphQL request (unified workspace tab), or null. */
  private getActiveGQLRequest(): ActiveGQLRequestHandle | null {
    const tab = this.resolveTurnTab()
    if (tab && tab.document?.type === "gql-request") {
      const document = tab.document
      return {
        request: document.request,
        /** Reactive getter for the tab's run/subscription event stream. */
        getEvents: () => document.response,
        commit: () => {
          const r = document.request
          document.request = {
            ...r,
            headers: [...r.headers],
          }
          document.isDirty = true
        },
      }
    }
    return null
  }
  private mockReply(contextString: string, hasRequest: boolean): string {
    return [
      "_(The AI backend isn't connected yet, so for now I can directly edit the open request. Try:)_",
      "- add header `Authorization: Bearer <token>`",
      "- add param `page=1, limit=20`",
      "- set method to `POST`",
      "- set url to `https://api.example.com`",
      '- set body to `{"name":"hopp"}`',
      "- set pre-request / test script",
      "- rename the request",
      "- save the request",
      "- run the request",
      "- new tab · close tab · next tab",
      "- switch interceptor to `<name>`",
      "- create / switch environment `<name>`",
      "- add env variable `baseUrl=https://api.example.com`",
      "- create collection `<name>` · save the request into `<collection>`",
      "- open request `<name>` from `<collection>`",
      "- chain steps: `set method to POST and run the request`",
      hasRequest ? "" : "\n_Open a request tab first so I can edit it._",
      contextString ? "\n**Context I can see:**\n\n" + contextString : "",
    ]
      .filter(Boolean)
      .join("\n")
  }
  /**
   * Executes an "app action" chat tool — running, saving, tab management, or
   * interceptor selection — and returns a short confirmation. Request-field
   * edits are handled separately by `applyToolCall`.
   */
  private async runAppAction(
    name: string,
    input: Record<string, unknown> | null | undefined,
    active: ActiveRequestHandle | null,
    batch: ToolBatch
  ): Promise<string> {
    const args = input ?? {}
    const usesTurnTab =
      TURN_TAB_TOOLS.has(name) ||
      (name === "set_request_description" && !args.request)
    if (this.needsWorkspacePage(name, args)) return OFF_WORKSPACE_REPLY
    if (usesTurnTab && this.turnTabClosed()) return TAB_CLOSED_REPLY
    // The unified workspace's GQL tabs bind the same run/save actions the
    // REST pane does, so both request types are runnable/saveable from chat.
    const gqlActive = active ? null : this.getActiveGQLRequest()
    switch (name) {
      case "run_request": {
        if (!active && !gqlActive) {
          return "Open a request tab first so I can run it."
        }
        // Only the front tab's pane binds the action: check it once ours is.
        const unavailable = this.unavailableReply(null, "Running requests")
        if (unavailable) return unavailable
        const notInFront =
          "⚠️ Couldn't bring the request's tab to the front — nothing ran."
        if (active) {
          if (!active.request.endpoint.trim()) {
            return "The request has no URL yet — set one first."
          }
          const declined = await this.confirmRun(
            active.request.name || "the request",
            [this.runSurface(active.request, this.tabInheritedScripts())],
            batch.generation
          )
          if (declined) return declined
          // `request.send-cancel` is a toggle: invoking it mid-flight would
          // cancel the run while we report "Running…".
          if (active.getResponse()?.type === "loading") {
            return "A request is already running — wait for it to finish before running again."
          }
          // The send action acts on the ACTIVE tab's pane — make sure it is ours.
          const unbound = await this.frontPaneReply(
            "request.send-cancel",
            "Running requests",
            notInFront
          )
          if (unbound) return unbound
          invokeAction("request.send-cancel")
          batch.sent = true
          return this.runReply(
            this.reportRunOutcome(active.getResponse),
            batch,
            "▶ Running the request…"
          )
        }
        if (gqlActive) {
          if (!gqlActive.request.url.trim()) {
            return "The GraphQL request has no URL yet — set one first."
          }
          // A multi-operation document runs the named operation; without a
          // name the pane falls back to the document's first operation — so a
          // name that doesn't exist must not silently run something else.
          const operation = String(args.operation ?? "").trim()
          if (operation) {
            const names = this.listGQLOperations(gqlActive.request.query)
            if (names && !names.includes(operation)) {
              return `There is no operation named **${operation}** in the query${names.length ? ` — available: ${names.join(", ")}` : ""}.`
            }
          }
          const declined = await this.confirmRun(
            gqlActive.request.name || "the request",
            [this.runSurface(gqlActive.request, this.tabInheritedScripts())],
            batch.generation
          )
          if (declined) return declined
          // A subscription only opens here; its first event may never come.
          const subscription =
            this.gqlOperationType(
              gqlActive.request.query,
              operation || undefined
            ) === "subscription"
          // The GQL panes read the URL and request as props — let this
          // batch's committed edits reach them before running.
          const unbound = await this.frontPaneReply(
            "request.send-cancel",
            "Running requests",
            notInFront
          )
          if (unbound) return unbound
          // Mirror the run target in the editor so the visible cursor sits
          // on the operation being executed.
          this.moveGQLCursorToOperation(
            gqlActive.request.query,
            operation || undefined,
            "first"
          )
          invokeAction(
            "request.send-cancel",
            operation ? { operationName: operation } : undefined
          )
          batch.sent = true
          return this.runReply(
            this.reportGQLRunOutcome(gqlActive.getEvents),
            batch,
            operation
              ? `▶ Running the **${operation}** operation…`
              : "▶ Running the GraphQL operation…",
            !subscription
          )
        }
        return "Open a request tab first so I can run it."
      }
      case "save_request": {
        const document = this.resolveTurnTab()?.document
        if (
          (!active && !gqlActive) ||
          (document?.type !== "request" && document?.type !== "gql-request")
        )
          return "Open a request tab first so I can save it."
        const unavailable = this.unavailableReply(null, "Saving requests")
        if (unavailable) return unavailable
        const saveContext = document.saveContext
        // The panes open Save As for an unbound tab, or a personal binding
        // with no request index: the user saves there, not this call.
        const opensDialog =
          !saveContext ||
          (saveContext.originLocation === "user-collection" &&
            saveContext.requestIndex === undefined)
        if (saveContext && !opensDialog) {
          const declined = await this.confirmSave(
            this.savedRequestTarget(
              saveContext,
              document.request.name || "the request"
            ),
            this.chatWritesIn(document.request),
            batch.generation
          )
          if (declined) return declined
        }
        const unbound = await this.frontPaneReply(
          "request-response.save",
          "Saving requests",
          "⚠️ Couldn't bring the request's tab to the front — nothing was saved."
        )
        if (unbound) return unbound
        invokeAction("request-response.save")
        const dialogReply =
          "💾 Opened the save dialog — pick a collection and confirm to finish saving."
        if (opensDialog) return dialogReply
        // The handler is async (token check, team mutation) and reports only by toast.
        if (await this.awaitSaved(document)) return "💾 Saved the request."
        // A stale binding is dropped and the handler reopens Save As.
        return document.saveContext
          ? "⚠️ The save didn't complete — check the app for the error."
          : dialogReply
      }
      case "open_new_tab": {
        const unavailable = this.unavailableReply(
          "tab.open-new",
          "Opening tabs"
        )
        if (unavailable) return unavailable
        invokeAction("tab.open-new")
        this.followActiveTab(batch)
        return `🗂️ Opened a new tab${this.describeTabRequest()}.`
      }
      case "close_tab": {
        const unavailable = this.unavailableReply(
          "tab.close-current",
          "Closing tabs"
        )
        if (unavailable) return unavailable
        this.focusTurnTab()
        const closingId = this.tabService.currentActiveTab.value?.id
        invokeAction("tab.close-current")
        await nextTick()
        const stillOpen = this.tabService
          .getActiveTabs()
          .value.some((tab) => tab.id === closingId)
        if (stillOpen) {
          return "The tab wasn't closed — if it has unsaved changes, confirm in the dialog that just opened."
        }
        this.followActiveTab(batch)
        return "🗙 Closed the tab."
      }
      case "duplicate_tab": {
        const unavailable = this.unavailableReply(
          "tab.duplicate-tab",
          "Duplicating tabs"
        )
        if (unavailable) return unavailable
        this.focusTurnTab()
        invokeAction("tab.duplicate-tab", {})
        this.followActiveTab(batch)
        return "🗂️ Duplicated the current tab."
      }
      case "switch_tab": {
        const dir = String(args.direction ?? "next")
          .trim()
          .toLowerCase()
        const actions: Record<string, HoppActionWithOptionalArgs> = {
          next: "tab.next",
          previous: "tab.prev",
          prev: "tab.prev",
          first: "tab.switch-to-first",
          last: "tab.switch-to-last",
        }
        const action = actions[dir]
        if (!action) {
          return `Which tab? Use "next", "previous", "first", or "last".`
        }
        const unavailable = this.unavailableReply(action, "Switching tabs")
        if (unavailable) return unavailable
        invokeAction(action)
        this.followActiveTab(batch)
        return `🗂️ Switched to the ${dir} tab${this.describeTabRequest()}.`
      }
      case "switch_protocol": {
        const unavailable = this.unavailableReply(null, "Switching protocols")
        if (unavailable) return unavailable
        this.focusTurnTab()
        return this.switchProtocol(String(args.protocol ?? "").toLowerCase())
      }
      case "create_environment":
        return this.createEnv(String(args.name ?? "").trim(), args.variables)
      case "select_environment":
        return this.selectEnv(String(args.name ?? "").trim())
      case "add_or_update_environment_variables":
        return this.addEnvVars(args.variables, batch.generation)
      case "create_collection":
        return this.createCollection(String(args.name ?? "").trim())
      case "save_request_to_collection":
        return this.saveRequestToCollection(
          String(args.collection ?? "").trim(),
          active,
          batch.generation
        )
      case "add_or_update_collection_requests":
        return this.upsertCollectionRequests(
          String(args.collection ?? "").trim(),
          args.requests,
          batch.generation
        )
      case "open_request":
        return this.openCollectionRequest(
          String(args.request ?? "").trim(),
          args.collection ? String(args.collection).trim() : undefined,
          batch
        )
      case "set_collection_properties":
        return this.setCollectionProperties(
          String(args.collection ?? "").trim(),
          args,
          batch.generation
        )
      case "set_request_description":
        return this.setRequestDescription(
          String(args.description ?? ""),
          args.request ? String(args.request).trim() : undefined,
          args.collection ? String(args.collection).trim() : undefined,
          active,
          gqlActive
        )
      case "create_folder":
        return this.createFolder(
          String(args.parent ?? "").trim(),
          String(args.name ?? "").trim()
        )
      case "rename_collection":
        return this.renameCollection(
          String(args.collection ?? "").trim(),
          String(args.new_name ?? "").trim()
        )
      case "delete_collection":
        return this.deleteCollection(
          String(args.collection ?? "").trim(),
          batch.generation
        )
      case "set_collection_description":
        return this.setCollectionDescription(
          String(args.collection ?? "").trim(),
          String(args.description ?? "")
        )
      case "publish_documentation":
        return this.publishDocumentation(
          String(args.collection ?? "").trim(),
          args.title ? String(args.title).trim() : undefined,
          args.version ? String(args.version).trim() : undefined,
          args.environment ? String(args.environment).trim() : undefined,
          batch.generation
        )
      case "unpublish_documentation":
        return this.unpublishDocumentation(
          String(args.collection ?? "").trim(),
          args.version ? String(args.version).trim() : undefined,
          batch.generation
        )
      case "get_graphql_schema":
        return this.getGraphQLSchema()
      case "list_collections":
        return this.listCollections()
      case "run_collection":
        return this.runCollection(
          String(args.collection ?? "").trim(),
          args.environment ? String(args.environment).trim() : undefined,
          batch
        )
      default:
        return ""
    }
  }
  /**
   * Normalizes tool input into v2 environment variables, resolving opaque
   * client-local secret references without exposing their values to the model.
   */
  private toEnvVars(input: unknown): {
    variables: EnvVar[]
    error?: string
  } {
    if (!Array.isArray(input)) return { variables: [] }
    const variables: EnvVar[] = []
    for (const entry of input) {
      if (!entry || typeof entry !== "object" || !("key" in entry)) continue
      const variable = entry as Record<string, unknown>
      const key = String(variable.key ?? "").trim()
      const secret = variable.secret === true
      const rawValue = String(variable.value ?? "")
      if (!key) continue
      // A reference anywhere in the value ("Bearer <<local-ref:…>>" too)
      // makes the variable a secret and must resolve in full.
      const hasReference = containsLocalSecretReference(rawValue)
      if (hasReference && !secret) {
        return {
          variables: [],
          error: `Environment variable "${key}" uses a local secret reference and must be marked as secret.`,
        }
      }
      let value = rawValue
      if (hasReference) {
        let missing = false
        value = rawValue.replace(LOCAL_SECRET_REFERENCE_GLOBAL, (match, id) => {
          const resolvedValue = this.localSecretValues.get(id)
          if (resolvedValue === undefined) {
            missing = true
            return match
          }
          return resolvedValue
        })
        if (missing) {
          return {
            variables: [],
            error: `The local secret reference for "${key}" is no longer available. Send the value again.`,
          }
        }
      }
      variables.push({
        key,
        currentValue: value,
        initialValue: value,
        secret,
      })
    }
    return { variables }
  }
  /** Merges incoming variables into existing ones by key, preserving secrets. */
  private mergeEnvVars(
    existing: EnvVar[],
    incoming: EnvVar[]
  ): {
    variables: EnvVar[]
    skippedSecretKeys: string[]
  } {
    const merged = existing.map((v) => ({ ...v }))
    const skippedSecretKeys: string[] = []
    for (const nv of incoming) {
      // Variable names are case-sensitive (<<Token>> and <<token>> differ).
      const match = merged.find((m) => m.key.trim() === nv.key.trim())
      // Updating a secret requires explicitly marking the input as secret.
      if (match && (!match.secret || nv.secret)) {
        match.currentValue = nv.currentValue
        match.initialValue = nv.initialValue
        match.secret = match.secret || nv.secret
      } else if (match) {
        skippedSecretKeys.push(match.key)
      } else if (!match) {
        merged.push(nv)
      }
    }
    return { variables: merged, skippedSecretKeys }
  }
  /** Restores client-local values before a chat mutation rewrites an environment. */
  private hydrateEnvVars(envID: string, variables: EnvVar[]): EnvVar[] {
    return variables.map((variable, index) => {
      if (variable.secret) {
        const value =
          this.secretEnvironmentService.getSecretEnvironmentVariableValue(
            envID,
            index
          )
        return {
          ...variable,
          currentValue: value?.value ?? variable.currentValue,
          initialValue: value?.initialValue ?? variable.initialValue,
        }
      }
      const value = this.currentEnvironmentValueService.getEnvironmentVariable(
        envID,
        index
      )
      return {
        ...variable,
        currentValue: value?.currentValue ?? variable.currentValue,
      }
    })
  }
  /**
   * Creates an environment in the current workspace — a team environment when a
   * team workspace is active, otherwise a personal one — and makes it active.
   */
  private async createEnv(name: string, variables: unknown): Promise<string> {
    if (!name) return "What should the environment be called?"
    const parsedVars = this.toEnvVars(variables)
    if (parsedVars.error) return `⚠️ ${parsedVars.error}`
    const vars = parsedVars.variables
    const varNote = vars.length
      ? ` with ${vars.length} variable${vars.length > 1 ? "s" : ""}`
      : ""
    const storedVars = stripClientLocalValuesForWire(vars)
    // The new environment becomes active, so its values reach the next run.
    this.noteVariableWrites(
      vars.map((v) => ({ key: v.key, value: v.currentValue || v.initialValue }))
    )
    const team = null
    const envID = uniqueID()
    createEnvironment(name, storedVars, envID)
    populateLocalStoresFromVariables(envID, vars)
    // `createEnvironment` dispatches synchronously, so the new env is last.
    const index = environmentsStore.value.environments.length - 1
    if (index >= 0) setSelectedEnvironmentIndex({ type: "MY_ENV", index })
    return `🌐 Created environment **${name}**${varNote} and made it active.`
  }
  /** Switches the active environment by name (or "none" to clear). */
  private async selectEnv(name: string): Promise<string> {
    const n = name.toLowerCase()
    if (!n || n === "none" || n === "no environment" || n === "no") {
      setSelectedEnvironmentIndex({ type: "NO_ENV_SELECTED" })
      return "🌐 Cleared the active environment (No environment)."
    }
    const team = null
    const envs = environmentsStore.value.environments
    if (!envs.length) {
      return "There are no environments yet — want me to create one?"
    }
    const names = envs.map((e) => e.name).join(", ")
    const picked = pickByName(
      envs.map((env, index) => ({ env, index })),
      name,
      (e) => e.env.name
    )
    if (!picked) {
      return `I couldn't find an environment matching "${name}". Available: ${names}.`
    }
    if ("ambiguous" in picked) {
      return this.ambiguousEnvReply(
        name,
        picked.ambiguous.map((e) => e.env.name)
      )
    }
    const { index } = picked.item
    setSelectedEnvironmentIndex({ type: "MY_ENV", index })
    return `🌐 Switched the active environment to **${envs[index].name}**.`
  }
  /** Several environments match: ask rather than act on the wrong one. */
  private ambiguousEnvReply(name: string, matches: string[]): string {
    // No argument tells same-named ones apart, so asking again loops.
    const shared =
      new Set(matches.map((m) => m.trim().toLowerCase())).size < matches.length
    return `Several environments match "${name}": ${matches.join(", ")} — which one?${shared ? " Some share a name; rename one first." : ""}`
  }
  /** Adds / updates variables in the currently selected environment. */
  private async addEnvVars(
    variables: unknown,
    generation = this.turnGeneration
  ): Promise<string> {
    const parsedVars = this.toEnvVars(variables)
    if (parsedVars.error) return `⚠️ ${parsedVars.error}`
    const incoming = parsedVars.variables
    if (!incoming.length) return "No variables were provided."
    const count = incoming.length
    const selected = getSelectedEnvironmentIndex()
    if (selected.type !== "MY_ENV")
      return "Select or create an environment first, then I can add variables to it."
    this.noteVariableWrites(
      incoming.map((v) => ({
        key: v.key,
        value: v.currentValue || v.initialValue,
      })),
      (environmentsStore.value.environments[selected.index]?.variables ??
        []) as Array<{
        key: string
        initialValue?: string
      }>
    )
    const env = environmentsStore.value.environments[selected.index]
    if (!env) return "I couldn't find the selected environment."
    const { variables: merged, skippedSecretKeys } = this.mergeEnvVars(
      this.hydrateEnvVars(env.id, env.variables as EnvVar[]),
      incoming
    )
    const updatedCount = count - skippedSecretKeys.length
    if (updatedCount === 0) {
      return `⚠️ I didn't update ${skippedSecretKeys.join(", ")} because existing secret variables must be marked as secret.`
    }
    setEnvironmentVariables(
      selected.index,
      stripClientLocalValuesForWire(merged)
    )
    populateLocalStoresFromVariables(env.id, merged)
    return `🌐 Updated ${updatedCount} variable${updatedCount > 1 ? "s" : ""} in **${env.name}**.${
      skippedSecretKeys.length
        ? ` Skipped ${skippedSecretKeys.join(", ")} because it is a secret variable.`
        : ""
    }`
  }
  /** Creates a REST collection in the active workspace (personal or team). */
  private async createCollection(name: string): Promise<string> {
    if (!name) return "What should the collection be called?"
    const team = null
    const existing = findTopLevelCollection(
      restCollectionStore.value.state,
      name
    )
    if (existing) {
      return `📁 Collection **${existing.collection.name}** already exists.`
    }
    addRESTCollection(
      makeCollection({
        name,
        folders: [],
        requests: [],
        auth: { authType: "inherit", authActive: true },
        headers: [],
        variables: [],
        description: null,
        preRequestScript: "",
        testScript: "",
      })
    )
    return `📁 Created collection **${name}**.`
  }
  /**
   * Creates a folder inside an existing collection or folder.
   *
   * A folder is a child collection; `create_collection` only makes top-level
   * ones, so without this the assistant could not nest anything.
   */
  private async createFolder(
    parentName: string,
    name: string
  ): Promise<string> {
    if (!parentName) return "Which collection should the folder go inside?"
    if (!name) return "What should the folder be called?"
    const team = null
    const lookup = lookupCollection(restCollectionStore.value.state, parentName)
    if (!lookup || "ambiguous" in lookup) {
      return this.collectionMiss(parentName, lookup)
    }
    const parent = lookup.found
    const clash = (parent.collection.folders ?? []).find(
      (f) => (f.name ?? "").trim().toLowerCase() === name.trim().toLowerCase()
    )
    if (clash) {
      return `📁 **${parent.label}** already has a folder called **${clash.name}**.`
    }
    addRESTFolder(name, parent.path)
    return `📁 Created **${name}** inside **${parent.label}**.`
  }
  /** Saves the active request into a collection (matched by name) of the active workspace. */
  private async saveRequestToCollection(
    name: string,
    active: ActiveRequestHandle | null,
    generation = this.turnGeneration
  ): Promise<string> {
    if (!active) return "Open a request tab first so I can save it."
    if (!name) return "Which collection should I save it into?"
    const team = null
    const collections = restCollectionStore.value.state
    const lookup = lookupCollection(collections, name)
    if (!lookup || "ambiguous" in lookup) {
      const names = collections
        .map((c) => c.name)
        .filter(Boolean)
        .join(", ")
      return this.collectionMiss(
        name,
        lookup,
        false,
        `I couldn't find a collection named "${name}". Available: ${names || "none"}.`
      )
    }
    const found = lookup.found
    const declined = await this.confirmSave(
      { key: this.personalCollectionKey(found), name: found.label },
      this.chatWritesIn(active.request),
      generation
    )
    if (declined) return declined
    // The prompt may have stayed open while the store shifted.
    const target = this.findPersonalNode(found.collection)
    if (!target) {
      return `⚠️ **${found.label}** moved or was removed meanwhile — nothing saved.`
    }
    // A new collection entry needs its own identity — with the source's
    // `id`/`_ref_id`, sync would edit the original row instead of adding one.
    const saved = this.cloneRequest(active.request)
    saved._ref_id = generateUniqueRefId("req")
    delete (
      saved as {
        id?: string
      }
    ).id
    const insertionIndex = saveRESTRequestAs(target.path, saved)
    // Bind the tab to the saved entry (as the Save dialog does) so a follow-up
    // save updates it instead of creating another copy.
    active.bindToCollection(
      {
        originLocation: "user-collection",
        folderPath: target.path,
        requestIndex: insertionIndex,
        requestRefID: saved._ref_id,
        exampleID: undefined,
      },
      this.cloneRequest(saved)
    )
    return `📁 Saved the request into **${found.label}**.`
  }
  /**
   * Materializes a complete set of REST endpoints without requiring a separate
   * open-tab/save loop for each request.
   */
  private async upsertCollectionRequests(
    name: string,
    requests: unknown,
    generation = this.turnGeneration
  ): Promise<string> {
    if (!name) return "Which collection should contain these requests?"
    const team = null
    const lookup = lookupCollection(restCollectionStore.value.state, name)
    if (!lookup || "ambiguous" in lookup)
      return this.collectionMiss(name, lookup)
    const found = lookup.found
    found.collection = await ensureRemoteCollection(found.collection)
    const parsed = parseCollectionRequestDefinitions(requests)
    if ("error" in parsed) return `⚠️ ${parsed.error}`
    const existingIn = (collection: HoppCollection, requestName: string) => {
      const index = collection.requests.findIndex(
        (request) =>
          isRESTRequest(request) &&
          request.name.trim().toLowerCase() === requestName.toLowerCase()
      )
      const candidate = index === -1 ? undefined : collection.requests[index]
      return {
        index,
        existing: candidate && isRESTRequest(candidate) ? candidate : undefined,
      }
    }
    // A saved host is where the request sends for everyone who runs it.
    const declined = await this.confirmSave(
      { key: this.personalCollectionKey(found), name: found.label },
      this.upsertHosts(
        parsed.definitions,
        found.collection.requests.filter(isRESTRequest)
      ),
      generation
    )
    if (declined) return declined
    // The prompt may have stayed open while the store shifted.
    const target = this.findPersonalNode(found.collection)
    if (!target) {
      return `⚠️ **${found.label}** moved or was removed meanwhile — nothing changed.`
    }
    let created = 0
    let updated = 0
    const keptTabs: string[] = []
    const path = target.path
    for (const definition of parsed.definitions) {
      const { index: requestIndex, existing } = existingIn(
        target.node,
        definition.name
      )
      this.noteUpsertRisk(definition, existing)
      const request = buildCollectionRequest(definition, existing)
      if (requestIndex === -1) {
        saveRESTRequestAs(path, request)
        created += 1
      } else {
        editRESTRequest(path, requestIndex, request)
        updated += 1
        // A tab already showing this request would otherwise keep (and later
        // re-save) the stale version.
        this.refreshBoundTabs(
          {
            originLocation: "user-collection",
            folderPath: path,
            requestIndex,
            requestRefID: request._ref_id ?? request.id ?? "",
            exampleID: undefined,
          },
          request,
          keptTabs
        )
      }
    }
    const changes = [
      created ? `${created} created` : "",
      updated ? `${updated} updated` : "",
    ]
      .filter(Boolean)
      .join(", ")
    return `📁 Collection **${found.label}**: ${changes}.${this.keptTabsNote(keptTabs)}`
  }
  /**
   * Shows an updated request in the tab bound to it. A tab with unsaved edits
   * is left alone: overwriting it would silently discard them.
   */
  private refreshBoundTabs(
    saveContext: HoppTabSaveContext,
    request: HoppRESTRequest,
    keptTabs: string[]
  ) {
    for (const tab of this.tabService.getTabsRefWithSaveContext(saveContext)) {
      const document = tab.value.document
      if (document.type !== "request") continue
      if (document.isDirty) {
        if (!keptTabs.includes(request.name)) keptTabs.push(request.name)
        continue
      }
      document.request = this.cloneRequest(request)
      document.isDirty = false
    }
  }
  /** Tells the model which open tabs kept their unsaved edits. */
  private keptTabsNote(keptTabs: string[]): string {
    return keptTabs.length
      ? ` Open tab${keptTabs.length > 1 ? "s" : ""} with unsaved edits left as is: ${keptTabs
          .map((n) => `**${n}**`)
          .join(
            ", "
          )} — saving ${keptTabs.length > 1 ? "them" : "it"} overwrites this update.`
      : ""
  }
  /** Opens a saved request from the active workspace's collections into a tab (by name). */
  private async openCollectionRequest(
    reqName: string,
    collName: string | undefined,
    batch: ToolBatch
  ): Promise<string> {
    if (!reqName) return "Which request should I open?"
    const team = null
    const collections = restCollectionStore.value.state
    const found = findRequestInTree(collections, reqName, collName)
    if (!found) {
      const available = listRequestNames(collections)
      return `I couldn't find a request named "${reqName}"${collName ? ` in "${collName}"` : ""}.${available ? ` Available: ${available}.` : ""}`
    }
    const { folderPath, requestIndex } = found
    const request = await ensureRemoteRequest(found.request)
    if (!isRESTRequest(request)) {
      const label =
        (
          request as {
            name?: string
          }
        ).name || reqName
      return `**${label}** is a GraphQL request — open it from the collection sidebar; chat can currently open REST requests only.`
    }
    const requestRefID =
      (
        request as {
          _ref_id?: string
        }
      )._ref_id ?? request.id
    const saveContext = {
      originLocation: "user-collection" as const,
      folderPath,
      requestIndex,
      requestRefID,
    }
    const existing = this.tabService.getTabRefWithSaveContext(saveContext)
    const tabId =
      existing?.value.id ??
      this.tabService.createNewTab({
        type: "request",
        request: this.cloneRequest(request),
        isDirty: false,
        saveContext,
        inheritedProperties: cascadeParentCollectionForProperties(
          folderPath,
          "rest"
        ),
      }).id
    // createNewTab focuses it already; set it explicitly to be safe.
    this.activateTab(tabId, batch)
    return `📂 Opened **${request.name || "request"}** in a tab${this.describeTabRequest(tabId)}.`
  }
  /** Runs a personal collection and resolves after its test-runner summary is available. */
  private async runCollection(
    name: string,
    environmentName?: string,
    batch: ToolBatch = { generation: this.turnGeneration, runs: null }
  ): Promise<string> {
    if (!name) return "Which collection should I run?"
    const team = null
    const lookup = lookupCollection(restCollectionStore.value.state, name)
    if (!lookup || "ambiguous" in lookup)
      return this.collectionMiss(name, lookup)
    const found = lookup.found
    found.collection = await ensureRemoteCollection(found.collection)
    const totalRequests = this.countCollectionRequests(found.collection)
    if (totalRequests === 0) {
      return `⚠️ Collection **${found.label}** has no requests to run.`
    }
    const collectionID = found.collection._ref_id
    if (!collectionID) {
      return `⚠️ Collection **${found.label}** has no stable identifier and cannot be run.`
    }
    // A folder runs its ancestors' scripts too.
    const ancestors = getRESTCollectionInheritedProps(collectionID)
    const declined = await this.confirmRun(
      found.label,
      [
        ...this.collectionSurfaces(found.collection),
        {
          host: "",
          scripts: [
            ...(ancestors?.ancestorPreRequestScripts ?? []),
            ...(ancestors?.ancestorTestScripts ?? []),
          ],
        },
      ],
      batch.generation
    )
    if (declined) return declined
    // The prompt may have stayed open while the user switched workspace.
    if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
    if (environmentName) {
      const selectionReply = await this.selectEnv(environmentName)
      if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
      if (!selectionReply.startsWith("🌐")) return selectionReply
    }
    const tab = this.tabService.createNewTab({
      type: "test-runner",
      collectionType: "my-collections",
      collectionID,
      collection: this.cloneCollection(found.collection),
      isDirty: false,
      config: {
        iterations: 1,
        delay: 500,
        stopOnError: false,
        persistResponses: true,
        keepVariableValues: true,
      },
      selectedRequestRefIds: undefined,
      status: "idle",
      request: null,
      environmentID:
        getSelectedEnvironmentIndex().type === "NO_ENV_SELECTED"
          ? null
          : getCurrentEnvironment().id,
      environmentName:
        getSelectedEnvironmentIndex().type === "NO_ENV_SELECTED"
          ? undefined
          : getCurrentEnvironment().name,
      testRunnerMeta: {
        completedRequests: 0,
        totalRequests: 0,
        totalTime: 0,
        failedTests: 0,
        passedTests: 0,
        totalTests: 0,
      },
    })
    batch.activatedTabId = tab.id
    const runnerTab = this.getTestRunnerTabRef(tab.id)
    // A folder inherits from its ancestors: resolve them as Runner.vue does.
    const inherited = getRESTCollectionInheritedProps(collectionID) ?? {
      auth: { authActive: true, authType: "none" as const },
      headers: [],
      ancestorVariables: [],
      ancestorPreRequestScripts: [],
      ancestorTestScripts: [],
    }
    const root = runnerTab.value.document.collection
    const resolvedCollection: HoppCollection = {
      ...root,
      auth: inherited.auth,
      headers: inherited.headers,
      variables: root.variables ?? [],
    }
    const stopRef = ref(false)
    const result = this.waitForCollectionRun(tab.id, found.label, () => {
      if (!this.testRunnerService.stopRun(tab.id)) {
        stopRef.value = true
      }
    })
    batch.sent = true
    this.testRunnerService.runTests(
      runnerTab,
      resolvedCollection,
      { ...runnerTab.value.document.config, stopRef },
      inherited.ancestorPreRequestScripts,
      inherited.ancestorTestScripts,
      inherited.ancestorVariables
    )
    return result
  }
  /**
   * Retains the reactive runner document after the tab is closed so the runner
   * can observe its stop signal without dereferencing a deleted workspace tab.
   */
  private getTestRunnerTabRef(
    tabID: string
  ): ShallowRef<HoppTab<HoppTestRunnerDocument>> {
    const tab = this.tabService.getTabRef(tabID).value
    if (tab.document.type !== "test-runner") {
      throw new Error(`Tab "${tabID}" is not a collection runner.`)
    }
    return shallowRef({ ...tab, document: tab.document })
  }
  /** Waits for the directly-started runner to settle or be closed by the user. */
  private waitForCollectionRun(
    tabID: string,
    collectionName: string,
    stopRun: () => void,
    // A tab created "idle" relies on the runner UI to start it — give up if
    // that never happens (e.g. the workspace page is not mounted).
    idleTimeoutMs?: number
  ): Promise<string> {
    return new Promise((resolve) => {
      let stop: (() => void) | null = null
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const tabs = this.tabService.getActiveTabs()
      const finish = (message: string) => {
        if (stop) stop()
        if (idleTimer) clearTimeout(idleTimer)
        resolve(message)
      }
      if (idleTimeoutMs) {
        idleTimer = setTimeout(() => {
          const tab = tabs.value.find((entry) => entry.id === tabID)
          if (
            tab?.document.type === "test-runner" &&
            tab.document.status === "idle"
          ) {
            finish(
              `⚠️ The runner for **${collectionName}** didn't start — open the REST workspace and run it from the collection sidebar.`
            )
          }
        }, idleTimeoutMs)
      }
      stop = watch(
        (): CollectionRunSnapshot | null => {
          const tab = tabs.value.find((entry) => entry.id === tabID)
          if (!tab) return null
          const document = tab.document
          if (document.type !== "test-runner") return null
          return {
            status: document.status,
            meta: { ...document.testRunnerMeta },
            resultCollection: document.resultCollection,
          }
        },
        (snapshot) => {
          if (!snapshot) {
            stopRun()
            finish(
              `⚠️ The runner for **${collectionName}** was closed before verification completed.`
            )
            return
          }
          if (
            snapshot.status === "error" ||
            snapshot.status === "stopped" ||
            snapshot.status === "completed"
          ) {
            finish(this.describeCollectionRun(collectionName, snapshot))
          }
        }
      )
    })
  }
  private countCollectionRequests(collection: HoppCollection): number {
    return (
      collection.requests.length +
      collection.folders.reduce(
        (total, folder) => total + this.countCollectionRequests(folder),
        0
      )
    )
  }
  private describeCollectionRun(
    collectionName: string,
    snapshot: CollectionRunSnapshot
  ): string {
    const { meta } = snapshot
    if (meta.totalRequests === 0) {
      return `⚠️ **${collectionName}** stopped without executing any requests; it was not verified.`
    }
    const summary = `${meta.completedRequests}/${meta.totalRequests} endpoints completed · ${meta.passedTests}/${meta.totalTests} tests passed · ${Math.round(meta.totalTime)} ms`
    const failures = this.getCollectionRunFailures(snapshot.resultCollection)
    if (snapshot.status === "error") {
      return `❌ **${collectionName}** could not complete verification: ${summary}${failures.length ? ` · Issues: ${failures.join("; ")}` : ""}`
    }
    if (meta.totalTests === 0) {
      return `⚠️ **${collectionName}** ran, but no test assertions executed: ${summary}. The endpoints are not verified by tests.${failures.length ? ` Issues: ${failures.join("; ")}` : ""}`
    }
    if (
      meta.completedRequests < meta.totalRequests ||
      meta.failedTests > 0 ||
      failures.length
    ) {
      return `⚠️ **${collectionName}** completed with verification issues: ${summary}${failures.length ? ` · Issues: ${failures.join("; ")}` : ""}`
    }
    return `✅ **${collectionName}** verified: ${summary}.`
  }
  private getCollectionRunFailures(
    collection: HoppCollection | undefined
  ): string[] {
    if (!collection) return []
    const failures: string[] = []
    const walk = (node: HoppCollection) => {
      for (const request of node.requests) {
        if (!request || typeof request !== "object" || !("name" in request)) {
          continue
        }
        const name =
          typeof request.name === "string" && request.name
            ? request.name
            : "Unnamed request"
        const error = "error" in request ? request.error : undefined
        const failedTests =
          "failedTests" in request && typeof request.failedTests === "number"
            ? request.failedTests
            : 0
        if (typeof error === "string" && error) {
          failures.push(`${name}: ${error}`)
        } else if (failedTests > 0) {
          failures.push(
            `${name}: ${failedTests} test${failedTests > 1 ? "s" : ""} failed`
          )
        }
      }
      node.folders.forEach(walk)
    }
    walk(collection)
    return failures.slice(0, 3)
  }
  private describeGQLError(err: GQLError<string>): string {
    if (err.type === "network_error") return "network error"
    switch (err.error) {
      case "team/not_required_role":
      case "team_req/not_required_role":
      case "Forbidden resource":
      case "ea/not_invite_or_admin":
        return "you don't have permission to do that"
      case "team/name_invalid":
        return "the team name is invalid"
      case "team_coll/short_title":
        return "the collection name is too short"
      case "team/invalid_coll_id":
        return "the collection no longer exists"
      case "team_req/not_found":
        return "the request no longer exists"
      case "published_docs/invalid_collection":
        return "that collection isn't published/publishable on the server"
      case "published_docs/not_found":
        return "that published version no longer exists"
      case "published_docs/creation_failed":
        return "the server couldn't create it (a version with that name may already exist — try again)"
      case "user_environment/not_found":
      case "team_environment/not_found":
        return "that environment hasn't synced to the server yet or no longer exists"
      case "published_docs/forbidden_environment_access":
        return "you can't attach that environment"
      default:
        return err.error || "unexpected error"
    }
  }
  /** The reply for a collection argument that matched nothing or several. */
  private collectionMiss(
    ref: string,
    lookup: {
      ambiguous: string[]
      unloaded?: true
      moved?: true
    } | null,
    team = false,
    notFound = `I couldn't find a ${""}collection named "${ref}".`
  ): string {
    if (lookup?.moved) return WORKSPACE_MOVED_REPLY
    if (lookup?.unloaded) {
      const [label] = lookup.ambiguous
      return label
        ? `Found /${label}, but some folders aren't loaded and may share the name — pass that full path.`
        : `${notFound} Some folders aren't loaded yet — pass the full path, e.g. /Parent/Child.`
    }
    return lookup
      ? describeAmbiguous("collections", ref, lookup.ambiguous)
      : notFound
  }
  // ---------------------------------------------------------------------------
  // On-demand context (kept out of the per-call context to save tokens)
  // ---------------------------------------------------------------------------
  private getGraphQLSchema(): string {
    const tab = this.resolveTurnTab()
    if (tab?.document?.type !== "gql-request") {
      return "The current tab is not a GraphQL request tab — switch to one and ask again."
    }
    const schema = this.gqlTabConnection.getTabConnectionState(tab.id).schema
    if (!schema) {
      return "No introspected schema — connect the GraphQL tab first (the Connect button next to the URL), then ask again."
    }
    return serializeGQLSchema(schema)
  }
  private async listCollections(): Promise<string> {
    const team = null
    {
      const tree = restCollectionStore.value.state
      return tree.length
        ? serializeCollections(tree, 80, MAX_CONTEXT_RESULT_CHARS - 20)
        : "There are no collections in the personal workspace yet."
    }
  }
  // ---------------------------------------------------------------------------
  // Collection properties (auth / headers / variables / scripts)
  // ---------------------------------------------------------------------------
  /** Builds a collection auth object from the tool's `auth` argument. */
  private buildCollectionAuth(input: unknown):
    | {
        auth: HoppRESTAuth
      }
    | {
        error: string
      } {
    if (!input || typeof input !== "object") {
      return { error: "The auth section must be an object with a type." }
    }
    const a = input as Record<string, unknown>
    const type = String(a.type ?? "")
      .trim()
      .toLowerCase()
    const str = (v: unknown) => String(v ?? "").trim()
    switch (type) {
      case "none":
        return { auth: { authType: "none", authActive: true } }
      case "inherit":
        return { auth: { authType: "inherit", authActive: true } }
      case "bearer": {
        const token = str(a.token)
        if (!token) return { error: "Bearer auth needs a token." }
        return { auth: { authType: "bearer", authActive: true, token } }
      }
      case "basic": {
        const username = str(a.username)
        if (!username) return { error: "Basic auth needs a username." }
        return {
          auth: {
            authType: "basic",
            authActive: true,
            username,
            password: str(a.password),
          },
        }
      }
      case "api-key":
      case "apikey":
      case "api_key": {
        const key = str(a.key)
        const value = str(a.value)
        if (!key || !value)
          return { error: "API-key auth needs a key and a value." }
        return {
          auth: {
            authType: "api-key",
            authActive: true,
            key,
            value,
            addTo:
              str(a.add_to).toLowerCase() === "query"
                ? "QUERY_PARAMS"
                : "HEADERS",
          },
        }
      }
      default:
        return {
          error: `Unsupported auth type "${type}" — use none, inherit, bearer, basic, or api-key.`,
        }
    }
  }
  /**
   * Applies inherited properties to a collection or folder of the active
   * workspace, mirroring the Properties modal: variables' per-user values go
   * to the local stores under the collection's key and only stripped values
   * travel to the store/backend; open tabs get their inherited properties
   * refreshed afterwards.
   */
  private async setCollectionProperties(
    collName: string,
    args: Record<string, unknown>,
    generation = this.turnGeneration
  ): Promise<string> {
    if (!collName) return "Which collection should I update?"
    const team = null
    // ---- parse the requested changes first (no partial writes) ----
    let auth: HoppRESTAuth | undefined
    if (args.auth !== undefined) {
      const built = this.buildCollectionAuth(args.auth)
      if ("error" in built) return `⚠️ ${built.error}`
      auth = built.auth
    }
    const headerPairs = Array.isArray(args.headers)
      ? (args.headers as unknown[]).flatMap((h) => {
          if (!h || typeof h !== "object" || !("key" in h)) return []
          const key = String(
            (
              h as {
                key?: unknown
              }
            ).key ?? ""
          ).trim()
          const value = String(
            (
              h as {
                value?: unknown
              }
            ).value ?? ""
          )
          return key ? [{ key, value }] : []
        })
      : []
    const removeHeaders = Array.isArray(args.remove_headers)
      ? (args.remove_headers as unknown[]).map((k) =>
          String(k).trim().toLowerCase()
        )
      : []
    const parsedVars = this.toEnvVars(args.variables)
    if (parsedVars.error) return `⚠️ ${parsedVars.error}`
    const removeVariables = Array.isArray(args.remove_variables)
      ? (args.remove_variables as unknown[]).map((k) => String(k).trim())
      : []
    const preRequestScript =
      typeof args.pre_request_script === "string"
        ? args.pre_request_script
        : undefined
    const testScript =
      typeof args.test_script === "string" ? args.test_script : undefined
    if (
      !auth &&
      !headerPairs.length &&
      !removeHeaders.length &&
      !parsedVars.variables.length &&
      !removeVariables.length &&
      preRequestScript === undefined &&
      testScript === undefined
    ) {
      return "What should change — auth, headers, variables, or scripts?"
    }
    // ---- resolve the target and its current (hydrated) state ----
    let current: HoppCollection
    let storeKey: string
    let label: string
    let personal: {
      path: string
    } | null = null
    const teamNode: {
      node: HoppCollection
      path: string
    } | null = null
    {
      const lookup = lookupCollection(restCollectionStore.value.state, collName)
      if (!lookup || "ambiguous" in lookup) {
        return this.collectionMiss(collName, lookup)
      }
      const found = lookup.found
      personal = { path: found.path }
      label = found.label
      current = found.collection
      storeKey =
        found.collection._ref_id ??
        found.collection.id ??
        found.path.split("/").pop()!
    }
    // Synced to the team, a variable's new host redirects teammates' runs.
    const hosts = []
    // ---- merge ----
    const existingVars = this.hydrateEnvVars(
      storeKey,
      (current.variables ?? []).map((v) => ({
        key: v.key,
        currentValue: v.currentValue ?? "",
        initialValue: v.initialValue ?? "",
        secret: !!v.secret,
      }))
    )
    const { variables: mergedVars, skippedSecretKeys } = this.mergeEnvVars(
      existingVars,
      parsedVars.variables
    )
    const finalVars = mergedVars.filter(
      (v) => !removeVariables.includes(v.key.trim())
    )
    const headers: HoppRESTHeader[] = (current.headers ?? []).map((h) => ({
      ...h,
    }))
    for (const { key, value } of headerPairs) {
      const existing = headers.find(
        (h) => h.key.toLowerCase() === key.toLowerCase()
      )
      if (existing) {
        existing.value = value
        existing.active = true
      } else {
        headers.push({ key, value, active: true, description: "" })
      }
    }
    const finalHeaders = headers.filter(
      (h) => !removeHeaders.includes(h.key.toLowerCase())
    )
    // Only report (and write) what actually changes.
    const updatedVarCount =
      parsedVars.variables.length - skippedSecretKeys.length
    const removedVarCount = mergedVars.length - finalVars.length
    const removedHeaderCount = headers.length - finalHeaders.length
    if (
      !auth &&
      !headerPairs.length &&
      !removedHeaderCount &&
      !updatedVarCount &&
      !removedVarCount &&
      preRequestScript === undefined &&
      testScript === undefined
    ) {
      return `Nothing to change on **${label}**${
        skippedSecretKeys.length
          ? ` — ${skippedSecretKeys.join(", ")} ${skippedSecretKeys.length > 1 ? "are secrets" : "is a secret"}; pass secret: true to overwrite`
          : removeHeaders.length || removeVariables.length
            ? " — nothing matched the names to remove"
            : ""
      }.`
    }
    // The store/backend copy is stripped; per-user values (secrets, current
    // values) go to the local stores under the collection's key — only once
    // the write is known to succeed, so a failed write can't re-index them.
    const wireVars = stripClientLocalValuesForWire(
      finalVars
    ) as HoppCollectionVariable[]
    const nextAuth = auth ?? current.auth
    const nextPre = preRequestScript ?? current.preRequestScript ?? ""
    const nextTest = testScript ?? current.testScript ?? ""
    // ---- write ----
    if (personal) {
      populateLocalStoresFromVariables(storeKey, finalVars)
      const updated = {
        ...current,
        auth: nextAuth,
        headers: finalHeaders,
        variables: wireVars,
        preRequestScript: nextPre,
        testScript: nextTest,
      }
      if (personal.path.includes("/")) {
        editRESTFolder(personal.path, updated)
      } else {
        editRESTCollection(parseInt(personal.path), updated)
      }
      const path = personal.path
      void nextTick(() =>
        updateInheritedPropertiesForAffectedRequests(path, "rest")
      )
    }
    // Requests in this collection inherit these on their next run.
    this.noteScriptWrite(preRequestScript, current.preRequestScript)
    this.noteScriptWrite(testScript, current.testScript)
    if (updatedVarCount)
      this.noteVariableWrites(
        parsedVars.variables.map((v) => ({
          key: v.key,
          value: v.currentValue || v.initialValue,
        })),
        existingVars.map((v) => ({
          key: v.key,
          value: v.currentValue,
          initialValue: v.initialValue,
        }))
      )
    const parts = [
      auth ? `auth: ${auth.authType}` : "",
      headerPairs.length
        ? `${headerPairs.length} header${headerPairs.length > 1 ? "s" : ""}`
        : "",
      removedHeaderCount
        ? `removed ${removedHeaderCount} header${removedHeaderCount > 1 ? "s" : ""}`
        : "",
      updatedVarCount
        ? `${updatedVarCount} variable${updatedVarCount > 1 ? "s" : ""}${
            parsedVars.variables.some((v) => v.secret)
              ? " (secrets kept local)"
              : ""
          }`
        : "",
      removedVarCount
        ? `removed ${removedVarCount} variable${removedVarCount > 1 ? "s" : ""}`
        : "",
      preRequestScript !== undefined ? "pre-request script" : "",
      testScript !== undefined ? "test script" : "",
    ].filter(Boolean)
    return `🗂️ Updated **${label}**: ${parts.join(", ")}.${
      skippedSecretKeys.length
        ? ` Skipped secret variable${skippedSecretKeys.length > 1 ? "s" : ""} ${skippedSecretKeys.join(", ")} — pass secret: true to overwrite.`
        : ""
    }`
  }
  // ---------------------------------------------------------------------------
  // Documentation (descriptions) and published docs
  // ---------------------------------------------------------------------------
  /**
   * Mirrors a saved request's new description onto any open tab bound to it
   * (as the Documentation modal does), without changing the tab's dirty state.
   */
  private syncOpenTabDescription(
    saveContext: HoppTabSaveContext,
    description: string
  ) {
    for (const tab of this.tabService.getTabsRefWithSaveContext(saveContext)) {
      const document = tab.value.document
      if (document.type !== "request" && document.type !== "gql-request") {
        continue
      }
      const wasDirty = document.isDirty
      document.request.description = description
      void nextTick(() => {
        document.isDirty = wasDirty
      })
    }
  }
  /** Coerces a tool argument that should be a number ("90000" counts). */
  private optionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  private async setRequestDescription(
    description: string,
    reqName: string | undefined,
    collName: string | undefined,
    active: ActiveRequestHandle | null,
    gqlActive: ActiveGQLRequestHandle | null
  ): Promise<string> {
    const verb = description ? "Set" : "Cleared"
    // No target named: document the request in the pinned tab. When that tab
    // is bound to a saved request, persist to the saved copy too (as the
    // Documentation modal does) so a later save/publish reflects it.
    if (!reqName) {
      const document = this.resolveTurnTab()?.document
      const handle = active ?? gqlActive
      if (!handle || !document) {
        return "Open a request tab first, or name a saved request to document."
      }
      const ctx = "saveContext" in document ? document.saveContext : null
      if (
        ctx?.originLocation === "user-collection" &&
        ctx.requestIndex !== undefined
      ) {
        const folder = ctx.folderPath
          .split("/")
          .map((x) => parseInt(x))
          .reduce<HoppCollection | undefined>(
            (node, index, i) =>
              i === 0
                ? restCollectionStore.value.state[index]
                : node?.folders[index],
            undefined
          )
        const stored = folder?.requests[ctx.requestIndex]
        if (stored) {
          editRESTRequest(ctx.folderPath, ctx.requestIndex, {
            ...await ensureRemoteRequest(stored),
            description,
          })
          this.syncOpenTabDescription(ctx, description)
          return `📝 ${verb} the request's documentation (saved).`
        }
      }
      handle.request.description = description
      handle.commit()
      return `📝 ${verb} the request's documentation — save the request to keep it.`
    }
    const team = null
    const collections = restCollectionStore.value.state
    const lookup = lookupRequest(collections, reqName, collName)
    if (!lookup || "ambiguous" in lookup) {
      return this.requestMiss(
        reqName,
        collName,
        lookup,
        `I couldn't find a request named exactly "${reqName}"${collName ? ` in "${collName}"` : ""}.${
          listRequestNames(collections)
            ? ` Available: ${listRequestNames(collections)}.`
            : ""
        }`
      )
    }
    const { folderPath, requestIndex, label } = lookup.found
    const request = await ensureRemoteRequest(lookup.found.request)
    // Replaced wholesale by the store — always send the full request.
    editRESTRequest(folderPath, requestIndex, { ...request, description })
    this.syncOpenTabDescription(
      {
        originLocation: "user-collection",
        folderPath,
        requestIndex,
        requestRefID:
          (
            request as {
              _ref_id?: string
            }
          )._ref_id ?? request.id,
        exampleID: undefined,
      },
      description
    )
    return `📝 Documented **${label}**.`
  }
  /** The reply for a request name that matched nothing or several. */
  private requestMiss(
    reqName: string,
    collName: string | undefined,
    lookup: {
      ambiguous: string[]
    } | null,
    notFound: string
  ): string {
    if (!lookup) return notFound
    return describeAmbiguous(
      "requests",
      collName ? `${collName}/${reqName}` : reqName,
      lookup.ambiguous,
      "pass its collection's path as `collection`"
    )
  }
  /** Renames a collection or folder of the active workspace, matched by name. */
  private async renameCollection(
    collName: string,
    newName: string
  ): Promise<string> {
    if (!collName) return "Which collection should I rename?"
    if (!newName) return "What should I rename it to?"
    const team = null
    const lookup = lookupCollection(restCollectionStore.value.state, collName)
    if (!lookup || "ambiguous" in lookup) {
      return this.collectionMiss(collName, lookup)
    }
    const found = lookup.found
    // The sync layer rebuilds the server payload from what we dispatch, so the
    // partial has to carry the whole collection rather than just the name.
    const updated = { ...found.collection, name: newName }
    if (found.path.includes("/")) {
      editRESTFolder(found.path, updated)
    } else {
      editRESTCollection(parseInt(found.path), updated)
    }
    return `✏️ Renamed **${found.label}** to **${newName}**.`
  }
  /**
   * Deletes a collection or folder of the active workspace, matched by name.
   *
   * Everything inside goes with it and there is no undo, so the match is exact
   * and a near miss deletes nothing.
   */
  private async deleteCollection(
    collName: string,
    generation = this.turnGeneration
  ): Promise<string> {
    if (!collName) return "Which collection should I delete?"
    const team = null
    const lookup = lookupCollection(restCollectionStore.value.state, collName)
    if (!lookup || "ambiguous" in lookup) {
      return this.collectionMiss(collName, lookup)
    }
    const { label, collection } = lookup.found
    if (!(await this.confirm("collection", label, generation))) {
      return `Left **${label}** alone.`
    }
    if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
    // The prompt may have stayed open while the store shifted: the old index
    // path could now point at another collection.
    const current = this.findPersonalNode(collection)
    if (!current) {
      return `⚠️ **${label}** moved or was removed meanwhile — nothing deleted.`
    }
    this.removePersonalNode(current.path, current.node)
    return `🗑️ Deleted **${label}** and everything in it.`
  }
  /** A personal collection or folder's current index path, by identity. */
  private findPersonalNode(target: HoppCollection): {
    node: HoppCollection
    path: string
  } | null {
    const same = (c: HoppCollection) =>
      target._ref_id
        ? c._ref_id === target._ref_id
        : target.id
          ? c.id === target.id
          : c === target
    const walk = (
      nodes: HoppCollection[],
      prefix: number[]
    ): {
      node: HoppCollection
      path: string
    } | null => {
      for (const [i, node] of nodes.entries()) {
        if (same(node)) return { node, path: [...prefix, i].join("/") }
        const inner = walk(node.folders ?? [], [...prefix, i])
        if (inner) return inner
      }
      return null
    }
    return walk(restCollectionStore.value.state, [])
  }
  /**
   * Removes a personal collection or folder as the sidebar does: by backend
   * id (what sync deletes by), then re-indexing or unbinding the tabs it
   * shifted and flushing its local secret and current values.
   */
  private removePersonalNode(path: string, node: HoppCollection) {
    const indices = path.split("/").map((i) => parseInt(i))
    const lastIndex = indices[indices.length - 1]
    const parentPath = indices.slice(0, -1).join("/")
    if (parentPath) removeRESTFolder(path, node.id)
    else removeRESTCollection(lastIndex, node.id)
    const tree = restCollectionStore.value.state
    resolveSaveContextOnCollectionReorder({
      lastIndex,
      newIndex: -1,
      folderPath: parentPath,
      length: (parentPath ? getFoldersByPath(tree, parentPath) : tree).length,
    })
    this.shiftNestedSaveContexts(parentPath, lastIndex)
    flushLocalStoresForCollectionTree(node)
  }
  /**
   * The sidebar's re-index covers the removed node's siblings only; tabs bound
   * deeper inside a later sibling shift too, or a save writes elsewhere.
   */
  private shiftNestedSaveContexts(parentPath: string, removedIndex: number) {
    const depth = parentPath ? parentPath.split("/").length : 0
    const tabs = this.tabService.getTabsRefTo(
      (tab) =>
        tab.document.type !== "test-runner" &&
        tab.document.saveContext?.originLocation === "user-collection"
    )
    for (const tab of tabs) {
      const doc = tab.value.document
      if (doc.type === "test-runner") continue
      const ctx = doc.saveContext
      if (ctx?.originLocation !== "user-collection") continue
      const parts = ctx.folderPath.split("/")
      if (parts.length <= depth + 1) continue
      if (parts.slice(0, depth).join("/") !== parentPath) continue
      const index = parseInt(parts[depth])
      if (index > removedIndex) {
        parts[depth] = String(index - 1)
        ctx.folderPath = parts.join("/")
      }
    }
  }
  private async setCollectionDescription(
    collName: string,
    description: string
  ): Promise<string> {
    if (!collName) return "Which collection should I document?"
    const team = null
    const lookup = lookupCollection(restCollectionStore.value.state, collName)
    if (!lookup || "ambiguous" in lookup) {
      return this.collectionMiss(collName, lookup)
    }
    const found = lookup.found
    // The sync layer builds the server payload from the partial we dispatch,
    // so it must carry the FULL collection, not just the description.
    const updated = { ...found.collection, description }
    if (found.path.includes("/")) {
      editRESTFolder(found.path, updated)
    } else {
      editRESTCollection(parseInt(found.path), updated)
    }
    return `📝 Documented collection **${found.label}**.`
  }
  /**
   * Resolves the backend id of a collection for publishing / mocking.
   * `root` picks the top-level ancestor (mock servers are per root collection).
   * `name` is the "Parent/Child" label; `title` the node's own name.
   */
  private async resolveBackendCollection(
    collName: string,
    root = false
  ): Promise<
    | {
        id: string
        name: string
        title: string
      }
    | {
        error: string
      }
  > {
    const team = null
    const collections = restCollectionStore.value.state
    const lookup = lookupCollection(collections, collName)
    if (!lookup || "ambiguous" in lookup) {
      return { error: this.collectionMiss(collName, lookup) }
    }
    const found = lookup.found
    const target = root
      ? collections[parseInt(found.path.split("/")[0])]
      : found.collection
    if (!target?.id) {
      return {
        error: `**${(root ? target?.name : found.label) ?? collName}** hasn't been synced to the server yet (sign in and wait a moment), so it can't be used here.`,
      }
    }
    return {
      id: target.id,
      name: root ? target.name : found.label,
      title: target.name?.trim() || found.label,
    }
  }
  /** Backend id of an environment by name, in the active workspace. */
  private async resolveEnvironmentID(envName: string): Promise<
    | {
        id: string
        name: string
      }
    | {
        error: string
      }
  > {
    const team = null
    const envs = environmentsStore.value.environments
    const picked = pickByName(envs, envName, (e) => e.name)
    if (!picked)
      return { error: `I couldn't find an environment named "${envName}".` }
    if ("ambiguous" in picked) {
      return {
        error: this.ambiguousEnvReply(
          envName,
          picked.ambiguous.map((e) => e.name)
        ),
      }
    }
    const match = picked.item
    if (!match.id) {
      return {
        error: `Environment **${match.name}** hasn't been synced to the server yet, so it can't be attached.`,
      }
    }
    return { id: match.id, name: match.name }
  }
  /** The published docs of a collection, refreshed from the server first. */
  private async loadPublishedDocs(
    collectionID: string
  ): Promise<PublishedDocInfo[]> {
    const team = null
    try {
      {
        await this.documentationService.fetchUserPublishedDocs()
      }
    } catch (e) {
      console.error("[AIChat] failed to refresh published docs:", e)
    }
    return this.documentationService.getPublishedDocStatus(collectionID) ?? []
  }
  private findPublishedVersion(
    docs: PublishedDocInfo[],
    version: string
  ): PublishedDocInfo | undefined {
    return (
      docs.find((d) => d.version === version) ??
      docs.find((d) => d.version.toLowerCase() === version.toLowerCase())
    )
  }
  private async publishDocumentation(
    collName: string,
    title: string | undefined,
    version: string | undefined,
    envName: string | undefined,
    generation = this.turnGeneration
  ): Promise<string> {
    if (!collName) return "Which collection should I publish?"
    if (!settingsStore.value.ENABLE_EXPERIMENTAL_DOCUMENTATION) {
      return "Documentation management is turned off. Enable it on the Documentation page."
    }
    const team = null
    const target = await this.resolveBackendCollection(collName)
    if ("error" in target) return target.error
    const docVersion = (version || "CURRENT").trim()
    if (!/^[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*$/.test(docVersion)) {
      return `⚠️ "${docVersion}" isn't a valid version — use letters, digits, dots, or dashes (e.g. CURRENT, v1, 2.0).`
    }
    let environment:
      | {
          id: string
          name: string
        }
      | undefined
    if (envName) {
      const resolved = await this.resolveEnvironmentID(envName)
      if ("error" in resolved) return resolved.error
      environment = resolved
    }
    const docs = await this.loadPublishedDocs(target.id)
    const existing = this.findPublishedVersion(docs, docVersion)
    if (existing && !title && !environment) {
      return `**${target.name}** already has a published ${existing.autoSync ? "live" : "snapshot"} version ${existing.version}: ${existing.url}. Pass a title or environment to change it.`
    }
    // Going public, or exposing an environment's values: the user decides.
    if (!existing || environment) {
      if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
      const confirmed = await this.confirm(
        "publish-docs",
        target.name,
        generation,
        {
          version: existing?.version ?? docVersion,
          environment: environment?.name,
        }
      )
      if (!confirmed) return `Didn't publish **${target.name}**.`
      if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
    }
    let info: PublishedDocInfo
    if (existing) {
      // Update only what was asked for. The sync mode is deliberately not
      // sent: forcing autoSync on would wipe a frozen snapshot version.
      const args: UpdatePublishedDocsArgs = {
        ...(title ? { title } : {}),
        ...(environment ? { environmentID: environment.id } : {}),
      }
      const res = await getWebBackend().updatePublishedDoc(existing.id, args)()
      if (E.isLeft(res)) {
        return `⚠️ Couldn't update the published docs: ${this.describeGQLError(res.left)}.`
      }
      const doc = res.right.updatePublishedDoc
      info = {
        ...existing,
        title: doc.title,
        version: doc.version,
        autoSync: doc.autoSync,
        url: doc.url,
        environmentName:
          doc.environmentName ?? existing.environmentName ?? null,
        environmentID: environment?.id ?? existing.environmentID ?? null,
        updatedOn: doc.updatedOn,
      }
      this.documentationService.setPublishedDocStatus(
        target.id,
        null,
        existing.id
      )
      this.documentationService.setPublishedDocStatus(target.id, info)
    } else {
      const args: CreatePublishedDocsArgs = {
        // The page is titled like the folder, not its path.
        title: title || target.title,
        version: docVersion,
        autoSync: true,
        workspaceType: WorkspaceType.User,
        workspaceID: "",
        collectionID: target.id,
        metadata: "{}",
        environmentID: environment?.id,
      }
      const res = await getWebBackend().createPublishedDoc(args)()
      if (E.isLeft(res)) {
        return `⚠️ Couldn't publish the docs: ${this.describeGQLError(res.left)}.`
      }
      const doc = res.right.createPublishedDoc
      info = {
        id: doc.id,
        title: doc.title,
        version: doc.version,
        autoSync: doc.autoSync,
        url: doc.url,
        environmentName: doc.environmentName ?? null,
        environmentID: environment?.id ?? null,
        collection: { id: target.id },
        createdOn: doc.createdOn,
        updatedOn: doc.updatedOn,
      }
      this.documentationService.setPublishedDocStatus(target.id, info)
    }
    return `📖 ${existing ? "Updated" : "Published"} the documentation for **${target.name}** (version ${info.version}, ${info.autoSync ? "live, auto-synced" : "snapshot"}): ${info.url}${
      environment
        ? `\n⚠️ Environment **${environment.name}** is attached — its variable values are now publicly visible on that page.`
        : ""
    }`
  }
  private async unpublishDocumentation(
    collName: string,
    version: string | undefined,
    generation = this.turnGeneration
  ): Promise<string> {
    if (!collName) return "Which collection's documentation should I unpublish?"
    if (!settingsStore.value.ENABLE_EXPERIMENTAL_DOCUMENTATION) {
      return "Documentation management is turned off. Enable it on the Documentation page."
    }
    const team = null
    const target = await this.resolveBackendCollection(collName)
    if ("error" in target) return target.error
    const docs = await this.loadPublishedDocs(target.id)
    if (!docs.length) {
      return `**${target.name}** has no published documentation.`
    }
    let doc: PublishedDocInfo | undefined
    if (version) {
      doc = this.findPublishedVersion(docs, version)
      if (!doc) {
        return `No published version "${version}" for **${target.name}**. Published: ${docs
          .map((d) => d.version)
          .join(", ")}.`
      }
    } else if (docs.length === 1) {
      doc = docs[0]
    } else {
      return `**${target.name}** has several published versions (${docs
        .map((d) => d.version)
        .join(", ")}) — which one should I unpublish?`
    }
    // Irreversible: the public link breaks and a snapshot is gone for good.
    if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
    const confirmed = await this.confirm(
      "unpublish-docs",
      target.name,
      generation,
      { version: doc.version }
    )
    if (!confirmed) return `Left **${target.name}** ${doc.version} published.`
    if (this.workspaceMoved()) return WORKSPACE_MOVED_REPLY
    const res = await getWebBackend().deletePublishedDoc(doc.id)()
    if (E.isLeft(res)) {
      return `⚠️ Couldn't unpublish: ${this.describeGQLError(res.left)}.`
    }
    this.documentationService.setPublishedDocStatus(target.id, null, doc.id)
    return `📖 Unpublished version ${doc.version} of **${target.name}**'s documentation.`
  }
  /** Deep-clones a request so store/tab copies stay independent of the source. */
  private cloneRequest(request: HoppRESTRequest): HoppRESTRequest {
    return JSON.parse(JSON.stringify(request)) as HoppRESTRequest
  }
  private cloneCollection(collection: HoppCollection): HoppCollection {
    return JSON.parse(JSON.stringify(collection)) as HoppCollection
  }
  /**
   * Switches the active tab between REST and GraphQL via the shared
   * protocol-switch flow (drafts preserve the other protocol's edits).
   */
  private switchProtocol(target: string): string {
    const doc = this.tabService.currentActiveTab.value?.document
    if (doc?.type !== "request" && doc?.type !== "gql-request") {
      return "Open a request tab first so I can switch its protocol."
    }
    // The UI switcher is hidden when the setting is off — a tab converted
    // from chat would have no way back.
    if (!settingsStore.value.ENABLE_GQL_IN_REST_WORKSPACE) {
      return 'Protocol switching is turned off — enable "GraphQL in REST workspace" in Settings first.'
    }
    const services = {
      tabs: this.tabService,
      gqlTabConn: this.gqlTabConnection,
      scrollService: this.scrollService,
    }
    if (target === "graphql" || target === "gql") {
      if (doc.type === "gql-request") {
        return "This tab is already a GraphQL request tab."
      }
      return switchActiveTabToGQL(services)
        ? "🔀 Switched the tab to **GraphQL** (the REST edits are kept as a draft)."
        : "I couldn't switch this tab to GraphQL."
    }
    if (target === "rest" || target === "http") {
      if (doc.type === "request") {
        return "This tab is already a REST request tab."
      }
      return switchActiveTabToREST(services)
        ? "🔀 Switched the tab to **REST** (the GraphQL edits are kept as a draft)."
        : "I couldn't switch this tab to REST."
    }
    return 'Which protocol — "rest" or "graphql"?'
  }
  /**
   * Watches the active tab's response after a run is triggered and records
   * the outcome (status, time, size) on the returned run.
   */
  private reportRunOutcome(
    getResponse: () => HoppRESTResponse | null | undefined
  ): RunStep {
    const run = this.trackRun()
    let settled = false
    let stop: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    run.cancel = () => {
      settled = true
      if (stop) stop()
      if (timer) clearTimeout(timer)
    }
    const finish = (text: string) => {
      if (settled) return
      run.cancel()
      this.finishRun(run, text)
    }
    // `newSendRequest` sets the response to "loading" synchronously, so the next
    // change we observe is the settled (terminal) response.
    stop = watch(getResponse, (res) => {
      if (!res || res.type === "loading") return
      finish(this.describeRunResponse(res))
    })
    // Stop watching if the request never comes back.
    timer = setTimeout(() => {
      finish("⏱️ Still running — check the response panel for the result.")
    }, 120000)
    return run
  }
  /**
   * Watches the active GQL tab's event stream after a run is triggered and
   * posts a follow-up message when the next event lands. (For subscriptions
   * the first streamed event reports; the panel carries the rest.)
   */
  private reportGQLRunOutcome(
    getEvents: () => GQLResponseEvent[] | null | undefined
  ): RunStep {
    // A discrete run REPLACES the doc's event array with a fresh one (only
    // subscription streams append — see gql/RequestOptions.vue's message-event
    // watcher), so the array length may not change between runs. Track the
    // last event by object identity instead: a replace swaps in new event
    // objects and an append grows the tail, so either way the settled event
    // compares unequal to the baseline.
    const initial = getEvents()
    const baselineLast = initial?.length ? initial[initial.length - 1] : null
    const run = this.trackRun()
    let settled = false
    let stop: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    run.cancel = () => {
      settled = true
      if (stop) stop()
      if (timer) clearTimeout(timer)
    }
    const finish = (text: string) => {
      if (settled) return
      run.cancel()
      this.finishRun(run, text)
    }
    stop = watch(
      () => {
        const events = getEvents()
        return events?.length ? events[events.length - 1] : null
      },
      (last) => {
        if (!last || last === baselineLast) return
        finish(this.describeGQLRunEvent(last))
      }
    )
    timer = setTimeout(() => {
      finish("⏱️ Still running — check the response panel for the result.")
    }, 120000)
    return run
  }
  /** Turns a GQL run/subscription event into a short status line. */
  private describeGQLRunEvent(event: GQLResponseEvent): string {
    if (event.type === "error") {
      const message =
        typeof event.error?.message === "string"
          ? event.error.message
          : "the operation failed"
      return `❌ GraphQL error: ${message}`
    }
    if (event.type === "response") {
      if (event.document) {
        const ok =
          event.document.statusCode >= 200 && event.document.statusCode < 300
        const status = [event.document.statusCode, event.document.statusText]
          .filter(Boolean)
          .join(" ")
        const time = `${Math.round(event.document.meta.responseDuration)} ms`
        const size = this.formatBytes(event.document.meta.responseSize)
        return `${ok ? "✅" : "⚠️"} Response: **${status}** · ${time} · ${size}`
      }
      return `✅ ${event.operationType ?? "Operation"} completed — check the response panel.`
    }
    return "The operation finished — check the response panel."
  }
  /** Turns a settled response into a short, human-readable status line. */
  private describeRunResponse(res: HoppRESTResponse): string {
    switch (res.type) {
      case "success":
      case "failure": {
        const ok = res.statusCode >= 200 && res.statusCode < 300
        const status = [res.statusCode, res.statusText]
          .filter(Boolean)
          .join(" ")
        const time = `${Math.round(res.meta.responseDuration)} ms`
        const size = this.formatBytes(res.meta.responseSize)
        return `${ok ? "✅" : "⚠️"} Response: **${status}** · ${time} · ${size}`
      }
      case "network_fail":
        return "❌ Network error — couldn't reach the server."
      case "script_fail":
        return `❌ Script error: ${res.error?.message ?? "failed to run script"}`
      case "interceptor_error":
        if (res.error === "cancellation") return "■ Request cancelled."
        return `❌ ${
          res.error?.humanMessage?.description?.(this.t) ??
          "The request failed."
        }`
      case "extension_error":
        return `❌ ${res.error ?? "The browser extension failed to run the request."}`
      default:
        return "The request finished."
    }
  }
  /** Formats a byte count as B / KB / MB. */
  private formatBytes(n: number): string {
    if (!n || n < 0) return "0 B"
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }
  /** Appends a fresh assistant message and streams `text` into it. */
  private async postAssistantMessage(
    text: string,
    kind?: "tool",
    modelContent?: string,
    id = this.nextId()
  ) {
    const msg: ChatMessage = {
      id,
      role: "assistant",
      content: "",
      pending: true,
    }
    if (kind) msg.kind = kind
    if (modelContent !== undefined) msg.modelContent = modelContent
    this.messages.value.push(msg)
    try {
      await this.streamText(id, text)
    } finally {
      this.finalizeById(id)
    }
  }
  /**
   * Types `text` into the message with the given id. Cosmetic, and the tool
   * loop waits on it, so it is capped at MAX_TYPING_MS — and instant in a
   * hidden tab, where timers are throttled to a second or more.
   */
  private async streamText(id: string, text: string) {
    const tokens = text.match(/\s+|\S+/g) ?? [text]
    const perTick = Math.ceil(
      tokens.length / Math.floor(MAX_TYPING_MS / TYPING_TICK_MS)
    )
    for (let i = 0; i < tokens.length; i += perTick) {
      const hidden = typeof document !== "undefined" && document.hidden
      if (!hidden) await delay(TYPING_TICK_MS)
      const msg = this.messages.value.find((m) => m.id === id)
      // Cleared mid-stream, or settled by Stop: typing on would re-announce it.
      if (!msg?.pending) return
      const end = hidden ? tokens.length : i + perTick
      msg.content += tokens.slice(i, end).join("")
      if (hidden) return
    }
  }
}
