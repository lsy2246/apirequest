import type { TypedDocumentNode } from "@urql/core";

type WebDocuments = typeof import("./graphql")
type OperationName = Extract<keyof WebDocuments, `${string}Document`>

export type BackendOperation<Data, Variables> = {
  readonly backendDocument: OperationName
  readonly documentType?: TypedDocumentNode<Data, Variables>
}

// 共享模块只传递操作名，实际文档由网页后端客户端在初始化时加载。
export function backendOperation<Name extends OperationName>(
  name: Name
): {
  readonly backendDocument: Name
  readonly documentType?: WebDocuments[Name]
} {
  return { backendDocument: name }
}
