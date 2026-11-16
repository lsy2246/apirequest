import { Service } from "dioc";
import { readonly, ref, watch } from "vue";
import { useStreamStatic } from "~/composables/stream";
import { platform } from "~/platform";

import { DocumentationService } from "./documentation.service";
import { WorkspaceTabsService } from "./tab/workspace-tabs";
export type PersonalWorkspace = {
  type: "personal"
}
export type Workspace = PersonalWorkspace
export class WorkspaceService extends Service {
  public static readonly ID = "WORKSPACE_SERVICE"
  private _currentWorkspace = ref<Workspace>({ type: "personal" })
  public currentWorkspace = readonly(this._currentWorkspace)
  private documentation = this.bind(DocumentationService)
  private tabs = this.bind(WorkspaceTabsService)
  private user = useStreamStatic(
    platform.auth.getCurrentUserStream(),
    platform.auth.getCurrentUser(),
    () => {}
  )[0]
  override onServiceInit() {
    this.tabs.attachToWorkspace({ type: "personal" })
    watch(
      this.user,
      async (user) => {
        if (!user) return
        try {
          await platform.auth.waitProbableLoginToConfirm()
          await this.documentation.fetchUserPublishedDocs()
        } catch (error) {
          console.error("Failed to load personal documentation", error)
        }
      },
      { immediate: true }
    )
  }
}
