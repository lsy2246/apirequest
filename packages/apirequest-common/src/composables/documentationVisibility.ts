import { useSetting } from "~/composables/settings";

export function useDocumentationVisibility() {
  return {
    isDocumentationVisible: useSetting("ENABLE_EXPERIMENTAL_DOCUMENTATION"),
  }
}
