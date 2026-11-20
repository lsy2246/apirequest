import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  getDefaultRESTRequest,
  newRequestCase,
  type RequestCase,
} from "@apirequest/data";
import { runWorkbenchAutomation } from "../../workbench";

let server: Server;
let endpoint: string;
const cancelled: string[] = [];
const received: Record<string, unknown>[] = [];
beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const snapshot = {
      authorization: request.headers.authorization ?? null,
      marker: request.headers["x-case"] ?? null,
      inherited: request.headers["x-inherited"] ?? null,
      body,
    };
    received.push(snapshot);
    if (request.url?.startsWith("/slow")) {
      const timer = setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(snapshot));
      }, 1500);
      response.once("close", () => {
        if (!response.writableEnded) cancelled.push(request.url!);
        clearTimeout(timer);
      });
      return;
    }
    response.writeHead(request.headers.authorization ? 200 : 401, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(snapshot));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/chat`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});
function input(cases: RequestCase[], config: Record<string, unknown> = {}) {
  return {
    collection: {
      id: "root",
      name: "Fixture",
      data: JSON.stringify({
        headers: [
          {
            key: "X-Inherited",
            value: "parent",
            active: true,
            description: "",
          },
        ],
      }),
      folders: [],
      requests: [
        {
          ...getDefaultRESTRequest(),
          id: "source",
          name: "Chat",
          endpoint,
          auth: { authType: "bearer", authActive: true, token: "valid" },
        },
      ],
    },
    envs: { selected: [], global: [] },
    config: { requestCases: { source: cases }, ...config },
  };
}
describe("saved cases through the background HTTP runner", () => {
  it("cancels a timed-out request, records its limit and continues to the next case", async () => {
    received.length = 0;
    cancelled.length = 0;
    const slow = {
      ...newRequestCase(),
      id: "slow",
      name: "Slow case",
      timeoutMs: 500,
    };
    slow.overrides.endpoint = endpoint.replace("/chat", "/slow-main");
    const next = { ...newRequestCase(), id: "next", name: "Next case" };
    const result = await runWorkbenchAutomation(input([slow, next]));
    expect(result.steps.map((step) => step.passed)).toEqual([false, true]);
    expect(result.steps[0].errorDetails[0]).toMatchObject({
      code: "CASE_TIMEOUT",
      data: { timeoutMs: 500, elapsedMs: expect.any(Number) },
    });
    await vi.waitFor(() => expect(cancelled).toContain("/slow-main"));
    expect(result.steps[1].statusCode).toBe(200);
  });

  it("includes setup and post-script fetches in the individual case deadline", async () => {
    for (const phase of ["preRequestScript", "testScript"] as const) {
      cancelled.length = 0;
      const entry = {
        ...newRequestCase(),
        id: phase,
        name: phase,
        scripts: "custom" as const,
        timeoutMs: 500,
      };
      entry[phase] =
        `await hopp.fetch(${JSON.stringify(endpoint.replace("/chat", "/slow-"))} + ${JSON.stringify(phase)})`;
      const result = await runWorkbenchAutomation(input([entry]));
      expect(result.steps[0].errorDetails[0]).toMatchObject({
        code: "CASE_TIMEOUT",
        data: { timeoutMs: 500 },
      });
      await vi.waitFor(() => expect(cancelled).toContain("/slow-" + phase));
    }
  });

  it("runs selected cases from multiple folders and skips requests without cases", async () => {
    const first = { ...newRequestCase(), id: "first-case", name: "First case" };
    const second = {
      ...newRequestCase(),
      id: "other-case",
      name: "Other case",
    };
    const data = input([first]);
    const original = data.collection.requests[0];
    const result = await runWorkbenchAutomation({
      ...data,
      collection: {
        ...data.collection,
        requests: [{ ...original, id: "empty", name: "No cases" }],
        folders: [
          {
            id: "one",
            name: "One",
            data: null,
            folders: [],
            requests: [original],
          },
          {
            id: "two",
            name: "Two",
            data: null,
            folders: [],
            requests: [{ ...original, id: "other", name: "Other request" }],
          },
        ],
      },
      config: {
        requestCases: { source: [first], other: [second] },
        selectedRequestIDs: ["source", "other", "empty"],
        casesOnly: true,
      },
    });
    expect(result.steps.map((step) => step.requestName)).toEqual([
      "Chat · First case",
      "Other request · Other case",
    ]);
    expect(result.summary).toMatchObject({ completed: 2, failed: 0 });
  });

  it("sends each case's headers, honors header removals and records expected HTTP errors as passing cases", async () => {
    received.length = 0;
    const valid = {
      ...newRequestCase(),
      id: "valid",
      name: "Valid token",
      scripts: "custom" as const,
    };
    valid.overrides.headers = [
      { key: "X-Case", value: "first", remove: false },
    ];
    valid.testScript =
      'hopp.test("custom script", () => hopp.expect(hopp.response.statusCode).toBe(200))';
    const missing = {
      ...newRequestCase(),
      id: "missing",
      name: "Missing token",
    };
    missing.overrides.headers = [
      { key: "Authorization", value: "", remove: true },
      { key: "X-Inherited", value: "", remove: true },
    ];
    missing.assertions[0].expected = "401";
    const progress: unknown[] = [];
    const result = await runWorkbenchAutomation(
      input([valid, missing]),
      (value) => {
        progress.push(structuredClone(value));
      }
    );
    expect(result.summary).toMatchObject({ completed: 2, failed: 0 });
    expect(result.automation).toMatchObject({ passedTests: 3, failedTests: 0 });
    expect(received).toEqual([
      {
        authorization: "Bearer valid",
        marker: "first",
        inherited: "parent",
        body: "",
      },
      { authorization: null, marker: null, inherited: null, body: "" },
    ]);
    expect(
      result.steps.map((step) => [
        step.requestName,
        step.passed,
        step.statusCode,
      ])
    ).toEqual([
      ["Chat · Valid token", true, 200],
      ["Chat · Missing token", true, 401],
    ]);
    expect(result.steps[1].assertions[0].expectResults[0].message).toContain(
      "actual: 401"
    );
    expect(progress.length).toBeGreaterThan(2);
  });

  it("respects selection, script disabling and per-case environments without leaking values to another case", async () => {
    received.length = 0;
    const first = {
      ...newRequestCase(),
      id: "first",
      name: "Environment",
      environmentID: "case-env",
      scripts: "custom" as const,
    };
    first.overrides.headers = [
      { key: "X-Case", value: "<<marker>>", remove: false },
    ];
    first.testScript = 'throw new Error("must not execute")';
    const second = { ...newRequestCase(), id: "second", name: "Skipped" };
    const data = {
      ...input([first, second], {
        selectedCaseIDs: [first.id],
        executeScripts: false,
        iterations: 2,
        persistResponses: false,
      }),
      caseEnvironments: {
        "case-env": [
          {
            key: "marker",
            initialValue: "selected-env",
            currentValue: "selected-env",
            secret: false as const,
          },
        ],
      },
    };
    const result = await runWorkbenchAutomation(data);
    expect(result.summary).toMatchObject({ completed: 2, failed: 0 });
    expect(received.map((request) => request.marker)).toEqual([
      "selected-env",
      "selected-env",
    ]);
    expect(
      result.steps.every(
        (step) => step.responseOmitted && !step.response && step.passed
      )
    ).toBe(true);
  });

  it("reports assertion failures and does not send a request when its pre-request script fails", async () => {
    received.length = 0;
    const broken = {
      ...newRequestCase(),
      id: "broken",
      name: "Broken script",
      scripts: "custom" as const,
      preRequestScript: 'throw new Error("setup failed")',
    };
    const wrong = {
      ...newRequestCase(),
      id: "wrong",
      name: "Wrong expectation",
    };
    wrong.assertions[0].expected = "201";
    const result = await runWorkbenchAutomation(input([broken, wrong]));
    expect(result.summary).toMatchObject({ completed: 2, failed: 2 });
    expect(received).toHaveLength(1);
    expect(result.steps[0].errors.length).toBeGreaterThan(0);
    expect(
      result.steps[1].assertions.at(-1)?.expectResults[0].message
    ).toContain("expected: 201, actual: 200");
  });
});
