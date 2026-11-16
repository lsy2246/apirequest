import { nextTick } from "vue";
import type { Router } from "vue-router";
import { invokeAction } from "~/helpers/actions";

// 导入动作由接口页持有；先完成导航和挂载，避免其他功能页点击新建时丢失动作。
export async function openWorkbenchCurlImport(router: Router) {
  if (router.currentRoute.value.path !== "/") await router.push("/")
  await nextTick()
  invokeAction("tab.open-new")
  await nextTick()
  invokeAction("request.import-curl")
}
