import type { KernelAPI } from "@apirequest/kernel"

declare global {
  interface Window {
    __KERNEL__?: KernelAPI
  }
}

export {}
