// Shared with the background automation runner; the public editor API is unchanged.
export {
  CASE_FILE_LIMIT,
  CaseFileSchema,
  AssertionSchema,
  CaseBodySchema,
  emptyOverrides,
  CaseSchema,
  CaseMapSchema,
  newRequestCase,
  readCaseFile,
  caseBody,
  buildCaseRequest,
  expectedValue,
  evaluateAssertions,
} from "@apirequest/data"
export type {
  RequestCase,
  CaseMap,
  CaseAssertion,
  CaseFile,
  CaseBody,
  CasePatch,
  CaseVariableChoice,
  CaseResponse,
  AssertionResult,
} from "@apirequest/data"
