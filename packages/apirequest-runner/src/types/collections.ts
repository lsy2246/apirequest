import { HoppCollection } from "@apirequest/data";
import { HoppEnvPair, HoppEnvs, RequestReport } from "./request";

export type CollectionRunnerParam = {
  collections: HoppCollection[];
  envs: HoppEnvs;
  delay?: number;
  iterationData?: IterationDataItem[][];
  iterationCount?: number;

  stopOnError?: boolean;
  foldersFirst?: boolean;
  keepVariableValues?: boolean;
  resumeResults?: RequestReport[];
  initialEnvs?: HoppEnvs;
  beforeRequest?: (entry?: {
    name: string;
    iteration: number;
  }) => Promise<void>;
  onRequestComplete?: (report: RequestReport) => void | Promise<void>;
};

export type HoppCollectionFileExt = "json";

// Indicates the shape each iteration data entry gets transformed into
export type IterationDataItem = Extract<HoppEnvPair, { value: string }>;
