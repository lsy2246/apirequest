import { requestFailed, requestHasResult } from "./outcome"
import { HoppCollection } from "@apirequest/data"
import { ChildrenResult, SmartTreeAdapter } from "@apirequest/ui/helpers"
import { computed, Ref } from "vue"
import { TestRunnerRequest } from "~/services/test-runner/test-runner.service"

export type Collection = {
  type: "collections"
  isLastItem: boolean
  data: {
    parentIndex: null
    data: HoppCollection
  }
}

type Folder = {
  type: "folders"
  isLastItem: boolean
  data: {
    parentIndex: string
    data: HoppCollection
  }
}

type Requests = {
  type: "requests"
  isLastItem: boolean
  data: {
    parentIndex: string
    data: TestRunnerRequest
  }
}

export type CollectionNode = Collection | Folder | Requests

export class TestRunnerCollectionsAdapter implements SmartTreeAdapter<CollectionNode> {
  constructor(
    public data: Ref<HoppCollection[]>,
    private show: Ref<"all" | "passed" | "failed">
  ) {}

  private shouldShowRequest(request: TestRunnerRequest): boolean {
    if (this.show.value === "all") return true
    if (!requestHasResult(request)) return false
    return this.show.value === "failed"
      ? requestFailed(request)
      : !requestFailed(request)
  }

  navigateToFolderWithIndexPath(
    collections: HoppCollection[],
    indexPaths: number[]
  ) {
    if (indexPaths.length === 0) return null

    let target = collections[indexPaths.shift() as number]

    while (indexPaths.length > 0)
      target = target.folders[indexPaths.shift() as number]

    return target !== undefined ? target : null
  }

  getChildren(id: string | null): Ref<ChildrenResult<any>> {
    return computed(() => {
      if (id === null) {
        const data = this.data.value.map((item, index) => ({
          id: `folder-${index.toString()}`,
          data: {
            type: "collections",
            isLastItem: index === this.data.value.length - 1,
            data: {
              parentIndex: null,
              data: item,
            },
          },
        }))
        return {
          status: "loaded",
          data: data,
        } as ChildrenResult<Collection>
      }

      const childType = id.split("-")[0]

      if (childType === "request") {
        return {
          status: "loaded",
          data: [],
        }
      }

      const folderId = id.split("-")[1]
      const indexPath = folderId.split("/").map((x) => parseInt(x))
      const item = this.navigateToFolderWithIndexPath(
        this.data.value,
        indexPath
      )

      if (item && Object.keys(item).length) {
        // Always include all folders for smooth transitions
        const folderData = item.folders.map((folder, index) => ({
          id: `folder-${folderId}/${index}`,
          data: {
            isLastItem:
              index === item.folders.length - 1 && item.requests.length === 0,
            type: "folders",
            isSelected: true,
            data: {
              parentIndex: id,
              data: folder,
            },
          },
        }))

        const requestData = item.requests.map((request, index) => {
          const shouldShow = this.shouldShowRequest(
            request as TestRunnerRequest
          )
          return {
            id: `request-${id}/${index}`,
            data: {
              isLastItem: index === item.requests.length - 1,
              type: "requests",
              isSelected: true,
              hidden: !shouldShow,
              data: {
                parentIndex: id,
                data: request,
              },
            },
          }
        })

        return {
          status: "loaded",
          data: [...folderData, ...requestData],
        } as ChildrenResult<Folder | Request>
      }
      return {
        status: "loaded",
        data: [],
      }
    })
  }
}
