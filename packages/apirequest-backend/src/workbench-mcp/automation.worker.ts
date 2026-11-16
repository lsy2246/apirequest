import { parentPort, workerData } from 'node:worker_threads';
import { runWorkbenchAutomation } from '@apirequest/runner';

void runWorkbenchAutomation(workerData, (progress) =>
  parentPort.postMessage({ progress }),
).then(
  (result) => parentPort.postMessage({ result }),
  (error) =>
    parentPort.postMessage({
      error:
        error instanceof Error && error.message === 'invalid_request'
          ? 'invalid_request'
          : 'runner_error',
    }),
);
