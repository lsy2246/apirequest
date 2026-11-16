import { ReqType } from "~/helpers/backend/enums";
import { HoppCollection } from "@apirequest/data";

import * as E from "fp-ts/Either";

export type CollectionsPlatformDef = {
  initCollectionsSync: () => void | Promise<void>
  loadUserCollections?: (collectionType: "REST" | "GQL") => Promise<void>
  importToPersonalWorkspace?: (
    collections: HoppCollection[],
    reqType: ReqType
  ) => Promise<E.Either<string, { success: boolean }>>
}
