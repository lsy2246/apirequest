export type LoadTestConfig = {
  mode: "requests" | "duration"
  concurrency: number
  requests: number
  durationSeconds: number
  timeoutMs: number
}

export type LoadTestAttempt = {
  status: number
  durationMs: number
  bytes: number
}

// 区分传输层已报告的超时与普通断网，不重复取消已结束的传输。
export class LoadTestTimeoutError extends Error {}
export class LoadTestServiceLimitError extends Error {
  constructor(readonly status: 429 | 503) {
    super(`Local relay HTTP ${status}`)
  }
}

export type LoadTestExecution = {
  response: Promise<LoadTestAttempt>
  cancel: () => void | Promise<void>
}

export type LoadTestReport = {
  id: string
  startedAt: string
  state: "running" | "completed" | "stopped" | "limit"
  config: LoadTestConfig
  attempted: number
  completed: number
  succeeded: number
  failed: number
  cleanupIncomplete: boolean
  cancelled: number
  elapsedMs: number
  requestsPerSecond: number
  bytes: number
  averageMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  statuses: Record<string, number>
  series: { second: number; succeeded: number; failed: number }[]
}

export const LOAD_TEST_LIMITS = {
  concurrency: 32,
  requests: 10000,
  durationSeconds: 300,
  timeoutMs: 120000,
  attempts: 100000,
} as const

export function validateLoadTestConfig(config: LoadTestConfig) {
  if (config.mode !== "requests" && config.mode !== "duration")
    throw new Error("Invalid load test mode")
  for (const key of [
    "concurrency",
    "requests",
    "durationSeconds",
    "timeoutMs",
  ] as const) {
    if (
      !Number.isSafeInteger(config[key]) ||
      config[key] < 1 ||
      config[key] > LOAD_TEST_LIMITS[key]
    )
      throw new Error(`Invalid load test ${key}`)
  }
}

// 并发请求使用进程内递增 ID，避免 Date.now() 同毫秒碰撞而取消其他虚拟用户的请求。
let requestSequence = Date.now()
const percentile = (values: number[], percent: number) =>
  values.length
    ? values[Math.max(0, Math.ceil(values.length * percent) - 1)]
    : 0

/**
 * 独立压测执行器：只保留统计，不写普通调试标签、消费历史或共享临时变量。
 * 停止/时长截止会取消所有在途请求；即使传输层未兑现取消，也会解除本次等待。
 */
export class LoadTestRunner {
  private running = false
  private stopping = false
  private deadlineReached = false
  private cleanupFailed = false
  private active = new Map<number, () => void>()
  private cleanup = new Set<Promise<void>>()

  constructor(
    private execute: (id: number, timeoutMs: number) => LoadTestExecution
  ) {}

  stop() {
    this.stopping = true
    for (const cancel of this.active.values()) cancel()
  }

  async run(
    input: LoadTestConfig,
    update: (report: LoadTestReport) => void = () => {}
  ): Promise<LoadTestReport> {
    if (this.running) throw new Error("Load test is already running")
    validateLoadTestConfig(input)
    const config = { ...input }
    this.running = true
    this.stopping = false
    this.deadlineReached = false
    this.cleanupFailed = false
    const started = performance.now()
    const latencies: number[] = []
    let durationTimer: ReturnType<typeof setTimeout> | undefined
    const report: LoadTestReport = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      state: "running",
      config,
      cleanupIncomplete: false,
      attempted: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      elapsedMs: 0,
      requestsPerSecond: 0,
      bytes: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      statuses: {},
      series: [],
    }
    let totalLatency = 0
    const snapshot = (final = false): LoadTestReport => {
      report.elapsedMs = Math.max(0, performance.now() - started)
      report.requestsPerSecond =
        report.completed / Math.max(report.elapsedMs / 1000, 0.001)
      report.averageMs = report.completed ? totalLatency / report.completed : 0
      if (final) {
        latencies.sort((a, b) => a - b)
        report.p50Ms = percentile(latencies, 0.5)
        report.p95Ms = percentile(latencies, 0.95)
        report.p99Ms = percentile(latencies, 0.99)
      }
      return {
        ...report,
        config: { ...config },
        statuses: { ...report.statuses },
        series: report.series.map((point) => ({ ...point })),
      }
    }
    const progressTimer = setInterval(() => {
      try {
        update(snapshot())
      } catch {
        this.stop()
      }
    }, 250)
    if (config.mode === "duration")
      durationTimer = setTimeout(() => {
        this.deadlineReached = true
        this.stop()
      }, config.durationSeconds * 1000)

