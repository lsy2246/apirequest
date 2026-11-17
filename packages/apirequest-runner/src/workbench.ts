import {
  HoppCollection,
  makeCollection,
  HoppGQLRequest,
  HoppRESTRequest,
  getAutomationConfig,
  type AutomationConfig,
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
    config: Partial<AutomationConfig>;
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
    config: Partial<AutomationConfig>;
  },
  onProgress?: (progress: WorkbenchAutomationProgress) => void | Promise<void>,
  beforeRequest?: (pauseForError?: boolean) => Promise<void>
) {
  const started = Date.now();
  const config = getAutomationConfig(input.config);
  const retainResponse = (report: RequestReport) => {
    if (!config.persistResponses) {
      report.statusCode = report.response?.statusCode ?? report.statusCode;
      report.responseOmitted = !!report.response || report.responseOmitted;
      delete report.response;
    }
    return report;
  };
  const count = (tree: CollectionTree): number =>
    tree.requests.length +
    tree.folders.reduce((sum, folder) => sum + count(folder), 0);
  const total = count(input.collection) * config.iterations;
  const recovery: WorkbenchRecovery = input.recovery
    ? snapshot(input.recovery)
    : {
        version: 1,
        input: snapshot(input),
        envs: snapshot(input.envs),
        results: [],
      };
  recovery.results.forEach(retainResponse);
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
    collections: [fromTree(input.collection, config.executeScripts)],
    envs,
    initialEnvs: recovery.input.envs,
    resumeResults: recovery.results,
    delay: config.delay,
    iterationCount: config.iterations,
    stopOnError: beforeRequest ? false : config.stopOnError,
    foldersFirst: true,
    keepVariableValues: config.keepVariableValues,

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
      retainResponse(report);
      partial.push(report);
      recovery.results = [...partial];
      recovery.envs = snapshot(envs);
      recovery.inFlight = undefined;
      pauseForError =
        config.stopOnError &&
        (!report.result ||
          ((report.statusCode ?? report.response?.statusCode ?? 0) >= 400 &&
            !report.tests.some((test) => test.passed + test.failed > 0)));
      await onProgress?.({
        completed: ++completed,
        total,
        report: automationResult(partial, started, "running"),
        recovery: snapshot(recovery),
      });
    },
  });

  return automationResult(results.map(retainResponse), started);
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
      ((result.statusCode ?? result.response?.statusCode ?? 0) >= 400 &&
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
        ((result.statusCode ?? result.response?.statusCode ?? 0) < 400 ||
          result.tests.some((test) => test.passed + test.failed > 0)),
      detailsRecorded: true,
      elapsedMs: result.requestElapsedMs,
      statusCode: result.statusCode ?? result.response?.statusCode,
      response: result.response,
      responseOmitted: result.responseOmitted === true,
      errorDetails: result.errors.map((error) => ({
        code: error.code,
        data: reportError("data" in error ? error.data : error),
      })),
      assertions: result.tests,
      errors: result.errors.map((error) => error.code),
    })),
  };
}
