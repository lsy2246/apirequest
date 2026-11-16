import { createHoppApp } from "@apirequest/common"
import { kernelIO } from "@apirequest/common/platform/std/kernel-io"
import { NativeKernelInterceptorService } from "@apirequest/common/platform/std/kernel-interceptors/native"
import { nativeWorkbenchAuth } from "@app/platform/auth/workbench"
import { startNativeMcp } from "@apirequest/common/helpers/native-workbench-mcp"

createHoppApp("#app", {
  localDesktop: true,
  auth: nativeWorkbenchAuth,
  instance: { instanceSwitchingEnabled: false },
  kernelIO,
  kernelInterceptors: {
    default: "native",
    interceptors: [
      { type: "service", service: NativeKernelInterceptorService },
    ],
  },
  platformFeatureFlags: {
    exportAsGIST: false,
    hasTelemetry: false,
    cookiesEnabled: true,
  },
  limits: { collectionImportSizeLimit: 50 },
})
  .then(startNativeMcp)
  .catch(console.error)
