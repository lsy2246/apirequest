import {
  summarizeRunnerResponse,
  summarizeRunnerFailure,
} from "~/helpers/test-runner/report"
import {
  HoppCollection,
  HoppCollectionVariable,
  Environment,
  HoppGQLRequest,
  HoppRESTHeaders,
  HoppRESTRequest,
} from "@apirequest/data"
import { Service } from "dioc"
import { assertCollectionLoaded } from "~/helpers/collection-summary"
import { hasActualScript } from "@apirequest/js-sandbox/scripting"
import * as E from "fp-ts/Either"
import { cloneDeep } from "lodash-es"
import { nextTick, Ref } from "vue"
import {
  captureInitialEnvironmentState,
  runTestRunnerRequest,
  type InitialEnvironmentState,
} from "~/helpers/RequestRunner"
import { runTestRunnerGQLRequest } from "~/helpers/graphql/testRunner"
import { isGQLRequest } from "~/helpers/request-type"
import {
  HoppTestRunnerDocument,
  TestRunnerMeta,
  TestRunnerConfig,
} from "~/helpers/tab/document"
import { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse"
import { HoppTestData, HoppTestResult } from "~/helpers/types/HoppTestResult"
import { HoppTab } from "../tab"
import { resolveInheritedVariables } from "~/helpers/utils/inheritedCollectionVarTransformer"
import { datasetRowToTempVars } from "~/helpers/runner/dataset"
import {
  applyRunOrder,
  getRequestSelectionID,
} from "~/helpers/runner/selection"
import {
  clearTemporaryVariables,
  getTemporaryVariables,
  setTemporaryVariables,
} from "~/helpers/runner/temp_envs"
import { requestHasResult, requestFailed } from "~/helpers/runner/outcome"

// Sentinel errors that unwind the runner: "Test execution stopped" is a user
// cancel, "…stopped due to error" a stop-on-error halt. Both are normal
// terminations, so unwinding catches must recognize either form.
const STOP_SIGNAL_PREFIX = "Test execution stopped"
const isStopSignal = (error: unknown): error is Error =>
  error instanceof Error && error.message.startsWith(STOP_SIGNAL_PREFIX)

export type TestRunnerOptions = {
  recovery?: ManualRunRecovery
  onProgress?: () => Promise<void>
  stopRef: Ref<boolean>
} & TestRunnerConfig

/**
 * One request resolved against its ancestry and bound to its slot in the
 * result tree.
 */
export type PlannedRequest = {
  /** Selection ID — how the run sequence refers to this request. */
  id: string
  request: TestRunnerRequest
  /** Owning collection/folder, for the test-script context. */
  collection: HoppCollection
  /** Folder names from the run root down to this request's parent. */
  folderPath: string[]
  inheritedVariables: HoppCollectionVariable[]
  inheritedPreRequestScripts: string[]
  inheritedTestScripts: string[]
  /** Kept unmerged for GQL requests — their executor slots auth headers
   * between request and inherited headers itself. */
  inheritedHeaders: HoppRESTHeaders
}

export type ManualRunRecovery = {
  version: 1
  collection: HoppCollection
  config: TestRunnerConfig
  plan: PlannedRequest[]
  iteration: number
  nextRequest: number
  inFlight?: { name: string; iteration: number }
  environment?: InitialEnvironmentState
  baseEnvironment?: InitialEnvironmentState
  temporaryVariables: ReturnType<typeof getTemporaryVariables>
}

/**
 * Run-result decorations attached to every request in the result tree —
 * shared by both protocols.
 */
type TestRunnerResultFields = {
  type: "test-response"
  reportResponse?: ReturnType<typeof summarizeRunnerResponse>
  response?: HoppRESTResponse | null
  testResults?: HoppTestResult | null
  isLoading?: boolean
  error?: string
  renderResults?: boolean
  passedTests: number
  failedTests: number
  runnerRequestID?: string
  /** Folder names from the run root down to this request's parent. */
  folderPath?: string[]
}

/**
 * A request inside a collection run. Unified collections hold both REST and
 * GraphQL requests in the same `requests` array, so the runner discriminates
 * per entry by shape (`isGQLRequest`). GraphQL responses are shaped as
 * `HoppRESTResponse` (GraphQL-over-HTTP is a POST) so the result tree and
 * response viewer render both protocols identically.
 */
export type TestRunnerRequest = (HoppRESTRequest | HoppGQLRequest) &
  TestRunnerResultFields

function delay(timeMS: number) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, timeMS)
    return () => {
      clearTimeout(timeout)
      reject(new Error("Operation cancelled"))
    }
  })
}

