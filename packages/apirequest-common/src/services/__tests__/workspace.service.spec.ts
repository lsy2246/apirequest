import { describe, expect, vi, it, beforeEach, afterEach } from "vitest"
import { TestContainer } from "dioc/testing"
import { WorkspaceService } from "../workspace.service"
import { setPlatformDef } from "~/platform"
import {
  getSelectedEnvironmentIndex,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"
import { BehaviorSubject } from "rxjs"
import { effectScope, nextTick, type EffectScope } from "vue"

const listAdapterMock = vi.hoisted(() => ({
  isInitialized: false,
  initialize: vi.fn(() => {
    listAdapterMock.isInitialized = true
  }),
  dispose: vi.fn(() => {
    listAdapterMock.isInitialized = false
  }),
  fetchList: vi.fn(),
}))

vi.mock("~/helpers/teams/TeamListAdapter", () => ({
  default: class {
    isInitialized = listAdapterMock.isInitialized
    initialize = listAdapterMock.initialize
    dispose = listAdapterMock.dispose
    fetchList = listAdapterMock.fetchList
  },
}))

// Mock TeamCollectionsService to prevent i18n dependency issues
vi.mock("../team-collection.service", () => ({
  TeamCollectionsService: class MockTeamCollectionsService {
    static readonly ID = "TEAM_COLLECTIONS_SERVICE"

    changeTeamID = vi.fn()
    clearCollections = vi.fn()

    onServiceInit = vi.fn()
  },
}))

// Mock DocumentationService
vi.mock("../documentation.service", () => ({
  DocumentationService: class MockDocumentationService {
    static readonly ID = "DOCUMENTATION_SERVICE"

    fetchTeamPublishedDocs = vi.fn()
    fetchUserPublishedDocs = vi.fn()

    onServiceInit = vi.fn()
  },
}))

// Mock WorkspaceTabsService — it indirectly pulls in PersistenceService which
// triggers an i18n getService() call at module init, breaking this test's setup.
vi.mock("../tab/workspace-tabs", () => ({
  WorkspaceTabsService: class MockWorkspaceTabsService {
    static readonly ID = "WORKSPACE_TABS_SERVICE"

    attachToWorkspace = vi.fn()

    onServiceInit = vi.fn()
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
    // 测试平台仅提供登录流，避免连接真实后端。
    setPlatformDef({ auth } as unknown as Parameters<typeof setPlatformDef>[0])
    scope = effectScope()
    setSelectedEnvironmentIndex({ type: "NO_ENV_SELECTED" })
  })
  afterEach(() => {
    scope.stop()
    user.complete()
  })
  const create = () =>
    scope.run(() => new TestContainer().bind(WorkspaceService))!

  it("固定为个人工作区，拒绝旧团队切换且不启动团队订阅", () => {
    const service = create()
    expect(service.currentWorkspace.value).toEqual({ type: "personal" })
    expect(() =>
      service.changeWorkspace({
        type: "team",
        teamID: "legacy",
        teamName: "旧团队",
        role: null,
      })
    ).toThrow("not available")
    expect(listAdapterMock.initialize).not.toHaveBeenCalled()
    expect(listAdapterMock.fetchList).not.toHaveBeenCalled()
  })
  it("初始化清除残留团队环境选择", () => {
    setSelectedEnvironmentIndex({ type: "TEAM_ENV", teamEnvID: "legacy" })
    create()
    expect(getSelectedEnvironmentIndex()).toEqual({ type: "NO_ENV_SELECTED" })
  })
  it("等待登录确认后获取个人文档", async () => {
    const service = create()
    const docs = (
      service as unknown as {
        documentation: { fetchUserPublishedDocs: ReturnType<typeof vi.fn> }
      }
    ).documentation
    expect(docs.fetchUserPublishedDocs).not.toHaveBeenCalled()
    user.next({ uid: "preview-user" })
    await nextTick()
    await Promise.resolve()
    expect(auth.waitProbableLoginToConfirm).toHaveBeenCalledOnce()
    expect(docs.fetchUserPublishedDocs).toHaveBeenCalledOnce()
  })
})
