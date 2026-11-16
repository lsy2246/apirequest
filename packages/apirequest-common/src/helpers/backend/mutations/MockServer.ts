import * as TE from "fp-ts/TaskEither";
import { client, resolveBackendDocument } from "../GQLClient";
import { GQLError } from "../GQLClient";
import { getI18n } from "~/modules/i18n";
import { backendOperation } from "../operation";
import type { MockServer } from "../types/MockServer";
type UpdateMockServerError =
  "mock_server/not_found" | "mock_server/access_denied"
type DeleteMockServerError =
  "mock_server/not_found" | "mock_server/access_denied"
export const updateMockServer = (
  id: string,
  input: {
    name?: string
    isActive?: boolean
    delayInMs?: number
    isPublic?: boolean
  }
) =>
  TE.tryCatch(
    async () => {
      const result = await client
        .value!.mutation(
          resolveBackendDocument(backendOperation("UpdateMockServerDocument")),
          {
            id,
            input,
          }
        )
        .toPromise()
      if (result.error) {
        throw new Error(result.error.message || "Failed to update mock server")
      }
      if (!result.data) {
        throw new Error("No data returned from update mock server mutation")
      }
      const data = result.data.updateMockServer
      // Map the GraphQL response to frontend format
      return {
        ...data,
        userUid: data.creator?.uid || "", // Legacy field
        collectionID: data.collection?.id || "", // Legacy field
      } as MockServer
    },
    (error) => (error as Error).message as UpdateMockServerError
  )
export const deleteMockServer = (id: string) =>
  TE.tryCatch(
    async () => {
      const result = await client
        .value!.mutation(
          resolveBackendDocument(backendOperation("DeleteMockServerDocument")),
          { id }
        )
        .toPromise()
      if (result.error) {
        throw new Error(result.error.message || "Failed to delete mock server")
      }
      if (!result.data) {
        throw new Error("No data returned from delete mock server mutation")
      }
      return result.data.deleteMockServer as boolean
    },
    (error) => (error as Error).message as DeleteMockServerError
  )
// Centralized mapper for backend GraphQL error tokens to user-facing messages.
export const getErrorMessage = (err: GQLError<string> | string | Error) => {
  const t = getI18n()
  // Normalize to GQLError-like shape
  let gErr: GQLError<string> | null = null
  if (typeof err === "string") {
    gErr = { type: "gql_error", error: err }
  } else if (err instanceof Error) {
    gErr = { type: "network_error", error: err }
  } else if ((err as any)?.type) {
    gErr = err as GQLError<string>
  }
  return t("error.something_went_wrong")
}
