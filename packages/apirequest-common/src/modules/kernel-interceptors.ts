import { HoppModule } from ".";
import { getService } from "./dioc";
import { platform } from "~/platform";
import { KernelInterceptorService } from "~/services/kernel-interceptor.service";

export default <HoppModule>{
  onVueAppInit() {
    // 每个平台固定使用自身的发送实现，不再同步用户可切换的发送端偏好。
    initKernelInterceptorService()
  },
}

function initKernelInterceptorService(): KernelInterceptorService {
  const service = getService(KernelInterceptorService)

  registerInterceptors(service)
  initializeDefaultInterceptor(service)

  return service
}

function registerInterceptors(service: KernelInterceptorService): void {
  platform.kernelInterceptors.interceptors.forEach((interceptorDef) => {
    if (interceptorDef.type === "standalone") {
      service.register(interceptorDef.interceptor)
    } else {
      const interceptorService = getService(interceptorDef.service)
      service.register(interceptorService)
    }
  })
}

function initializeDefaultInterceptor(service: KernelInterceptorService): void {
  service.setActive(platform.kernelInterceptors.default)
}
