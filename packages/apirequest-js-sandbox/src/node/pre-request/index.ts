import type { RunPreRequestScriptOptions } from "~/types"
import { runPreRequestScriptWithFaradayCage } from "./experimental"

export const runPreRequestScript = (
  script: string,
  options: RunPreRequestScriptOptions,
) =>
  runPreRequestScriptWithFaradayCage(
    script,
    options.envs,
    options.request,
    options.cookies,
    options.hoppFetchHook,
  )
