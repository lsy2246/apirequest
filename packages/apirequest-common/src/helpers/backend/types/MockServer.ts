import { WorkspaceType } from "~/helpers/backend/enums";

/**
 * Canonical MockServer type used across the frontend.
 * Shared by backend SDK operations and mutation helpers.
 */
export type MockServer = {
  id: string
  name: string
  subdomain: string
  serverUrlPathBased?: string
  serverUrlDomainBased?: string | null
  workspaceType: WorkspaceType
  workspaceID?: string | null
  delayInMs?: number
  isPublic: boolean
  localAccessKey?: string
  isActive: boolean
  createdOn: Date | string
  updatedOn: Date | string
  creator?: {
    uid: string
  } | null
  collection?: {
    id: string
    title: string
    requests?: any[]
  } | null
  // Legacy fields for backward compatibility
  userUid?: string
  collectionID?: string
}
