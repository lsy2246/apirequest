import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LoadTestRunner,
  LoadTestServiceLimitError,
  LoadTestTimeoutError,
  validateLoadTestConfig,
  type LoadTestConfig,
  type LoadTestAttempt,
} from "../runner"

const config: LoadTestConfig = {
  mode: "requests",
  concurrency: 3,
  requests: 7,
  durationSeconds: 1,
  timeoutMs: 100,
}
const response = (status = 200, durationMs = 10): LoadTestAttempt => ({
  status,
  durationMs,
  bytes: 5,
})

describe("工作台压测执行器", () => {
  it("separates workbench limits from a target returning 429", async () => {
    let index = 0
    const steps = [
      () => Promise.reject(new LoadTestServiceLimitError(429)),
      () => Promise.reject(new LoadTestServiceLimitError(503)),
      () => Promise.resolve(response(429)),
    ]
    const runner = new LoadTestRunner(() => ({
      response: steps[index++](),
      cancel: () => {},
    }))
    const pending = runner.run({ ...config, requests: 3 })
    await vi.runAllTimersAsync()
    expect((await pending).statuses).toEqual({
      "429": 1,
      "workbench-429": 1,
      "workbench-503": 1,
    })
  })

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("并发不超过配置，精确执行请求预算，并汇总状态和延迟分位数", async () => {
    let active = 0
    let maximum = 0
    let index = 0
    const ids: number[] = []
    const runner = new LoadTestRunner((id) => {
      const current = index++
      ids.push(id)
      maximum = Math.max(maximum, ++active)
      return {
        response: new Promise((resolve) =>
          setTimeout(() => {
            active--
            resolve(response(current === 3 ? 500 : 200, (current + 1) * 10))
          }, 10)
        ),
        cancel: () => {
          throw new Error("已经完成的请求不应再取消")
        },
      }
    })
    const pending = runner.run(config)
    expect(active).toBe(3)
    await vi.runAllTimersAsync()
    const report = await pending
    expect(maximum).toBe(3)
    expect(new Set(ids).size).toBe(7)
    expect(report).toMatchObject({
      state: "completed",
      attempted: 7,
      completed: 7,
      succeeded: 6,
      failed: 1,
      cancelled: 0,
      bytes: 35,
      averageMs: 40,
      p50Ms: 40,
      p95Ms: 70,
      p99Ms: 70,
      statuses: { "200": 6, "500": 1 },
    })
  })

  it("停止取消所有在途请求，即使响应 Promise 不兑现也可完成", async () => {
    const cancel = vi.fn()
    const runner = new LoadTestRunner(() => ({
      response: new Promise(() => {}),
      cancel,
    }))
    const pending = runner.run(config)
    runner.stop()
    const report = await pending
    expect(cancel).toHaveBeenCalledTimes(3)
    expect(report).toMatchObject({
      state: "stopped",
      attempted: 3,
      completed: 0,
      cancelled: 3,
      cleanupIncomplete: false,
    })
  })

  it("超时调用传输取消且计为失败，网络错误独立计数", async () => {
    const cancel = vi.fn()
    let index = 0
    const runner = new LoadTestRunner(() => ({
      response:
        index++ === 0
          ? Promise.reject(new Error("断网"))
          : new Promise(() => {}),
      cancel,
    }))
    const pending = runner.run({ ...config, requests: 2, concurrency: 2 })
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({
      completed: 2,
      failed: 2,
      statuses: { network: 1, timeout: 1 },
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("持续时长截止取消在途请求，结束定时器和进度回调", async () => {
    const cancel = vi.fn()
    const runner = new LoadTestRunner(() => ({
      response: new Promise(() => {}),
      cancel,
    }))
    const pending = runner.run({
      ...config,
      mode: "duration",
      timeoutMs: 10000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({ state: "completed", cancelled: 3 })
    expect(cancel).toHaveBeenCalledTimes(3)
  })

  it("取消接口不响应时有限等待，并标记清理尚未确认", async () => {
    const runner = new LoadTestRunner(() => ({
      response: new Promise(() => {}),
      cancel: () => new Promise(() => {}),
    }))
    const pending = runner.run(config)
    runner.stop()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toMatchObject({
      state: "stopped",
      cleanupIncomplete: true,
    })
  })

  it("传输层提前报超时仍归类为超时，而非网络错误", async () => {
    const runner = new LoadTestRunner(() => ({
      response: Promise.reject(new LoadTestTimeoutError()),
      cancel: () => {},
    }))
    expect(await runner.run({ ...config, requests: 1 })).toMatchObject({
      failed: 1,
      statuses: { timeout: 1 },
    })
  })

  it("同一执行器不能重入，完成后可再次运行且请求 ID 不重复", async () => {
    const ids = new Set<number>()
    const runner = new LoadTestRunner((id) => {
      expect(ids.has(id)).toBe(false)
      ids.add(id)
      return { response: Promise.resolve(response()), cancel: () => {} }
    })
    const first = runner.run(config)
    await expect(runner.run(config)).rejects.toThrow("already running")
    await first
    await runner.run(config)
    expect(ids.size).toBe(14)
  })

  it.each([
    { concurrency: 0 },
    { concurrency: 33 },
    { requests: 10001 },
    { durationSeconds: 301 },
    { timeoutMs: NaN },
    { requests: 1.5 },
  ])("拒绝无效配置 %j", (invalid) => {
    expect(() => validateLoadTestConfig({ ...config, ...invalid })).toThrow()
  })
})
