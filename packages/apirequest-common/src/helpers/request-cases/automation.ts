import type { CaseMap, HoppCollection, RequestCase } from "@apirequest/data"
import { isGQLRequest } from "@apirequest/data"
import { cloneDeep } from "lodash-es"
import type { CaseRunResult } from "./execute"
import { emptyRunnerTestResult } from "~/helpers/test-runner/report"

export function casesForRequest(
  request: { id?: string; _ref_id?: string },
  cases: CaseMap = {}
) {
  return (
    (request.id && cases[request.id]) ||
    (request._ref_id && cases[request._ref_id]) ||
    []
  )
}

export function collectionCaseChoices(
  collections: HoppCollection[],
  cases: CaseMap,
  selectedRequests?: Set<string>
) {
  const result: {
    requestID: string
    collectionID: string
    requestName: string
    entry: RequestCase
  }[] = []
  const visit = (collection: HoppCollection, path: string[]) => {
    collection.folders.forEach((folder) =>
      visit(folder, [...path, collection.name])
    )
    for (const request of collection.requests) {
      if (isGQLRequest(request)) continue
      const id = request.id || request._ref_id
      if (!id) continue
      if (selectedRequests && !selectedRequests.has(request._ref_id ?? id))
        continue
      for (const entry of casesForRequest(request, cases))
        result.push({
          requestID: id,
          collectionID: collection.id ?? collection._ref_id ?? "",
          requestName: [...path, collection.name, request.name].join(" / "),
          entry,
        })
    }
  }
  collections.forEach((collection) => visit(collection, []))
  return result
}

export type AutomationCaseNode = {
  key: string
  kind: "folder" | "request" | "case"
  name: string
  method?: string
  timeoutMs?: number
  caseIDs: string[]
  children: AutomationCaseNode[]
}

export function automationCaseTree(
  collections: HoppCollection[],
  cases: CaseMap
): AutomationCaseNode[] {
  const folder = (
    collection: HoppCollection,
    path: string
  ): AutomationCaseNode => {
    const children = [
      ...collection.folders.map((child, index) =>
        folder(child, `${path}/${index}`)
      ),
      ...collection.requests.map((request, index): AutomationCaseNode => {
        const id = request.id ?? request._ref_id ?? `${path}/request-${index}`
        const children: AutomationCaseNode[] = isGQLRequest(request)
          ? []
          : casesForRequest(request, cases).map((entry) => ({
              key: `case:${id}:${entry.id}`,
              kind: "case",
              name: entry.name,
              timeoutMs: entry.timeoutMs,
              caseIDs: [entry.id],
              children: [],
            }))
        return {
          key: `request:${id}`,
          kind: "request",
          name: request.name,
          method: isGQLRequest(request) ? "GQL" : request.method,
          children,
          caseIDs: children.flatMap((child) => child.caseIDs),
        }
      }),
    ]
    return {
      key: `folder:${collection.id ?? collection._ref_id ?? path}`,
      kind: "folder",
      name: collection.name,
      children,
      caseIDs: children.flatMap((child) => child.caseIDs),
    }
  }
  return collections.map((collection, index) =>
    folder(collection, String(index))
  )
}

export function selectAutomationRequests(
  collections: HoppCollection[],
  requestIDs: string[]
): HoppCollection[] {
  const selected = new Set(requestIDs)
  const found = new Set<string>()
  const visit = (collection: HoppCollection): HoppCollection => ({
    ...collection,
    folders: collection.folders
      .map(visit)
      .filter((folder) => folder.folders.length || folder.requests.length),
    requests: collection.requests.filter((request) => {
      const id = request.id ?? request._ref_id ?? ""
      if (!selected.has(id)) return false
      found.add(id)
      return true
    }),
  })
  const result = collections
    .map(visit)
    .filter((folder) => folder.folders.length || folder.requests.length)
  if (found.size !== selected.size)
    throw new Error("Some selected requests no longer exist")
  return result
}

export function snapshotCases(
  choices: ReturnType<typeof collectionCaseChoices>
): CaseMap {
  const result: CaseMap = {}
  choices.forEach(({ requestID, entry }) =>
    (result[requestID] ??= []).push(cloneDeep(entry))
  )
  return result
}

export function caseTestResult(result: CaseRunResult) {
  const tests = emptyRunnerTestResult()
  tests.scriptError = !!result.scriptError
  tests.scriptErrorDetails = result.scriptError
  const printable = (value: unknown) =>
    value === undefined ? "undefined" : JSON.stringify(value)
  tests.tests = [
    ...result.assertions.map((item) => ({
      description: `${item.assertion.target}${item.assertion.path ? ` · ${item.assertion.path}` : ""} ${item.assertion.operator}`,
      expectResults: [
        {
          status: item.passed ? ("pass" as const) : ("fail" as const),
          message: `${item.assertion.operator} — expected: ${printable(item.expected)}, actual: ${printable(item.actual)}${item.error ? ` (${item.error})` : ""}`,
        },
      ],
      tests: [],
    })),
    ...result.scripts.map((item) => ({
      description: item.name,
      expectResults: [
        {
          status: item.passed ? ("pass" as const) : ("fail" as const),
          message: item.message,
        },
      ],
      tests: [],
    })),
  ]
  return tests
}
