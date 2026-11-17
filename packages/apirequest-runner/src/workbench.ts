import {
  HoppCollection,
  makeCollection,
  HoppGQLRequest,
  HoppRESTRequest,
} from "@apirequest/data";
import { HoppEnvs, RequestReport } from "./types/request";
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

export type WorkbenchRecovery = {
  version: 1;
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
  };
  envs: HoppEnvs;
  results: RequestReport[];
  inFlight?: { name: string; iteration: number };
};
const snapshot = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      item instanceof Error
        ? reportError(item)
        : typeof item === "bigint"
          ? String(item)
          : item
    )
  );

export type WorkbenchAutomationProgress = {
  completed: number;
  total: number;
  report?: ReturnType<typeof automationResult>;
  recovery?: WorkbenchRecovery;
};

export async function runWorkbenchAutomation(
  input: {
    recovery?: WorkbenchRecovery;
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
  onProgress?: (progress: WorkbenchAutomationProgress) => void | Promise<void>,
  beforeRequest?: (pauseForError?: boolean) => Promise<void>
) {
  const started = Date.now();
  const count = (tree: CollectionTree): number =>
    tree.requests.length +
    tree.folders.reduce((sum, folder) => sum + count(folder), 0);
  const total = count(input.collection) * (input.config.iterations ?? 1);
  const recovery: WorkbenchRecovery = input.recovery
    ? snapshot(input.recovery)
    : {
        version: 1,
        input: snapshot(input),
        envs: snapshot(input.envs),
        results: [],
      };
  const envs = snapshot(recovery.envs);
  let completed = recovery.results.length;
  const partial: RequestReport[] = [...recovery.results];
  let pauseForError = false;
  await onProgress?.({
    completed,
    total,
    report: automationResult(partial, started, "running"),
    recovery: snapshot(recovery),
  });
  const results = await collectionsRunner({
    collections: [
      fromTree(input.collection, input.config.executeScripts !== false),
    ],
    envs,
    initialEnvs: recovery.input.envs,
    resumeResults: recovery.results,
    delay: input.config.delay,
    iterationCount: input.config.iterations,
    stopOnError: beforeRequest ? false : input.config.stopOnError,
    foldersFirst: true,
    keepVariableValues: input.config.keepVariableValues ?? false,

    beforeRequest: async (entry) => {
      await beforeRequest?.(pauseForError);
      pauseForError = false;
      recovery.inFlight = entry;
      await onProgress?.({
        completed,
        total,
        report: automationResult(partial, started, "running"),
        recovery: snapshot(recovery),
      });
    },
    onRequestComplete: async (report) => {
      partial.push(report);
      recovery.results = [...partial];
      recovery.envs = snapshot(envs);
      recovery.inFlight = undefined;
      pauseForError =
        input.config.stopOnError === true &&
        (!report.result ||
          ((report.response?.statusCode ?? 0) >= 400 &&
            !report.tests.some((test) => test.passed + test.failed > 0)));
      await onProgress?.({
        completed: ++completed,
        total,
        report: automationResult(partial, started, "running"),
        recovery: snapshot(recovery),
      });
    },
  });

  return automationResult(results, started);
}

function automationResult(
  results: RequestReport[],
  started: number,
  status?: string
) {
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
      failed: results.length ? failed : status === "running" ? 0 : 1,
      elapsedMs: Date.now() - started,
    },
    automation: {
      status:
        status ?? (!results.length ? "empty" : failed ? "failed" : "passed"),
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