export class TestRunnerService extends Service {
  public static readonly ID = "TEST_RUNNER_SERVICE"

  private readonly activeRunStops = new Map<string, Ref<boolean>>()

  private readonly runControls = new Map<
    string,
    {
      tab: Ref<HoppTab<HoppTestRunnerDocument>>
      options: TestRunnerOptions
      paused: boolean
      wake?: () => void
      interruptDelay?: () => void
    }
  >()

  public pauseRun(tabID: string): boolean {
    const control = this.runControls.get(tabID)
    if (!control || control.options.stopRef.value) return false
    control.paused = true
    control.tab.value.document.status = "pausing"
    control.interruptDelay?.()
    void control.options.onProgress?.()
    return true
  }

  public resumeRun(tabID: string): boolean {
    const control = this.runControls.get(tabID)
    if (!control || !control.paused) return false
    control.paused = false
    control.tab.value.document.status = "running"
    control.wake?.()
    void control.options.onProgress?.()
    return true
  }

  private async waitForResume(tabID: string) {
    const control = this.runControls.get(tabID)
    if (!control) return
    while (control.paused && !control.options.stopRef.value) {
      control.tab.value.document.status = "paused"
      // Install the wake-up before saving: resume/stop may arrive while storage is busy.
      const resumed = new Promise<void>((resolve) => {
        control.wake = resolve
      })
      await control.options.onProgress?.()
      await resumed
      control.wake = undefined
    }
    if (control.options.stopRef.value) throw new Error("Test execution stopped")
  }

