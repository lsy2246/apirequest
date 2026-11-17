import {
  Environment,
  HoppCollection,
  HoppCollectionVariable,
  HoppRESTRequest,
} from "@apirequest/data";
import { z } from "zod";

import { TestReport } from "../interfaces/response";
import { HoppCLIError } from "./errors";

export type FormDataEntry = {
  key: string;
  value: string | Blob;
  contentType?: string;
};

export type HoppEnvPair = Environment["variables"][number];

export const HoppEnvKeyPairObject = z.record(z.string(), z.string());

export type HoppEnvs = {
  global: HoppEnvPair[];
  selected: HoppEnvPair[];
};

export type CollectionQueue = {
  path: string;
  collection: HoppCollection;
};

export type RequestReport = {
  path: string;
  requestName?: string;
  method?: string;
  endpoint?: string;
  iteration?: number;
  tests: TestReport[];
  errors: HoppCLIError[];
  result: boolean;
  duration: { test: number; request: number; preRequest: number };
  requestElapsedMs?: number;
  statusCode?: number;
  responseOmitted?: boolean;
  response?: ReturnType<typeof import("../utils/report").reportResponse>;
};

export type ProcessRequestParams = {
  request: HoppRESTRequest;
  envs: HoppEnvs;
  path: string;
  delay: number;

  collectionVariables?: HoppCollectionVariable[];
  inheritedPreRequestScripts?: string[];
  inheritedTestScripts?: string[];
};
