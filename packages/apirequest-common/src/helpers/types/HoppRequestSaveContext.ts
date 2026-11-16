import { HoppRESTRequest } from "@apirequest/data";

/**
 * We use the save context to figure out
 * how a loaded request is to be saved.
 * These will be set when the request is loaded
 * into the request session
 */
export type HoppRequestSaveContext = {
  /**
   * The origin source of the request
   */
  originLocation: "user-collection"
  /**
   * Path to the request folder
   */
  folderPath: string
  /**
   * Index to the request
   */
  requestIndex: number
  /**
   * Current request
   */
  req?: HoppRESTRequest
  /**
   * Reference ID of the request, if available
   */
  requestRefID?: string
}
