import { getDefaultRESTRequest } from "@apirequest/data"
import { describe, expect, test } from "vitest"

import {
  TestRunnerResultCollectionSchema,
  WORKSPACE_TABS_STATE_SCHEMA,
} from "../index"

// A HoppRESTRequest augmented with the runner-only result fields, as it lives
// inside a persisted test-runner result collection.
const makeRunnerRequest = (name: string) => ({
  ...getDefaultRESTRequest(),
  name,
  type: "test-response" as const,
  passedTests: 2,
  failedTests: 1,
  runnerRequestID: `rid-${name}`,
  error: undefined,
  isLoading: false,
  renderResults: true,
  testResults: {
    tests: [],
    expectResults: [],
    description: "",
    scriptError: false,
    envDiff: {
      global: { additions: [], updations: [], deletions: [] },
      selected: { additions: [], updations: [], deletions: [] },
    },
    consoleEntries: [],
  },
})

const makeResultCollection = () => ({
  v: 12,
  name: "Result Collection",
  auth: { authType: "inherit", authActive: true },
  headers: [],
  variables: [],
  description: null,
  preRequestScript: "",
  testScript: "",
  requests: [makeRunnerRequest("top")],
  folders: [
    {
      v: 12,
      name: "Nested",
      auth: { authType: "inherit", authActive: true },
      headers: [],
      variables: [],
      description: null,
      preRequestScript: "",
      testScript: "",
      requests: [makeRunnerRequest("nested")],
      folders: [],
    },
  ],
})

describe("TestRunnerResultCollectionSchema", () => {
  test("preserves runner result fields on requests through a persist round-trip", () => {
    const parsed = TestRunnerResultCollectionSchema.safeParse(
      makeResultCollection()
    )

    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const data = parsed.data as ReturnType<typeof makeResultCollection>
    const topRequest = data.requests[0]

    // The runner-only fields must survive (the bug was HoppRESTCollectionSchema
    // stripping them, blanking restored results and JSON export).
    expect(topRequest.passedTests).toBe(2)
    expect(topRequest.failedTests).toBe(1)
    expect(topRequest.runnerRequestID).toBe("rid-top")
    expect(topRequest.testResults).toBeDefined()
    expect(topRequest.testResults?.scriptError).toBe(false)

    // ...and recursively for folder-nested requests.
    const nestedRequest = data.folders[0].requests[0]
    expect(nestedRequest.passedTests).toBe(2)
    expect(nestedRequest.runnerRequestID).toBe("rid-nested")
    expect(nestedRequest.testResults).toBeDefined()
  })

  test("migrates an older-version collection while keeping runner fields", () => {
    // A v2 collection (pre-dates variables/preRequestScript/testScript). It must
    // be rejected without migrating or restoring the
    // runner result fields on its requests.
    const legacyCollection = {
      v: 2,
      name: "Legacy Collection",
      auth: { authType: "inherit", authActive: true },
      headers: [],
      requests: [makeRunnerRequest("legacy")],
      folders: [],
    }

    const parsed = TestRunnerResultCollectionSchema.safeParse(legacyCollection)

    expect(parsed.success).toBe(false)
  })
})

test("a completed automation window remains valid when workspace tabs are restored", () => {
  const parsed = WORKSPACE_TABS_STATE_SCHEMA.safeParse({
    lastActiveTabID: "runner",
    orderedDocs: [
      {
        tabID: "runner",
        doc: {
          type: "test-runner",
          config: {
            delay: 0,
            iterations: 1,
            keepVariableValues: false,
            persistResponses: true,
            stopOnError: false,
          },
          status: "completed",
          environmentID: null,
          collection: makeResultCollection(),
          collectionType: "my-collections",
          collectionID: "fixture",
          request: null,
          response: null,
          isDirty: false,
          testRunnerMeta: {
            totalRequests: 0,
            completedRequests: 0,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            totalTime: 0,
          },
        },
      },
    ],
  })
  expect(parsed.success).toBe(true)
  if (parsed.success)
    expect(parsed.data.orderedDocs[0].doc).toMatchObject({
      type: "test-runner",
      status: "completed",
      environmentID: null,
    })
})
