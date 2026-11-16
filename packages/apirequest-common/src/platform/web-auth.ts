import type { AuthPlatformDef } from "./auth";
import { platform } from ".";

export function getWebAuth(): AuthPlatformDef {
  if (platform.localDesktop)
    throw new Error("Accounts are unavailable in the desktop workspace")
  return platform.auth
}
