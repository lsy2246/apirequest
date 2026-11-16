import { describe, expect, vi, it, beforeEach, afterEach } from "vitest"
import { TestContainer } from "dioc/testing"
import { WorkspaceService } from "../workspace.service"
import { setPlatformDef } from "~/platform"
import { getSelectedEnvironmentIndex, replaceEnvironments, setSelectedEnvironmentIndex } from "~/newstore/environments"
import { BehaviorSubject } from "rxjs"
import { effectScope, nextTick, type EffectScope } from "vue"

const mocks = vi.hoisted(() => ({ attach: vi.fn(), documents: vi.fn() }))
vi.mock("../documentation.service", () => ({
  DocumentationService: class {
    static readonly ID = "DOCUMENTATION_SERVICE"
    fetchUserPublishedDocs = mocks.documents
    onServiceInit() {}
  },
}))
vi.mock("../tab/workspace-tabs", () => ({
  WorkspaceTabsService: class {
    static readonly ID = "WORKSPACE_TABS_SERVICE"
    attachToWorkspace = mocks.attach
    onServiceInit() {}
  },
}))

describe("单人工作区", () => {
  let scope: EffectScope
  let user: BehaviorSubject<{ uid: string } | null>
  const auth = {
    getCurrentUserStream: vi.fn(),
    getCurrentUser: vi.fn(),
    waitProbableLoginToConfirm: vi.fn(),
  }
  beforeEach(() => {
    vi.clearAllMocks()
    user = new BehaviorSubject<{ uid: string } | null>(null)
    auth.getCurrentUserStream.mockReturnValue(user)
    auth.getCurrentUser.mockReturnValue(null)
    auth.waitProbableLoginToConfirm.mockResolvedValue(undefined)
    setPlatformDef({ auth } as unknown as Parameters<typeof setPlatformDef>[0])
    scope = effectScope()
    replaceEnvironments([])
    setSelectedEnvironmentIndex({ type: "NO_ENV_SELECTED" })
  })
  afterEach(() => {
    scope.stop()
    user.complete()
  })
  const create = () => scope.run(() => new TestContainer().bind(WorkspaceService))!

  it("初始化时把标签页绑定到个人工作区", () => {
    const service = create()
    expect(service.currentWorkspace.value).toEqual({ type: "personal" })
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith({ type: "personal" })
  })
  it("初始化保留已选中的个人环境", () => {
    replaceEnvironments([{ v: 2, id: "env-1", name: "测试环境", variables: [] }])
    setSelectedEnvironmentIndex({ type: "MY_ENV", index: 0 })
    create()
    expect(getSelectedEnvironmentIndex()).toEqual({ type: "MY_ENV", index: 0 })
  })
  it("等待登录确认后获取个人文档", async () => {
    create()
    expect(mocks.documents).not.toHaveBeenCalled()
    user.next({ uid: "preview-user" })
    await nextTick()
    await Promise.resolve()
    expect(auth.waitProbableLoginToConfirm).toHaveBeenCalledOnce()
    expect(mocks.documents).toHaveBeenCalledOnce()
  })
})
