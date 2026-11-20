import {
  HoppCollection,
  HoppRESTRequest,
  isGQLRequest,
  buildCaseRequest,
  evaluateAssertions,
  DEFAULT_CASE_TIMEOUT_MS,
  CaseTimeoutError,
  runWithCaseDeadline,
} from "@apirequest/data";
import chalk from "chalk";
import { log } from "console";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import { round, cloneDeep } from "lodash-es";

import { CollectionRunnerParam } from "../types/collections";
import {
  CollectionQueue,
  HoppEnvs,
  ProcessRequestParams,
  RequestReport,
} from "../types/request";
import {
  PreRequestMetrics,
  RequestMetrics,
  TestMetrics,
} from "../types/response";
import { DEFAULT_DURATION_PRECISION } from "./constants";
import {
  printErrorsReport,
  printFailedTestsReport,
  printPreRequestMetrics,
  printRequestsMetrics,
  printTestsMetrics,
} from "./display";
import { exceptionColors } from "./getters";
import { getPreRequestMetrics } from "./pre-request";
import { preProcessGQLRequest } from "./gql-request";
import { buildJUnitReport, generateJUnitReportExport } from "./reporters/junit";
import {
  getRequestMetrics,
  preProcessRequest,
  processRequest,
} from "./request";
import { getTestMetrics } from "./test";
import { filterValidScripts } from "@apirequest/js-sandbox/scripting";
import { reportError } from "./report";

const { WARN, FAIL, INFO } = exceptionColors;

/**
 * Processes each requests within collections to prints details of subsequent requests,
 * tests and to display complete errors-report, failed-tests-report and test-metrics.
 * @param param Data of hopp-collection with hopp-requests, envs to be processed.
 * @returns List of report for each processed request.
 */

export const collectionsRunner = async (
  param: CollectionRunnerParam
): Promise<RequestReport[]> => {
  const {
    collections,
    envs,
    delay,
    iterationCount,
    iterationData,

    stopOnError,
    foldersFirst,
    keepVariableValues,
  } = param;

  const resolvedDelay = delay ?? 0;

  const requestsReport: RequestReport[] = [...(param.resumeResults ?? [])];
  let remainingSkip = requestsReport.length;
  const resumeIteration = requestsReport.at(-1)?.iteration ?? 1;
  const collectionQueue = getCollectionQueue(collections);

  // If iteration count is not supplied, it should be based on the size of iteration data if in scope
  const resolvedIterationCount = iterationCount ?? iterationData?.length ?? 1;

  const originalSelectedEnvs = [...(param.initialEnvs ?? envs).selected];
  const originalGlobalEnvs = [...(param.initialEnvs ?? envs).global];

  for (let count = 0; count < resolvedIterationCount; count++) {
    if (resolvedIterationCount > 1) {
      log(INFO(`\nIteration: ${count + 1}/${resolvedIterationCount}`));
    }

    // Reset `envs` to the original value at the start of each iteration
    if (!(remainingSkip > 0 && count + 1 <= resumeIteration)) {
      if (!keepVariableValues) envs.selected = [...originalSelectedEnvs];
      if (keepVariableValues === false) envs.global = [...originalGlobalEnvs];
    }

    if (iterationData) {
      // Ensure last item is picked if the iteration count exceeds size of the iteration data
      const iterationDataItem =
        iterationData[Math.min(count, iterationData.length - 1)];

      // Ensure iteration data takes priority over supplied environment variables
      envs.selected = envs.selected
        .filter(
          (envPair) =>
            !iterationDataItem.some((dataPair) => dataPair.key === envPair.key)
        )
        .concat(iterationDataItem);
    }

    for (const { collection, path } of collectionQueue) {
      const firstResult = requestsReport.length;
      const completed = await processCollection(
        collection,
        path,
        envs,
        resolvedDelay,
        requestsReport,

        stopOnError,
        foldersFirst,
        [],
        [],
        param.onRequestComplete,
        param.beforeRequest,
        count + 1,
        () => {
          if (remainingSkip > 0) {
            remainingSkip--;
            return true;
          }
          return false;
        },
        param
      );
      for (const report of requestsReport.slice(firstResult))
        report.iteration = count + 1;
      if (!completed) return requestsReport;
    }
  }

  return requestsReport;
};

