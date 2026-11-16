import type { BackendPlatformDef } from "./backend";
import { platform } from ".";

export function getWebBackend(): BackendPlatformDef {
  if (platform.localDesktop)
    throw new Error("Web backend is unavailable in the desktop workspace")
  return platform.backend
}
