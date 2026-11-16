import { GlobalEnvironment } from "@apirequest/data";

export const parseGlobalEnvironment = (value: unknown): GlobalEnvironment => {
  const result = GlobalEnvironment.safeParse(value)
  if (result.type !== "ok")
    throw new Error("Invalid current global environment")
  return result.value
}
