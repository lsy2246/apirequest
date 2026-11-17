import { parentPort, workerData } from 'node:worker_threads';
import { runWorkbenchAutomation } from '@apirequest/runner';

let paused = false;
let resume: (() => void) | undefined;
let acknowledge: (() => void) | undefined;
parentPort.on('message', (message) => {
  if (message.action === 'ack') {
    acknowledge?.();
    acknowledge = undefined;
  }
  if (message.action === 'pause') paused = true;
  if (message.action === 'resume') {
    paused = false;
    resume?.();
  }
});
void runWorkbenchAutomation(
  workerData,
  (progress) =>
    new Promise<void>((resolve) => {
      acknowledge = resolve;
      parentPort.postMessage({ progress });
    }),
  async (pauseForError) => {
    if (pauseForError) paused = true;
    while (paused) {
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      parentPort.postMessage({ paused: true, auto: pauseForError });
      await resumed;
      resume = undefined;
    }
  },
).then(
  (result) => parentPort.postMessage({ result }),
  (error) =>
    parentPort.postMessage({
      error:
        error instanceof Error && error.message === 'invalid_request'
          ? 'invalid_request'
          : 'runner_error',
      details:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    }),
);
