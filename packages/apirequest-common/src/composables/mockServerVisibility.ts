import { useSetting } from "~/composables/settings"
export function useMockServerVisibility() {
  return {
    isMockServerVisible: useSetting("ENABLE_EXPERIMENTAL_MOCK_SERVERS"),
  }
}
