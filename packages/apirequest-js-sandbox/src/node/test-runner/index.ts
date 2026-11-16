import * as E from "fp-ts/Either"
import * as TE from "fp-ts/TaskEither"
import { pipe } from "fp-ts/function"

import { RunPostRequestScriptOptions, TestResponse, TestResult } from "~/types"
import { parseScriptForSyntax } from "~/utils/scripting"
import { preventCyclicObjects } from "~/utils/shared"
import { runPostRequestScriptWithFaradayCage } from "./experimental"

// Future TODO: Update return type to be based on `SandboxTestResult` (unified with the web implementation)
// No involvement of cookies in the CLI context currently
export const runTestScript = (
  testScript: string,
  options: RunPostRequestScriptOptions,
): TE.TaskEither<string, TestResult> => {
  const responseObjHandle = preventCyclicObjects<TestResponse>(options.response)

  if (E.isLeft(responseObjHandle)) {
    return TE.left(`Response marshalling failed: ${responseObjHandle.left}`)
  }

  const resolvedResponse = responseObjHandle.right
  const { envs, request, hoppFetchHook } = options

  // Pre-parse before sandbox spin-up so syntax errors surface as a friendly
  // host-side message. Each target uses the grammar that matches its eventual
  // executor: experimental → ESM module (top-level imports + await accepted);
  // legacy → script mode (top-level imports + await rejected).
  try {
    parseScriptForSyntax(testScript)
  } catch (e) {
    const err = e as Error
    const reason = `${"name" in err ? (err as any).name : "SyntaxError"}: ${err.message}`
    return TE.left(`Script execution failed: ${reason}`)
  }

  return runPostRequestScriptWithFaradayCage(
    testScript,
    envs,
    request,
    resolvedResponse,
    hoppFetchHook,
  )
}
