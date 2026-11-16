import type { Environment } from "@apirequest/data";

/** Merge by key, preserving unrelated values and secrets omitted by exports. */
export function mergeEnvironmentVariables(
  existing: Environment["variables"],
  imported: Environment["variables"]
): Environment["variables"] {
  const result = existing.map((variable) => ({ ...variable }))
  for (const variable of imported) {
    const index = result.findIndex(({ key }) => key === variable.key)
    const previous = result[index]
    if (
      variable.secret &&
      !variable.initialValue &&
      !variable.currentValue &&
      previous?.secret
    )
      continue
    const incoming = {
      ...variable,
      currentValue: variable.currentValue || variable.initialValue,
    }
    if (index < 0) result.push(incoming)
    else result[index] = incoming
  }
  return result
}
