import type { KernelAPI } from "@apirequest/kernel"

declare global {
  interface Window {
    __KERNEL__?: KernelAPI
    __APIREQUEST_NATIVE__?: boolean
  }
}

export {}