  private async waitBetweenRequests(tabID: string, milliseconds: number) {
    const control = this.runControls.get(tabID)
    if (!control) return delay(milliseconds)
    let remaining = milliseconds
    while (remaining > 0) {
      await this.waitForResume(tabID)
      const started = performance.now()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining)
        control.interruptDelay = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      control.interruptDelay = undefined
      remaining -= performance.now() - started
    }
    await this.waitForResume(tabID)
  }

  /** Signals the active run in a tab to stop after its current request settles. */
  public stopRun(tabID: string): boolean {
    const stopRef = this.activeRunStops.get(tabID)
    if (!stopRef) return false
    stopRef.value = true
    this.runControls.get(tabID)?.wake?.()
    this.runControls.get(tabID)?.interruptDelay?.()
    return true
  }

  public hasRun(tabID: string) {
    return this.runControls.has(tabID)
  }

  public discardPausedRun(tabID: string) {
    const control = this.runControls.get(tabID)
    if (control?.tab.value.document.status === "paused")
      return this.stopRun(tabID)
    return false
  }

  private createEmptyMeta(): TestRunnerMeta {
    return {
      totalRequests: 0,
      completedRequests: 0,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      totalTime: 0,
    }
  }

  private createResultCollection(collection: HoppCollection): HoppCollection {
    return {
      v: collection.v,
      id: collection.id,
      name: collection.name,
      auth: collection.auth,
      headers: collection.headers,
      folders: [],
      requests: [],
      variables: [],
      description: collection.description ?? null,
      preRequestScript: collection.preRequestScript ?? "",
      testScript: collection.testScript ?? "",
    }
  }

  private shouldRunRequest(
    request: HoppRESTRequest | HoppGQLRequest,
    path: number[],
    selectedIDs: Set<string>,
    selectionActive: boolean
  ) {
    return (
      !selectionActive || selectedIDs.has(getRequestSelectionID(request, path))
    )
  }

  private collectionHasSelectedRequest(
    collection: HoppCollection,
    parentPath: number[],
    selectedIDs: Set<string>,
    selectionActive: boolean
  ): boolean {
    if (!selectionActive) return true

    return (
      collection.requests.some((request, index) =>
        this.shouldRunRequest(
          request as HoppRESTRequest,
          [...parentPath, index],
          selectedIDs,
          selectionActive
        )
      ) ||
      collection.folders.some((folder, index) =>
        this.collectionHasSelectedRequest(
          folder,
          [...parentPath, index],
          selectedIDs,
          selectionActive
        )
      )
    )
  }

  public runTests(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    collection: HoppCollection,
    options: TestRunnerOptions,
    ancestorPreRequestScripts: string[] = [],
    ancestorTestScripts: string[] = [],
    // Pre-resolved under their owning collections; the run root's own
    // variables stay raw on `collection.variables` for the plan walk.
    ancestorVariables: HoppCollectionVariable[] = []
  ) {
    assertCollectionLoaded(collection)
    const tabID = tab.value.id
    tab.value.document.runError = undefined
    // `undefined` runs the full collection; an array runs that subset.
    const selection = tab.value.document.selectedRequestRefIds
    const selectionActive = Array.isArray(selection)
    const selectedIDs = new Set(selection ?? [])

    // A selection can resolve to zero requests: an explicitly empty array
    // (the UI sends `undefined` for "run all"), or IDs that stopped resolving
    // after a refetch. Fail loudly rather than report a successful empty run.
    if (
      !options.recovery &&
      selectionActive &&
      !this.collectionHasSelectedRequest(collection, [], selectedIDs, true)
    ) {
      tab.value.document.status = "error"
      tab.value.document.iterationResults = []
      tab.value.document.testRunnerMeta = this.createEmptyMeta()
      tab.value.document.runError =
        "The request selection matches no requests in this collection"
      console.error(
        "[Test Runner] The request selection matches no requests in this " +
          "collection. Provide at least one request that exists in the tree, " +
          "or omit the selection to run the full collection."
      )
      return options.onProgress?.()
    }

    this.activeRunStops.set(tabID, options.stopRef)
    this.runControls.set(tabID, { tab, options, paused: false })

    // Reset the result collection
    tab.value.document.status = "running"
    tab.value.document.request = null
    tab.value.document.selectedRequestPath = undefined
    tab.value.document.resultCollection = undefined
    if (!options.recovery) {
      tab.value.document.iterationResults = []
      tab.value.document.selectedIteration = 0
      tab.value.document.testRunnerMeta = this.createEmptyMeta()
      clearTemporaryVariables()
    } else setTemporaryVariables(cloneDeep(options.recovery.temporaryVariables))

    // One run per dataset row when a data file is attached; config.iterations
    // only drives dataset-less runs (persisted/external state can diverge
    // from the UI's lock).
    const resolvedIterations = options.dataset?.rows.length
      ? options.dataset.rows.length
      : Math.max(1, Math.floor(Number(options.iterations)) || 1)

    // The selection array doubles as the run order; anything it doesn't
    // mention keeps collection order, after everything it does.
    const runOrder = new Map((selection ?? []).map((id, index) => [id, index]))

    options.recovery ??= {
      version: 1,
      collection: cloneDeep(collection),
      config: cloneDeep(tab.value.document.config),
      plan: cloneDeep(
        applyRunOrder(
          this.planCollection(
            collection,
            selectedIDs,
            selectionActive,
            [],
            [],
            undefined,
            undefined,
            ancestorVariables,
            ancestorPreRequestScripts,
            ancestorTestScripts
          ),
          runOrder
        ).map((entry) => ({
          ...entry,
          collection: this.createResultCollection(entry.collection),
        }))
      ),
      iteration: 0,
      nextRequest: 0,
      temporaryVariables: [],
      environment: cloneDeep(captureInitialEnvironmentState()),
      baseEnvironment: cloneDeep(captureInitialEnvironmentState()),
    }
    tab.value.document.recovery = options.recovery
    const execute = () =>
      this.runTestIterations(tab, collection, options, resolvedIterations)
    return (options.onProgress ? options.onProgress().then(execute) : execute())
      .then(() => {
        tab.value.document.status = options.stopRef.value
          ? "stopped"
          : "completed"
      })
      .catch((error) => {
        if (isStopSignal(error)) {
          tab.value.document.status = options.stopRef.value
            ? "stopped"
            : "paused"
        } else {
          tab.value.document.status = "error"
          tab.value.document.runError = error
          console.error("Test runner failed:", error)
        }
      })
      .finally(async () => {
        this.runControls.delete(tabID)
        await options.onProgress?.()
        if (this.activeRunStops.get(tabID) === options.stopRef) {
          this.activeRunStops.delete(tabID)
        }
      })
  }

  private async runTestIterations(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    collection: HoppCollection,
    options: TestRunnerOptions,
    resolvedIterations: number
  ) {
    for (
      let iterationIndex = options.recovery?.iteration ?? 0;
      iterationIndex < resolvedIterations;
      iterationIndex++
    ) {
      await this.waitForResume(tab.value.id)
      if (options.stopRef?.value) {
        tab.value.document.status = "stopped"
        throw new Error("Test execution stopped")
      }

      const recovery = options.recovery!
      if (!options.keepVariableValues && recovery.nextRequest === 0) {
        clearTemporaryVariables()
        recovery.environment = cloneDeep(recovery.baseEnvironment)
      }

      // Advance frozen scopes only after settled results; resetting a new
      // iteration uses the original baseline when variable persistence is off.
      const iterationEnvState = recovery.environment

      const existing = tab.value.document.iterationResults?.find(
        (result) => result.iteration === iterationIndex + 1
      )
      const resultCollection =
        existing?.resultCollection ?? this.createResultCollection(collection)
      const meta = existing?.meta ?? this.createEmptyMeta()
      // The UI locks the iteration count to the dataset length; if the two
      // ever diverge, reuse the last row rather than read out of bounds.
      const iterationVars = options.dataset?.rows.length
        ? datasetRowToTempVars(
            options.dataset.rows[
              Math.min(iterationIndex, options.dataset.rows.length - 1)
            ]
          )
        : []

      if (!existing)
        tab.value.document.iterationResults?.push({
          iteration: iterationIndex + 1,
          resultCollection,
          meta,
        })
      // `selectedIteration` is the iteration the user is VIEWING — owned by
      // the jump control and scroll tracking, not the run. Advancing it here
      // left a finished run's counter parked on the last iteration while the
      // viewport still showed the first.
      tab.value.document.resultCollection = resultCollection

      // Read the collection back off the document: the assignment above stores
      // the raw object, and mutating a raw object never notifies Vue — rows
      // must be appended through the reactive view.
      const liveResultCollection = tab.value.document.resultCollection!

      const orderedPlan = recovery.plan

      // Results are a flat list in run order; each row carries its folder
      // path instead of nesting back under folders.
      orderedPlan.forEach((entry, index) => {
        if (liveResultCollection.requests[index]) return
        this.addRequestToPath(liveResultCollection, [], {
          ...cloneDeep(entry.request),
          runnerRequestID: entry.id,
          folderPath: entry.folderPath,
          passedTests: 0,
          failedTests: 0,
        })
      })

      tab.value.document.testRunnerMeta.totalRequests =
        orderedPlan.length * resolvedIterations
      meta.totalRequests = orderedPlan.length

      await this.runPlan(
        tab,
        orderedPlan,
        options,
        meta,
        iterationVars,
        iterationEnvState
      )
      recovery.iteration = iterationIndex + 1
      recovery.nextRequest = 0
      recovery.inFlight = undefined
      recovery.temporaryVariables = cloneDeep(getTemporaryVariables())
      await options.onProgress?.()
    }
  }

  /**
   * Walks the collection and returns the requests to run, each with inherited
   * auth/headers/variables/scripts resolved against its own ancestry.
   *
   * Planning is separate from execution so the run sequence can reorder
   * across folders; result slots are allocated after ordering so results
   * read in executed order.
   */
  private planCollection(
    collection: HoppCollection,
    selectedIDs: Set<string>,
    selectionActive: boolean,
    sourceParentPath: number[] = [],
    folderPath: string[] = [],
    parentHeaders?: HoppRESTHeaders,
    parentAuth?: HoppRESTRequest["auth"],
    parentVariables: HoppCollection["variables"] = [],
    parentPreRequestScripts: string[] = [],
    parentTestScripts: string[] = []
  ): PlannedRequest[] {
    const inheritedAuth =
      collection.auth?.authType === "inherit" && collection.auth.authActive
        ? parentAuth || { authType: "none", authActive: false }
        : collection.auth || { authType: "none", authActive: false }

    const inheritedHeaders: HoppRESTHeaders = [
      ...(parentHeaders || []),
      ...collection.headers,
    ]

    // Parents pass through already resolved; only this collection's own
    // variables are populated here, under its own ID. The server `id`
    // fallback mirrors the save-side keying for team collections, whose
    // `_ref_id` is regenerated on every fetch. `showSecret` is true because
    // this feeds execution only — planned requests are never persisted.
    const inheritedVariables = resolveInheritedVariables(
      parentVariables,
      collection.variables,
      collection._ref_id || collection.id,
      collection.id,
      true
    )

    const inheritedPreRequestScripts = [
      ...parentPreRequestScripts,
      ...(hasActualScript(collection.preRequestScript)
        ? [collection.preRequestScript]
        : []),
    ]
    const inheritedTestScripts = [
      ...parentTestScripts,
      ...(hasActualScript(collection.testScript)
        ? [collection.testScript]
        : []),
    ]

    const planned: PlannedRequest[] = []

    // Folders (depth-first) before a node's own requests — must match
    // `collectRequestIDs` and the run-sequence UI's flatten.
    for (let i = 0; i < collection.folders.length; i++) {
      const folder = collection.folders[i]
      const sourcePath = [...sourceParentPath, i]

      if (
        !this.collectionHasSelectedRequest(
          folder,
          sourcePath,
          selectedIDs,
          selectionActive
        )
      ) {
        continue
      }

      planned.push(
        ...this.planCollection(
          folder,
          selectedIDs,
          selectionActive,
          sourcePath,
          [...folderPath, folder.name],
          inheritedHeaders,
          inheritedAuth,
          inheritedVariables,
          inheritedPreRequestScripts,
          inheritedTestScripts
        )
      )
    }

    for (let i = 0; i < collection.requests.length; i++) {
      const request = collection.requests[i] as TestRunnerRequest
      const sourcePath = [...sourceParentPath, i]

      if (
        !this.shouldRunRequest(
          request,
          sourcePath,
          selectedIDs,
          selectionActive
        )
      ) {
        continue
      }

      // Cast note: collection auth is the full REST auth union, so a GQL
      // request inheriting (say) digest auth temporarily violates the
      // HoppGQLAuth type. That's deliberate — the GQL run executor signs
      // with the REST auth generators, which cover the full union.
      //
      // Headers: REST pre-merges inherited headers into the request (the
      // REST executor expects that). GQL keeps its own headers and gets the
      // inherited ones separately, so the executor can slot auth headers
      // between them (precedence: request > auth > inherited).
      planned.push({
        id: getRequestSelectionID(request, sourcePath),
        request: {
          ...request,
          auth:
            request.auth.authType === "inherit" && request.auth.authActive
              ? inheritedAuth
              : request.auth,
          headers: isGQLRequest(request)
            ? request.headers
            : [...inheritedHeaders, ...request.headers],
        } as TestRunnerRequest,
        collection,
        folderPath,
        inheritedVariables,
        inheritedPreRequestScripts,
        inheritedTestScripts,
        inheritedHeaders,
      })
    }

    return planned
  }

  /**
   * Runs a plan in the given order, which is the user's run sequence when they
   * set one and plain collection order otherwise.
   */
  private async runPlan(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    plan: PlannedRequest[],
    options: TestRunnerOptions,
    iterationMeta: TestRunnerMeta,
    iterationVars: Environment["variables"],
    iterationEnvState?: InitialEnvironmentState
  ) {
    try {
      for (const [index, entry] of plan.entries()) {
        const recovery = options.recovery
        if (recovery && index < recovery.nextRequest) continue
        if (options.stopRef?.value) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped")
        }

        await this.waitForResume(tab.value.id)
        if (recovery)
          recovery.inFlight = {
            name: entry.request.name,
            iteration: recovery.iteration + 1,
          }
        await options.onProgress?.()
        try {
          await this.runTestRequest(
            tab,
            entry.request,
            entry.collection,
            options,
            // Result rows are allocated in this same order: plan index = row.
            [index],
            iterationMeta,
            iterationVars,
            entry.inheritedVariables,
            entry.inheritedPreRequestScripts,
            entry.inheritedTestScripts,
            recovery?.environment ?? iterationEnvState,
            entry.inheritedHeaders
          )
        } finally {
          const result = tab.value.document.resultCollection!.requests[
            index
          ] as TestRunnerRequest
          if (recovery && requestHasResult(result)) {
            recovery.nextRequest = index + 1
            recovery.inFlight = undefined
            recovery.temporaryVariables = cloneDeep(getTemporaryVariables())
            const state = recovery.environment
            if (state && result.testResults?.envDiff) {
              for (const scope of ["global", "selected"] as const) {
                const diff = result.testResults.envDiff[scope]
                const values = new Map(
                  state.initialEnvs[scope].map((value) => [value.key, value])
                )
                for (const value of diff.deletions) values.delete(value.key)
                for (const value of [...diff.additions, ...diff.updations])
                  values.set(value.key, value)
                state.initialEnvs[scope] = cloneDeep([...values.values()])
              }
              state.initialGlobalEnvs = cloneDeep(state.initialEnvs.global)
              state.initialSelectedEnvs = cloneDeep(state.initialEnvs.selected)
              state.initialEnvsForComparison = cloneDeep({
                global: state.initialEnvs.global,
                selected: state.initialEnvs.selected,
              })
            }
          }
          if (
            options.stopOnError &&
            requestHasResult(result) &&
            requestFailed(result) &&
            (recovery?.iteration ?? 0) * plan.length + index + 1 <
              tab.value.document.testRunnerMeta.totalRequests
          ) {
            const control = this.runControls.get(tab.value.id)
            if (control) control.paused = true
            tab.value.document.status = "paused"
          }
          await options.onProgress?.()
        }
        await this.waitForResume(tab.value.id)
        if (options.delay && options.delay > 0) {
          try {
            await this.waitBetweenRequests(tab.value.id, options.delay)
          } catch (_error) {
            if (options.stopRef?.value) {
              tab.value.document.status = "stopped"
              throw new Error("Test execution stopped")
            }
          }
        }
      }
      if (options.stopRef?.value) throw new Error("Test execution stopped")
    } catch (error) {
      if (isStopSignal(error)) {
        throw error
      }
      tab.value.document.status = "error"
      console.error("Collection execution failed:", error)
      throw error
    }
  }

  private addRequestToPath(
    collection: HoppCollection,
    parentPath: number[],
    request: TestRunnerRequest
  ) {
    let current = collection

    // Navigate to the parent folder
    for (let i = 0; i < parentPath.length; i++) {
      current = current.folders[parentPath[i]]
    }

    current.requests.push(request)
    return current.requests.length - 1
  }

  private updateRequestAtPath(
    collection: HoppCollection,
    path: number[],
    updates: Partial<TestRunnerRequest>
  ) {
    let current = collection

    // Navigate to the parent folder
    for (let i = 0; i < path.length - 1; i++) {
      current = current.folders[path[i]]
    }

    // Mutate in place: selecting a request stores a reference to this object
    // on the tab (`document.request`); replacing it would orphan that
    // reference and the response would never reach the selected view.
    if (path.length > 0) {
      const index = path[path.length - 1]
      const target = current.requests[index]
      if (target) Object.assign(target, updates)
    }
  }

  private async runTestRequest(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    request: TestRunnerRequest,
    collection: HoppCollection,
    options: TestRunnerOptions,
    path: number[],
    iterationMeta: TestRunnerMeta,
    iterationVars: Environment["variables"],
    inheritedVariables: HoppCollectionVariable[] = [],
    inheritedPreRequestScripts: string[] = [],
    inheritedTestScripts: string[] = [],
    iterationEnvState?: InitialEnvironmentState,
    inheritedHeaders: HoppRESTHeaders = []
  ) {
    if (options.stopRef?.value) {
      throw new Error("Test execution stopped")
    }

    // GraphQL requests take their own execution path (HTTP POST, response
    // shaped as HoppRESTResponse so the shared result UI renders it) with
    // the same script stages as REST.
    if (isGQLRequest(request)) {
      return this.runTestGQLRequest(
        tab,
        request as HoppGQLRequest,
        options,
        path,
        iterationMeta,
        iterationVars,
        inheritedVariables,
        inheritedHeaders,
        inheritedPreRequestScripts,
        inheritedTestScripts,
        iterationEnvState
      )
    }

    try {
      // Update request status in the result collection
      this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
        isLoading: true,
        error: undefined,
      })

      // Reuse the per-iteration snapshot when variable values aren't
      // persisted; otherwise re-capture so this request sees env changes
      // persisted by earlier requests in the run.
      const initialEnvironmentState =
        iterationEnvState ?? captureInitialEnvironmentState()

      const results = await runTestRunnerRequest(
        options.executeScripts === false
          ? {
              ...(request as HoppRESTRequest),
              preRequestScript: "",
              testScript: "",
            }
          : (request as HoppRESTRequest),
        options.keepVariableValues,
        inheritedVariables,
        initialEnvironmentState,
        options.executeScripts === false ? [] : inheritedPreRequestScripts,
        options.executeScripts === false ? [] : inheritedTestScripts,
        iterationVars
      )

      if (results && E.isRight(results)) {
        const { response, testResult } = results.right
        const updatedRequest =
          options.executeScripts === false
            ? {
                ...results.right.updatedRequest,
                preRequestScript: request.preRequestScript,
                testScript: request.testScript,
              }
            : results.right.updatedRequest
        const { passed, failed } = this.getTestResultInfo(testResult)

        tab.value.document.testRunnerMeta.totalTests += passed + failed
        tab.value.document.testRunnerMeta.passedTests += passed
        tab.value.document.testRunnerMeta.failedTests += failed
        iterationMeta.totalTests += passed + failed
        iterationMeta.passedTests += passed
        iterationMeta.failedTests += failed

        // Update request with results and propagate pre-request script changes in the result collection
        this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
          ...updatedRequest,
          testResults: testResult,
          passedTests: passed,
          failedTests: failed,
          reportResponse: summarizeRunnerResponse(response, true),
          response: options.persistResponses ? response : null,
          isLoading: false,
        })

        if (response.type === "success" || response.type === "fail") {
          tab.value.document.testRunnerMeta.totalTime +=
            response.meta.responseDuration
          tab.value.document.testRunnerMeta.completedRequests += 1
          iterationMeta.totalTime += response.meta.responseDuration
          iterationMeta.completedRequests += 1
        }

        // A post-request script failure arrives as a Right with `scriptError`
        // set, so the Left/stop-on-error branch below never sees it. Halt
        // here after the row and meta have recorded the request.
        if (options.stopOnError && testResult.scriptError) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped due to error")
        }
      } else {
        const failure =
          results && E.isLeft(results)
            ? results.left
            : {
                type: "request_fail",
                error: "Request completed without a response",
              }
        const errorMsg =
          failure.error instanceof Error
            ? failure.error.message
            : String(failure.error)
        const original = summarizeRunnerFailure(
          failure.error,
          failure.type === "script_fail"
            ? "PRE_REQUEST_SCRIPT_ERROR"
            : "REQUEST_ERROR"
        )

        // Update request with error in the result collection
        this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
          error: errorMsg,
          reportResponse: original,
          isLoading: false,
          response: {
            type: "network_fail",
            error: failure.error,
            req: request,
          },
        })

        if (options.stopOnError) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped due to error")
        }
      }
      if (options.stopRef?.value) throw new Error("Test execution stopped")
    } catch (error) {
      if (isStopSignal(error)) {
        throw error
      }

      const errorMsg =
        error instanceof Error ? error.message : "Unknown error occurred"

      // Update request with error in the result collection
      this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
        error: errorMsg,
        reportResponse: summarizeRunnerFailure(error, "REQUEST_ERROR"),
        isLoading: false,
      })

      if (options.stopOnError) {
        tab.value.document.status = "stopped"
        throw new Error("Test execution stopped due to error")
      }
    }
  }

  /**
   * Executes a GraphQL request inside a run. Mirrors `runTestRequest`'s
   * result handling including the script stages — pre-request/test scripts
   * run through the shared sandbox and contribute test counts to the run
   * meta like REST requests do.
   */
  private async runTestGQLRequest(
    tab: Ref<HoppTab<HoppTestRunnerDocument>>,
    request: HoppGQLRequest,
    options: TestRunnerOptions,
    path: number[],
    iterationMeta: TestRunnerMeta,
    iterationVars: Environment["variables"] = [],
    inheritedVariables: HoppCollectionVariable[] = [],
    inheritedHeaders: HoppRESTHeaders = [],
    inheritedPreRequestScripts: string[] = [],
    inheritedTestScripts: string[] = [],
    iterationEnvState?: InitialEnvironmentState
  ) {
    try {
      this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
        isLoading: true,
        error: undefined,
      })

      await nextTick()

      // Reuse the per-iteration snapshot when variable values aren't
      // persisted; otherwise re-capture so this request sees env changes
      // persisted by earlier requests in the run.
      const initialEnvironmentState =
        iterationEnvState ?? captureInitialEnvironmentState()

      const results = await runTestRunnerGQLRequest(
        options.executeScripts === false
          ? { ...request, preRequestScript: "", testScript: "" }
          : request,
        options.keepVariableValues,
        inheritedVariables,
        initialEnvironmentState,
        inheritedHeaders,
        options.executeScripts === false ? [] : inheritedPreRequestScripts,
        options.executeScripts === false ? [] : inheritedTestScripts,
        iterationVars
      )

      if (E.isRight(results)) {
        const { response, testResult } = results.right

        // Tally test counts into the run meta — REST parity
        // (HoppTestResult is structurally a HoppTestData root node)
        const { passed, failed } = this.getTestResultInfo(testResult)
        tab.value.document.testRunnerMeta.totalTests += passed + failed
        tab.value.document.testRunnerMeta.passedTests += passed
        tab.value.document.testRunnerMeta.failedTests += failed
        iterationMeta.totalTests += passed + failed
        iterationMeta.passedTests += passed
        iterationMeta.failedTests += failed

        this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
          reportResponse: summarizeRunnerResponse(response, true),
          response: options.persistResponses ? response : null,
          testResults: testResult,
          passedTests: passed,
          failedTests: failed,
          isLoading: false,
        })

        if (response.type === "success") {
          tab.value.document.testRunnerMeta.totalTime +=
            response.meta.responseDuration
          tab.value.document.testRunnerMeta.completedRequests += 1
          iterationMeta.totalTime += response.meta.responseDuration
          iterationMeta.completedRequests += 1
        }

        // A post-request script failure arrives as a Right with `scriptError`
        // set, so the Left/stop-on-error branch below never sees it. Halt
        // here after the row and meta have recorded the request — REST parity.
        if (options.stopOnError && testResult.scriptError) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped due to error")
        }
      } else {
        const errorMsg =
          results.left.type === "subscription_unsupported"
            ? "GraphQL subscriptions are not supported in the collection runner"
            : results.left.message

        this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
          error: errorMsg,
          reportResponse: summarizeRunnerFailure(
            "error" in results.left
              ? (results.left.error ?? errorMsg)
              : errorMsg,
            "REQUEST_ERROR"
          ),
          isLoading: false,
          response: null,
        })

        if (options.stopOnError) {
          tab.value.document.status = "stopped"
          throw new Error("Test execution stopped due to error")
        }
      }
      if (options.stopRef?.value) throw new Error("Test execution stopped")
    } catch (error) {
      if (isStopSignal(error)) {
        throw error
      }

      const errorMsg =
        error instanceof Error ? error.message : "Unknown error occurred"

      this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
        error: errorMsg,
        reportResponse: summarizeRunnerFailure(error, "REQUEST_ERROR"),
        isLoading: false,
      })

      if (options.stopOnError) {
        tab.value.document.status = "stopped"
        throw new Error("Test execution stopped due to error")
      }
    }
  }

  private getTestResultInfo(testResult: HoppTestData | HoppTestResult) {
    let passed = 0
    // A failed script means the request's assertions never ran — count it as
    // one failure so the meta counters and the run outcome reflect it.
    // (`scriptError` exists only on the top-level `HoppTestResult`.)
    let failed = "scriptError" in testResult && testResult.scriptError ? 1 : 0

    for (const result of testResult.expectResults) {
      if (result.status === "pass") {
        passed++
      } else if (result.status === "fail" || result.status === "error") {
        failed++
      }
    }

    for (const nestedTest of testResult.tests) {
      const nestedResult = this.getTestResultInfo(nestedTest)
      passed += nestedResult.passed
      failed += nestedResult.failed
    }

    return { passed, failed }
  }
}