const processCollection = async (
  collection: HoppCollection,
  path: string,
  envs: HoppEnvs,
  delay: number,
  requestsReport: RequestReport[],

  stopOnError?: boolean,
  foldersFirst?: boolean,
  ancestorPreRequestScripts: string[] = [],
  ancestorTestScripts: string[] = [],
  onRequestComplete?: (report: RequestReport) => void | Promise<void>,
  beforeRequest?: (entry?: {
    name: string;
    iteration: number;
  }) => Promise<void>,
  iteration = 1,
  skipRequest?: () => boolean,
  caseOptions?: CollectionRunnerParam
) => {
  // Accumulate scripts from root -> current collection for inheritance
  // filterValidScripts strips empty, whitespace-only, and module-prefix-only scripts
  const inheritedPreRequestScripts = filterValidScripts([
    ...ancestorPreRequestScripts,
    collection.preRequestScript,
  ]);
  const inheritedTestScripts = filterValidScripts([
    ...ancestorTestScripts,
    collection.testScript,
  ]);

  const runRequests = async () => {
    // GraphQL requests become REST-shaped stubs so the shared pipeline runs
    // them unchanged; unrunnable stubs fail at effective-request time
    for (const base of collection.requests) {
      if (
        caseOptions?.selectedRequestIDs &&
        !caseOptions.selectedRequestIDs.includes(base.id ?? base._ref_id ?? "")
      )
        continue;
      const saved = isGQLRequest(base)
        ? []
        : (base.id && caseOptions?.requestCases?.[base.id]) ||
          (base._ref_id && caseOptions?.requestCases?.[base._ref_id]) ||
          [];
      const cases = saved.length
        ? saved.filter(
            (entry) =>
              !caseOptions?.selectedCaseIDs ||
              caseOptions.selectedCaseIDs.includes(entry.id)
          )
        : caseOptions?.casesOnly
          ? []
          : [undefined];
      for (const testCase of cases) {
        if (skipRequest?.()) continue;
        const name = testCase ? `${base.name} · ${testCase.name}` : base.name;
        await beforeRequest?.({ name, iteration });
        if (testCase && delay > 0)
          await new Promise((resolve) => setTimeout(resolve, delay));
        const caseStarted = Date.now();
        const timeoutMs = testCase?.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;
        let requestReport: RequestReport;
        try {
          const definition =
            testCase && caseOptions?.executeCaseScripts === false
              ? { ...testCase, scripts: "disabled" as const }
              : testCase;
          const request = definition
            ? buildCaseRequest(base as HoppRESTRequest, definition, {
                headers: collection.headers.map((inheritedHeader) => ({
                  inheritedHeader,
                })),
                auth: { inheritedAuth: collection.auth },
              })
            : cloneDeep(base);
          request.name = name;
          const _request = isGQLRequest(request)
            ? preProcessGQLRequest(request, collection)
            : preProcessRequest(
                request as HoppRESTRequest,
                definition ? { ...collection, headers: [] } : collection
              );
          const requestPath = `${path}/${_request.name}`;

          const collectionVariables = collection.variables.filter(
            (variable) => variable.key && variable.key.trim() !== ""
          );

          const caseEnv = definition ? cloneDeep(envs) : envs;
          if (definition?.environmentID !== undefined) {
            if (definition.environmentID === null) caseEnv.selected = [];
            else {
              const values =
                caseOptions?.caseEnvironments?.[definition.environmentID];
              if (!values) throw new Error("case_environment_missing");
              caseEnv.selected = cloneDeep(values);
            }
          }
          if (definition) {
            caseEnv.selected = [
              ...Object.entries(definition.variables).map(([key, value]) => ({
                key,
                initialValue: value,
                currentValue: value,
                secret: false as const,
              })),
              ...caseEnv.selected.filter(
                ({ key }) => !Object.hasOwn(definition.variables, key)
              ),
            ];
          }
          const processRequestParams: ProcessRequestParams = {
            path: requestPath,
            request: _request,
            envs: caseEnv,
            delay: definition ? 0 : delay,

            collectionVariables: definition
              ? [
                  ...Object.entries(definition.variables).map(
                    ([key, value]) => ({
                      key,
                      initialValue: value,
                      currentValue: value,
                      secret: false as const,
                    })
                  ),
                  ...collectionVariables.filter(
                    ({ key }) => !Object.hasOwn(definition.variables, key)
                  ),
                ]
              : collectionVariables,
            haltOnPreRequestError: !!definition,
            inheritedPreRequestScripts:
              definition && definition.scripts !== "inherit"
                ? []
                : inheritedPreRequestScripts,
            inheritedTestScripts:
              definition && definition.scripts !== "inherit"
                ? []
                : inheritedTestScripts,
          };

          // Request processing initiated message.
          log(WARN(`\nRunning: ${chalk.bold(requestPath)}`));

          // Processing current request.
          const result = definition
            ? await runWithCaseDeadline(timeoutMs, (signal) =>
                processRequest({ ...processRequestParams, signal })()
              )
            : await processRequest(processRequestParams)();

          // Updating global & selected envs with new envs from processed-request output.
          const { global, selected } = result.envs;
          if (!definition) {
            envs.global = global;
            envs.selected = selected;
          }

          // Storing current request's report.
          requestReport = result.report;
          if (definition) {
            const response = requestReport.response;
            const assertions = evaluateAssertions(definition.assertions, {
              status: response?.statusCode ?? 0,
              headers: Object.fromEntries(
                (response?.headers ?? []).map(({ key, value }) => [key, value])
              ),
              body: response?.body ?? "",
              duration: requestReport.requestElapsedMs ?? 0,
            });
            requestReport.tests.push(
              ...assertions.map((item) => ({
                descriptor:
                  `${item.assertion.target} ${item.assertion.path} ${item.assertion.operator}`.trim(),
                passed: item.passed ? 1 : 0,
                failed: item.passed ? 0 : 1,
                expectResults: [
                  {
                    status: item.passed ? ("pass" as const) : ("fail" as const),
                    message: `expected: ${JSON.stringify(item.expected)}, actual: ${JSON.stringify(item.actual)}${item.error ? ` (${item.error})` : ""}`,
                  },
                ],
              }))
            );
            requestReport.result =
              requestReport.result && assertions.every((item) => item.passed);
            if (Date.now() - caseStarted >= timeoutMs)
              throw new CaseTimeoutError(timeoutMs, Date.now() - caseStarted);
          }
        } catch (cause) {
          if (!testCase) throw cause;
          requestReport = {
            path: `${path}/${name}`,
            requestName: name,
            method: "method" in base ? base.method : "POST",
            endpoint: "endpoint" in base ? base.endpoint : base.url,
            iteration,
            result: false,
            tests: [],
            errors: [
              {
                code:
                  cause instanceof CaseTimeoutError
                    ? "CASE_TIMEOUT"
                    : "REQUEST_ERROR",
                data: reportError(cause),
              },
            ],
            duration: { test: 0, request: 0, preRequest: 0 },
            requestElapsedMs:
              cause instanceof CaseTimeoutError ? cause.elapsedMs : undefined,
          };
        }
        requestReport.iteration = iteration;
        requestsReport.push(requestReport);
        await onRequestComplete?.(requestReport);
        if (stopOnError && !requestReport.result) return false;
      }
    }
    return true;
  };

  if (!foldersFirst && !(await runRequests())) return false;

  // Process each folder in the collection
  for (const folder of collection.folders) {
    const updatedFolder: HoppCollection = { ...folder };

    if (updatedFolder.auth.authType === "inherit") {
      updatedFolder.auth = collection.auth;
    }

    if (collection.headers.length) {
      // Filter out header entries present in the parent collection under the same name
      // This ensures the folder headers take precedence over the collection headers
      const filteredHeaders = collection.headers.filter(
        (collectionHeaderEntries) => {
          return !updatedFolder.headers.some(
            (folderHeaderEntries) =>
              folderHeaderEntries.key === collectionHeaderEntries.key
          );
        }
      );
      updatedFolder.headers.push(...filteredHeaders);
    }

    // Inherit collection variables into folder, with folder variables taking precedence
    if (collection.variables.length) {
      // Filter out collection variables with same key as folder variables
      const filteredVariables = collection.variables.filter(
        (collectionVariableEntries) => {
          return !updatedFolder.variables.some(
            (folderVariableEntries) =>
              folderVariableEntries.key === collectionVariableEntries.key
          );
        }
      );

      updatedFolder.variables.push(...filteredVariables);
    }

    const completed = await processCollection(
      updatedFolder,
      `${path}/${updatedFolder.name}`,
      envs,
      delay,
      requestsReport,

      stopOnError,
      foldersFirst,
      inheritedPreRequestScripts,
      inheritedTestScripts,
      onRequestComplete,
      beforeRequest,
      iteration,
      skipRequest,
      caseOptions
    );
    if (!completed) return false;
  }
  return !foldersFirst || runRequests();
};
/**
 * Transforms collections to generate collection-stack which describes each collection's
 * path within collection & the collection itself.
 * @param collections Hopp-collection objects to be mapped to collection-stack type.
 * @returns Mapped collections to collection-stack.
 */
