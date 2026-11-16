import { describe, expect, it, vi } from "vitest";
import { RESTReqSchemaVersion } from "@apirequest/data";
import { collectionsRunner } from "../../utils/collections";
vi.mock("../../utils/collections", () => ({
  collectionsRunner: vi.fn(async () => []),
}));

import { runWorkbenchAutomation } from "../../workbench";

describe("runWorkbenchAutomation", () => {
  it("disables scripts at every collection and request level without mutating the saved tree", async () => {
    const request = {
      v: RESTReqSchemaVersion,
      name: "fixture",
      endpoint: "https://example.com",
      method: "GET",
      params: [],
      headers: [],
      auth: { authType: "none", authActive: true },
      body: { contentType: null, body: null },
      requestVariables: [],
      responses: {},
      description: null,
      preRequestScript: "request-before",
      testScript: "request-after",
    };
    const leaf = {
      id: "child",
      name: "child",
      data: JSON.stringify({
        preRequestScript: "child-before",
        testScript: "child-after",
      }),
      requests: [request],
      folders: [],
    };
    const tree = { ...leaf, id: "root", folders: [leaf] };
    await runWorkbenchAutomation({
      collection: tree,
      envs: { selected: [], global: [] },
      config: { executeScripts: false },
    });
    const root = vi.mocked(collectionsRunner).mock.calls.at(-1)![0]
      .collections[0];
    for (const collection of [root, root.folders[0]]) {
      expect(collection.preRequestScript).toBe("");
      expect(collection.testScript).toBe("");
      expect(collection.requests[0].preRequestScript).toBe("");
      expect(collection.requests[0].testScript).toBe("");
    }
    expect(tree.requests[0].testScript).toBe("request-after");
    await runWorkbenchAutomation({
      collection: tree,
      envs: { selected: [], global: [] },
      config: {},
    });
    expect(
      vi.mocked(collectionsRunner).mock.calls.at(-1)![0].collections[0]
        .testScript
    ).toBe("child-after");
  });
  it("rejects malformed saved requests before issuing any HTTP request", async () => {
    // 无效的保存记录曾被转换为默认示例请求，后台应直接报告配置错误。
    await expect(
      runWorkbenchAutomation({
        collection: {
          id: "collection",
          name: "fixture",
          data: null,
          requests: [{ v: "17", name: "invalid" }],
          folders: [],
        },
        envs: { selected: [], global: [] },
        config: {},
      })
    ).rejects.toThrow("invalid_request");
  });
  it("uses assertions for expected HTTP failures and HTTP status when no assertions exist", async () => {
    const base = {
      path: "fixture",
      result: true,
      errors: [],
      duration: { request: 0.01, test: 0, preRequest: 0 },
      response: {
        statusCode: 404,
        statusText: "Not Found",
        headers: [],
        body: "",
      },
    };
    vi.mocked(collectionsRunner).mockResolvedValueOnce([
      {
        ...base,
        tests: [
          {
            descriptor: "expected 404",
            passed: 1,
            failed: 0,
            expectResults: [{ status: "pass", message: "expected 404" }],
          },
        ],
      },
      { ...base, tests: [] },
    ] as any);
    const report = await runWorkbenchAutomation({
      collection: {
        id: "fixture",
        name: "Fixture",
        data: null,
        requests: [],
        folders: [],
      },
      envs: { selected: [], global: [] },
      config: {},
    });
    expect(report.summary.failed).toBe(1);
    expect(report.steps.map((step) => step.passed)).toEqual([true, false]);
  });
});
