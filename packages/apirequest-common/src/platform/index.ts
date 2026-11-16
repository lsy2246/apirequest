import { ServiceClassInstance } from "dioc";
import { Ref } from "vue";
import { HoppModule } from "~/modules";
import { AnalyticsPlatformDef } from "./analytics";
import { AuthPlatformDef, LocalIdentity } from "./auth";
import { ExperimentsPlatformDef } from "./experiments";
import { InspectorsPlatformDef } from "./inspectors";
import { KernelInterceptorsPlatformDef } from "./kernel-interceptors";
import { LimitsPlatformDef } from "./limits";
import { SpotlightPlatformDef } from "./spotlight";
import { UIPlatformDef } from "./ui";
import { BackendPlatformDef, LocalMockBackend } from "./backend";
import { OrganizationPlatformDef } from "./organization";
import { KernelIO } from "./kernel-io";
import { InstancePlatformDef } from "./instance";
import { SyncPlatformDef } from "./sync";

type SharedPlatformDef = {
  ui?: UIPlatformDef
  addedHoppModules?: HoppModule[]
  addedServices?: Array<ServiceClassInstance<unknown>>
  analytics?: AnalyticsPlatformDef
  kernelIO: KernelIO
  instance: InstancePlatformDef
  kernelInterceptors: KernelInterceptorsPlatformDef
  additionalInspectors?: InspectorsPlatformDef
  spotlight?: SpotlightPlatformDef
  platformFeatureFlags: {
    exportAsGIST: boolean
    hasTelemetry: boolean

    /**
     *  Whether the platform supports cookies (affects whether the cookies footer item is shown)
     *  If a value is not given, then the value is assumed to be false
     */
    cookiesEnabled?: boolean

    /**
     * Whether to show the A/B testing workspace switcher click login flow or not
     */
    workspaceSwitcherLogin?: Ref<boolean>

    /**
     * Whether the platform uses cookie-based authentication.
     * This affects CSRF security warnings for same-origin fetch calls in scripts.
     * Self-hosted web instances use cookies, while cloud/desktop use bearer tokens.
     *
     * If not provided, defaults to false (no cookie-based auth).
     */
    hasCookieBasedAuth?: boolean
  }
  limits?: LimitsPlatformDef
  experiments?: ExperimentsPlatformDef
  organization?: OrganizationPlatformDef
  sync?: SyncPlatformDef
}

export type PlatformDef = SharedPlatformDef &
  (
    | { localDesktop: true; backend: LocalMockBackend; auth: LocalIdentity }
    | {
        localDesktop?: false
        backend: BackendPlatformDef
        auth: AuthPlatformDef
      }
  )

export let platform: PlatformDef

export function setPlatformDef(def: PlatformDef) {
  platform = def
}

export function isLocalWorkbench() {
  const session = platform.auth.localSessionState?.value
  return platform.localDesktop === true || session !== undefined
}
