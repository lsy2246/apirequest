import { Worker } from 'node:worker_threads';
import { IncomingMock, Step, parseMockRules } from './mock-engine';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const scriptWorker = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async()=>{
  let runtime,context;
  try {
    const { getQuickJS }=require(workerData.module);
    const engine=await getQuickJS();runtime=engine.newRuntime();
    runtime.setMemoryLimit(32*1024*1024);runtime.setMaxStackSize(512*1024);
    const deadline=Date.now()+workerData.timeout;
    runtime.setInterruptHandler(()=>Date.now()>=deadline);
    context=runtime.newContext();
    const result=context.evalCode('JSON.stringify((function(request){"use strict";\n'+workerData.code+'\n})('+JSON.stringify(workerData.request)+'))');
    const value=context.unwrapResult(result);
    try {const text=context.getString(value);if(text.length>1048576)throw new Error('Response exceeds 1 MiB');parentPort.postMessage({value:JSON.parse(text)});}finally{value.dispose();}
  } catch(error) {parentPort.postMessage({error:String(error.message??error)});}
  finally {context?.dispose();runtime?.dispose();}
})();`;
let activeScripts = 0;
const scriptQueue: (() => void)[] = [];
export async function runMockScript(
  code: string,
  request: IncomingMock,
  params: Record<string, string>,
  timeoutMs = 1000,
): Promise<unknown> {
  if (activeScripts >= 4) {
    if (scriptQueue.length >= 64)
      throw new Error('Too many pending Mock scripts');
    await new Promise<void>((resolve) => scriptQueue.push(resolve));
  } else activeScripts++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(scriptWorker, {
        eval: true,
        workerData: {
          module: require.resolve('quickjs-emscripten'),
          code,
          request: { ...request, params },
          timeout: timeoutMs,
        },
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () => finish(new Error('Mock script timed out')),
        timeoutMs + 3000,
      );
      worker.once('message', (message) =>
        finish(
          message.error
            ? new Error('Mock script: ' + message.error)
            : undefined,
          message.value,
        ),
      );
      worker.once('error', finish);
      worker.once('exit', (code) => {
        if (code !== 0) finish(new Error('Mock script worker exited'));
      });
    });
  } finally {
    const next = scriptQueue.shift();
    if (next) next();
    else activeScripts--;
  }
}
export function callbackMock(
  step: Step,
  request: IncomingMock,
  params: Record<string, string>,
): Promise<unknown> {
  const config = step.callback!;
  const target = new URL(config.url);
  const body = Buffer.from(JSON.stringify({ ...request, params }));
  return new Promise((resolve, reject) => {
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: 'POST',
        headers: {
          ...config.headers,
          'content-type': 'application/json',
          'content-length': body.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1048576) {
            req.destroy(new Error('Mock callback response exceeds 1 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          if (
            !res.statusCode ||
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            reject(new Error(`Mock callback HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Mock callback must return JSON'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error('Mock callback timed out')),
      config.timeoutMs,
    );
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(body);
  });
}
export async function resolveMockAction(
  step: Step,
  request: IncomingMock,
  params: Record<string, string>,
): Promise<Step> {
  if (step.action !== 'script' && step.action !== 'callback') return step;
  const result =
    step.action === 'script'
      ? await runMockScript(
          step.script!.code,
          request,
          params,
          step.script!.timeoutMs,
        )
      : await callbackMock(step, request, params);
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Mock action must return a response object');
  const response = result as any;
  const [rule] = parseMockRules([
    {
      id: 'generated-response',
      name: 'Generated response',
      method: 'GET',
      path: '/',
      enabled: true,
      conditions: [],
      exhausted: 'repeat_last',
      steps: [
        {
          ...step,
          action: 'http',
          statusCode: response.statusCode ?? 200,
          headers: response.headers ?? {},
          cookies: response.cookies ?? step.cookies ?? [],
          body:
            typeof response.body === 'string'
              ? response.body
              : JSON.stringify(response.body ?? null),
          template: false,
        },
      ],
    },
  ]);
  return rule.steps[0];
}
// Cookies on path-based Mock endpoints must not replace the workbench session.
export function scopedMockCookies(values: string[], prefix?: string): string[] {
  return values.map((value) => {
    if (!prefix) return value;
    const parts = value
      .split(';')
      .map((v) => v.trim())
      .filter(Boolean);
    const path = parts.find((v) => /^path=/i.test(v))?.slice(5);
    return [
      ...parts.filter((v) => !/^path=|^domain=/i.test(v)),
      `Path=${path?.startsWith(prefix) ? path : prefix}`,
    ].join('; ');
  });
}
