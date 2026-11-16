import { settingsStore } from "~/newstore/settings";
export function queryEncodingEnabled(request: { queryEncoding?: boolean }) {
  return request.queryEncoding ?? settingsStore.value.ENCODE_MODE !== "disable"
}
