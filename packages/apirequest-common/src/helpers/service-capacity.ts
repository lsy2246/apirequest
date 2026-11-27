import { workbenchMcpAPI } from "./workbench-mcp"

export type CapacityView = {
  revision: number
  values: Record<string, number>
  fields: Record<string, { default: number }>
}

export function readServiceCapacity(signal?: AbortSignal) {
  return workbenchMcpAPI<CapacityView>("service-capacity", undefined, signal)
}

export function writeServiceCapacity(
  overrides: Record<string, number>,
  revision: number,
  signal?: AbortSignal
) {
  return workbenchMcpAPI<CapacityView>(
    "service-capacity",
    { overrides, revision },
    signal
  )
}
