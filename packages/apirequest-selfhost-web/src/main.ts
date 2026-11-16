import { createHoppApp } from "@apirequest/common"
import { def as backend } from "@apirequest/common/platform/std/backend"
import { kernelIO } from "@apirequest/common/platform/std/kernel-io"
import { def as auth } from "@app/platform/auth/web"
import { def as instance } from "@app/platform/instance/web"
import { historySyncDef } from "@app/platform/history/sync"
import { WorkbenchBrowserInterceptor } from "@app/services/workbench-browser-interceptor"

createHoppApp("#app", {
  auth,
  kernelIO,
  instance,
  sync: { history: historySyncDef },
  kernelInterceptors: {
    default: "browser",
    interceptors: [{ type: "service", service: WorkbenchBrowserInterceptor }],
  },
  platformFeatureFlags: {
    exportAsGIST: false,
    hasTelemetry: false,
    cookiesEnabled: false,
    hasCookieBasedAuth: true,
  },
  limits: { collectionImportSizeLimit: 50 },
  backend,
}).catch(console.error)
