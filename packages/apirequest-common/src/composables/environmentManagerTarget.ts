import type { InjectionKey, ShallowRef } from "vue";

export const environmentManagerTargetKey: InjectionKey<
  ShallowRef<HTMLElement | null>
> = Symbol("environmentManagerTarget")
