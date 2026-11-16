/** The older runner used "Global" to denote no selected environment. Named environments keep their actual ID. */
export function runnerEnvironmentLabel(
  name: string | undefined,
  id: string | null | undefined,
  noneLabel: string
): string {
  if (id === null || !name || (id === undefined && name === "Global"))
    return noneLabel
  return name
}
