import { HoppCollection } from "@apirequest/data";
import { HoppEnvPair, HoppEnvs } from "./request";

export type CollectionRunnerParam = {
  collections: HoppCollection[];
  envs: HoppEnvs;
  delay?: number;
  iterationData?: IterationDataItem[][];
  iterationCount?: number;

  stopOnError?: boolean;
  foldersFirst?: boolean;
  keepVariableValues?: boolean;
  onRequestComplete?: () => void;
};

export type HoppCollectionFileExt = "json";

// Indicates the shape each iteration data entry gets transformed into
export type IterationDataItem = Extract<HoppEnvPair, { value: string }>;
