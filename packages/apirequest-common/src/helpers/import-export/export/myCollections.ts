import { HoppCollection } from "@apirequest/data";
import { stripRefIdReplacer } from ".";
import { stripCollectionTreeForStore } from "~/helpers/clientLocalVariables";
import { assertCollectionLoaded } from "~/helpers/collection-summary";

export const myCollectionsExporter = (myCollections: HoppCollection[]) => {
  myCollections.forEach(assertCollectionLoaded)
  const stripped = myCollections.map(stripCollectionTreeForStore)
  return JSON.stringify(stripped, stripRefIdReplacer, 2)
}