const getCollectionQueue = (collections: HoppCollection[]): CollectionQueue[] =>
  pipe(
    collections,
    A.map(
      (collection) => <CollectionQueue>{ collection, path: collection.name }
    )
  );

/**
 * Prints collection-runner-report using test-metrics, request-metrics and
 * pre-request-metrics data in pretty-format.
 * @param requestsReport Provides data for each request-report which includes
 * path of each request within collection-json file, failed-tests-report, errors,
 * total execution duration for requests, pre-request-scripts, test-scripts.
 * @returns True, if collection runner executed without any errors or failed test-cases.
 * False, if errors occurred or test-cases failed.
 */
export const collectionsRunnerResult = (
  requestsReport: RequestReport[],
  reporterJUnitExportPath?: string
): boolean => {
  const overallTestMetrics = <TestMetrics>{
    tests: { failed: 0, passed: 0 },
    testSuites: { failed: 0, passed: 0 },
    duration: 0,
    scripts: { failed: 0, passed: 0 },
  };
  const overallRequestMetrics = <RequestMetrics>{
    requests: { failed: 0, passed: 0 },
    duration: 0,
  };
  const overallPreRequestMetrics = <PreRequestMetrics>{
    scripts: { failed: 0, passed: 0 },
    duration: 0,
  };
  let finalResult = true;

  let totalErroredTestCases = 0;
  let totalFailedTestCases = 0;

  // Printing requests-report details of failed-tests and errors
  for (const requestReport of requestsReport) {
    const { path, tests, errors, result, duration } = requestReport;
    const requestDuration = duration.request;
    const testsDuration = duration.test;
    const preRequestDuration = duration.preRequest;

    finalResult = finalResult && result;

    printFailedTestsReport(path, tests);

    printErrorsReport(path, errors);

    if (reporterJUnitExportPath) {
      const { failedRequestTestCases, erroredRequestTestCases } =
        buildJUnitReport({
          path,
          tests,
          errors,
          duration: duration.test,
        });

      totalFailedTestCases += failedRequestTestCases;
      totalErroredTestCases += erroredRequestTestCases;
    }

    /**
     * Extracting current request report's test-metrics and updating
     * overall test-metrics.
     */
    const testMetrics = getTestMetrics(tests, testsDuration, errors);
    overallTestMetrics.duration += testMetrics.duration;
    overallTestMetrics.testSuites.failed += testMetrics.testSuites.failed;
    overallTestMetrics.testSuites.passed += testMetrics.testSuites.passed;
    overallTestMetrics.tests.failed += testMetrics.tests.failed;
    overallTestMetrics.tests.passed += testMetrics.tests.passed;
    overallTestMetrics.scripts.failed += testMetrics.scripts.failed;
    overallTestMetrics.scripts.passed += testMetrics.scripts.passed;

    /**
     * Extracting current request report's request-metrics and updating
     * overall request-metrics.
     */
    const requestMetrics = getRequestMetrics(errors, requestDuration);
    overallRequestMetrics.duration += requestMetrics.duration;
    overallRequestMetrics.requests.failed += requestMetrics.requests.failed;
    overallRequestMetrics.requests.passed += requestMetrics.requests.passed;

    /**
     * Extracting current request report's pre-request-metrics and updating
     * overall pre-request-metrics.
     */
    const preRequestMetrics = getPreRequestMetrics(errors, preRequestDuration);
    overallPreRequestMetrics.duration += preRequestMetrics.duration;
    overallPreRequestMetrics.scripts.failed += preRequestMetrics.scripts.failed;
    overallPreRequestMetrics.scripts.passed += preRequestMetrics.scripts.passed;
  }

  const testMetricsDuration = overallTestMetrics.duration;
  const requestMetricsDuration = overallRequestMetrics.duration;

  // Rounding-off overall test-metrics duration upto DEFAULT_DURATION_PRECISION.
  overallTestMetrics.duration = round(
    testMetricsDuration,
    DEFAULT_DURATION_PRECISION
  );

  // Rounding-off overall request-metrics duration upto DEFAULT_DURATION_PRECISION.
  overallRequestMetrics.duration = round(
    requestMetricsDuration,
    DEFAULT_DURATION_PRECISION
  );

  printTestsMetrics(overallTestMetrics);
  printRequestsMetrics(overallRequestMetrics);
  printPreRequestMetrics(overallPreRequestMetrics);

  if (reporterJUnitExportPath) {
    const totalTestCases =
      overallTestMetrics.tests.failed + overallTestMetrics.tests.passed;

    generateJUnitReportExport({
      totalTestCases,
      totalFailedTestCases,
      totalErroredTestCases,
      testDuration: overallTestMetrics.duration,
      reporterJUnitExportPath,
    });
  }

  return finalResult;
};

/**
 * Exiting hopp cli process with appropriate exit code depending on
 * collections-runner result.
 * If result is true, we exit the cli process with code 0.
 * Else, exit with code 1.
 * @param result Boolean defining the collections-runner result.
 */
export const collectionsRunnerExit = (result: boolean): never => {
  if (!result) {
    const EXIT_MSG = FAIL(`\nExited with code 1`);
    process.stderr.write(EXIT_MSG);
    process.exit(1);
  }
  process.exit(0);
};
