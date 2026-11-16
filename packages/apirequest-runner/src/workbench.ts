import {
  HoppCollection,
  makeCollection,
  HoppGQLRequest,
  HoppRESTRequest,
} from "@apirequest/data";
import { HoppEnvs } from "./types/request";
import { collectionsRunner } from "./utils/collections";
import { reportError } from "./utils/report";
import { getTestMetrics } from "./utils/test";

type CollectionTree = {
  id: string;
  name: string;
  data: string | null;
  requests: Record<string, unknown>[];
  folders: CollectionTree[];
};

function fromTree(tree: CollectionTree, executeScripts = true): HoppCollection {
  const data = tree.data ? JSON.parse(tree.data) : {};
  return makeCollection({
    ...data,
    auth: data.auth ?? { authType: "inherit", authActive: true },
    headers: data.headers ?? [],
    variables: data.variables ?? [],
    id: tree.id,
    name: tree.name,
    preRequestScript: executeScripts ? (data.preRequestScript ?? "") : "",
    testScript: executeScripts ? (data.testScript ?? "") : "",
    folders: tree.folders.map((folder) => fromTree(folder, executeScripts)),
    requests: tree.requests.map((request) => {
      const schema =
        "query" in request && "url" in request && !("endpoint" in request)
          ? HoppGQLRequest
          : HoppRESTRequest;
      const parsed = schema.safeParse(request);
      // 后台执行遇到无效配置时停止，避免默认示例地址替代原请求。
      if (parsed.type !== "ok") throw new Error("invalid_request");
      return executeScripts
        ? parsed.value
        : { ...parsed.value, preRequestScript: "", testScript: "" };
    }),
  });
}

export type WorkbenchAutomationProgress = { completed: number; total: number };

export async function runWorkbenchAutomation(
  input: {
    collection: CollectionTree;
    envs: HoppEnvs;
    config: {
      iterations?: number;
      delay?: number;
      stopOnError?: boolean;
      keepVariableValues?: boolean;
      executeScripts?: boolean;
    };
  },
  onProgress?: (progress: WorkbenchAutomationProgress) => void
) {
  const started = Date.now();
  const count = (tree: CollectionTree): number =>
    tree.requests.length +
    tree.folders.reduce((sum, folder) => sum + count(folder), 0);
  const total = count(input.collection) * (input.config.iterations ?? 1);
  let completed = 0;
  onProgress?.({ completed, total });
  const results = await collectionsRunner({
    collections: [
      fromTree(input.collection, input.config.executeScripts !== false),
    ],
    envs: input.envs,
    delay: input.config.delay,
    iterationCount: input.config.iterations,
    stopOnError: input.config.stopOnError,
    foldersFirst: true,
    keepVariableValues: input.config.keepVariableValues ?? false,

    onRequestComplete: () => onProgress?.({ completed: ++completed, total }),
  });

  let failedTests = 0;
  let passedTests = 0;
  let failed = 0;
  for (const result of results) {
    const metrics = getTestMetrics(
      result.tests,
      result.duration.test,
      result.errors
    );
    failedTests += metrics.tests.failed;
    passedTests += metrics.tests.passed;
    if (
      !result.result ||
      ((result.response?.statusCode ?? 0) >= 400 &&
        metrics.tests.passed + metrics.tests.failed === 0)
    )
      failed++;
  }
  return {
    summary: {
      completed: results.length,
      failed: results.length ? failed : 1,
      elapsedMs: Date.now() - started,
    },
    automation: {
      status: !results.length ? "empty" : failed ? "failed" : "passed",
      passedTests,
      failedTests,
      totalTests: failedTests + passedTests,
    },
    // 保留执行器返回的错误、响应与断言，供历史报告查看。
    steps: results.map((result) => ({
      name: result.path,
      requestName: result.requestName,
      method: result.method,
      endpoint: result.endpoint,
      iteration: result.iteration,
      passed:
        result.result &&
        ((result.response?.statusCode ?? 0) < 400 ||
          result.tests.some((test) => test.passed + test.failed > 0)),
      detailsRecorded: true,
      elapsedMs: result.requestElapsedMs,
      statusCode: result.response?.statusCode,
      response: result.response,
      errorDetails: result.errors.map((error) => ({
        code: error.code,
        data: reportError("data" in error ? error.data : error),
      })),
      assertions: result.tests,
      errors: result.errors.map((error) => error.code),
    })),
  };
}
