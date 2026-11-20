export const DEFAULT_CASE_TIMEOUT_MS = 10_000
export const MAX_CASE_TIMEOUT_MS = 3_600_000
const deadlines = new WeakMap<AbortSignal, number>()
export const caseDeadline = (signal?: AbortSignal) =>
  signal ? deadlines.get(signal) : undefined

export class CaseTimeoutError extends Error {
  readonly code = "CASE_TIMEOUT"
  constructor(
    readonly timeoutMs: number,
    readonly elapsedMs: number
  ) {
    super(`Test case exceeded ${timeoutMs} ms (elapsed ${elapsedMs} ms)`)
    this.name = "CaseTimeoutError"
  }
}

/** One deadline for setup, network I/O and assertions, with cancellation shared by script fetches. */
export async function runWithCaseDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal
): Promise<T> {
  parentSignal?.throwIfAborted()
  const started = Date.now()
  const controller = new AbortController()
  deadlines.set(controller.signal, started + timeoutMs)
  const onParentAbort = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener("abort", onParentAbort, { once: true })
  const timer = setTimeout(
    () =>
      controller.abort(new CaseTimeoutError(timeoutMs, Date.now() - started)),
    timeoutMs
  )
  try {
    const result = await raceWithSignal(
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return run(controller.signal)
      }),
      controller.signal
    )
    if (Date.now() - started >= timeoutMs)
      throw new CaseTimeoutError(timeoutMs, Date.now() - started)
    return result
  } catch (error) {
    if (!parentSignal?.aborted && Date.now() - started >= timeoutMs) {
      const timeout =
        error instanceof CaseTimeoutError
          ? error
          : new CaseTimeoutError(timeoutMs, Date.now() - started)
      controller.abort(timeout)
      throw timeout
    }
    throw error
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener("abort", onParentAbort)
    // A script may have started work without awaiting it. It cannot outlive its case.
    controller.abort(new DOMException("Test case finished", "AbortError"))
  }
}

export function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"))
    if (signal.aborted) onAbort()
    else signal.addEventListener("abort", onAbort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort))
  })
}
