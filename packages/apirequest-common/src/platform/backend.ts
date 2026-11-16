import * as TE from "fp-ts/TaskEither";
import { GQLError } from "~/helpers/backend/GQLClient";
import type { CreatePublishedDocMutation, CreatePublishedDocsArgs, DeletePublishedDocMutation, GetMockServerLogsQuery, PublishedDocQuery, UpdatePublishedDocMutation, UpdatePublishedDocsArgs, UserPublishedDocsListQuery } from "~/helpers/backend/graphql";
import type { MockServer } from "~/helpers/backend/types/MockServer";
export type BackendPlatformDef = {
  // Mock server operations
  updateMockServer: (
    id: string,
    input: {
      name?: string
      isActive?: boolean
      delayInMs?: number
      isPublic?: boolean
    }
  ) => TE.TaskEither<string, MockServer>
  deleteMockServer: (id: string) => TE.TaskEither<string, boolean>
  getMockServer: (id: string) => TE.TaskEither<string, MockServer>
  getMyMockServers: (
    skip?: number,
    take?: number
  ) => TE.TaskEither<string, MockServer[]>
  getMockServerLogs: (
    mockServerID: string,
    skip?: number,
    take?: number
  ) => TE.TaskEither<string, GetMockServerLogsQuery["mockServerLogs"]>
  deleteMockServerLog: (logID: string) => TE.TaskEither<string, boolean>
  // Published docs operations
  createPublishedDoc: (
    doc: CreatePublishedDocsArgs
  ) => TE.TaskEither<GQLError<string>, CreatePublishedDocMutation>
  updatePublishedDoc: (
    id: string,
    doc: UpdatePublishedDocsArgs
  ) => TE.TaskEither<GQLError<string>, UpdatePublishedDocMutation>
  deletePublishedDoc: (
    id: string
  ) => TE.TaskEither<GQLError<string>, DeletePublishedDocMutation>
  getPublishedDocByID: (
    id: string
  ) => TE.TaskEither<string, PublishedDocQuery["publishedDoc"]>
  getUserPublishedDocs: (
    skip?: number,
    take?: number
  ) => TE.TaskEither<
    string,
    UserPublishedDocsListQuery["userPublishedDocsList"]
  >
}
export type LocalMockBackend = Pick<
  BackendPlatformDef,
  | "updateMockServer"
  | "deleteMockServer"
  | "getMockServer"
  | "getMyMockServers"
  | "getMockServerLogs"
  | "deleteMockServerLog"
>