    const worker = async () => {
      while (
        !this.stopping &&
        report.attempted < LOAD_TEST_LIMITS.attempts &&
        (config.mode === "duration" || report.attempted < config.requests)
      ) {
        const id = ++requestSequence
        report.attempted++
        const attemptStarted = performance.now()
        const result = await this.runAttempt(id, config.timeoutMs)
        if (result.type === "cancelled") {
          report.cancelled++
          continue
        }
        const duration =
          result.type === "response" && Number.isFinite(result.value.durationMs)
            ? Math.max(0, result.value.durationMs)
            : performance.now() - attemptStarted
        const status = result.type === "response" ? result.value.status : 0
        const success = status >= 200 && status < 400
        const statusKey =
          result.type === "timeout"
            ? "timeout"
            : result.type === "error"
              ? "network"
              : result.type === "service-limit"
                ? `workbench-${result.status}`
                : String(status)
        report.completed++
        if (success) report.succeeded++
        else report.failed++
        totalLatency += duration
        latencies.push(duration)
        report.minMs =
          report.completed === 1 ? duration : Math.min(report.minMs, duration)
        report.maxMs = Math.max(report.maxMs, duration)
        report.statuses[statusKey] = (report.statuses[statusKey] ?? 0) + 1
        if (result.type === "response")
          report.bytes += Math.max(0, result.value.bytes || 0)
        const second = Math.floor((performance.now() - started) / 1000)
        let point = report.series.at(-1)
        if (!point || point.second !== second) {
          point = { second, succeeded: 0, failed: 0 }
          report.series.push(point)
        }
        if (success) point.succeeded++
        else point.failed++
      }
    }

    try {
      update(snapshot())
      await Promise.all(
        Array.from({ length: config.concurrency }, () => worker())
      )
      report.state =
        this.stopping && !this.deadlineReached
          ? "stopped"
          : report.attempted >= LOAD_TEST_LIMITS.attempts
            ? "limit"
            : "completed"
    } finally {
      clearInterval(progressTimer)
      if (durationTimer) clearTimeout(durationTimer)
      this.stop()
      // 拦截器取消接口可能异常；最多等待两秒，并在报告中明确标记未确认的取消。
      if (this.cleanup.size) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          Promise.allSettled(this.cleanup),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              report.cleanupIncomplete = true
              resolve()
            }, 2000)
          }),
        ])
        if (timer) clearTimeout(timer)
      }
      report.cleanupIncomplete ||= this.cleanupFailed
      this.active.clear()
      this.cleanup.clear()
      this.running = false
    }
    const final = snapshot(true)
    update(final)
    return final
  }

  private runAttempt(
    id: number,
    timeoutMs: number
  ): Promise<
    | { type: "response"; value: LoadTestAttempt }
    | { type: "error" | "timeout" | "cancelled" }
    | { type: "service-limit"; status: 429 | 503 }
  > {
    return new Promise((resolve) => {
      let settled = false
      let execution: LoadTestExecution | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (
        result: Parameters<typeof resolve>[0],
        cancel = false
      ) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.active.delete(id)
        if (cancel && execution) {
          // 取消失败不让压测悬挂；传输错误仍由原有拦截器诊断。
          const cleanup = Promise.resolve()
            .then(() => execution!.cancel())
            .then(
              () => {},
              () => {
                this.cleanupFailed = true
              }
            )
          this.cleanup.add(cleanup)
          void cleanup.finally(() => this.cleanup.delete(cleanup))
        }
        resolve(result)
      }
      this.active.set(id, () => finish({ type: "cancelled" }, true))
      try {
        execution = this.execute(id, timeoutMs)
        timer = setTimeout(() => finish({ type: "timeout" }, true), timeoutMs)
        execution.response.then(
          (value) => finish({ type: "response", value }),
          (error) => {
            if (error instanceof LoadTestServiceLimitError)
              finish({ type: "service-limit", status: error.status })
            else finish({ type: error instanceof LoadTestTimeoutError ? "timeout" : "error" })
          }
        )
      } catch {
        finish({ type: "error" })
      }
    })
  }
}
