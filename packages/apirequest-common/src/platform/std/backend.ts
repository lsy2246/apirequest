import { BackendPlatformDef } from "~/platform/backend";
import { createMockServer, updateMockServer, deleteMockServer } from "../../helpers/backend/mutations/MockServer";
import { getMockServer, getMyMockServers } from "../../helpers/backend/queries/MockServer";
import { getMockServerLogs, deleteMockServerLog } from "../../helpers/backend/queries/MockServerLogs";
import { createPublishedDoc, updatePublishedDoc, deletePublishedDoc } from "../../helpers/backend/mutations/PublishedDocs";
import { getPublishedDocByID, getUserPublishedDocs } from "../../helpers/backend/queries/PublishedDocs";
export const def: BackendPlatformDef = {
  createMockServer,
  updateMockServer,
  deleteMockServer,
  getMockServer,
  getMyMockServers,
  getMockServerLogs,
  deleteMockServerLog,
  createPublishedDoc,
  updatePublishedDoc,
  deletePublishedDoc,
  getPublishedDocByID,
  getUserPublishedDocs,
}
