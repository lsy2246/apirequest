import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { getDefaultRESTRequest } from "@apirequest/data";
import { runWorkbenchAutomation } from "../../workbench";
import { reportError } from "../../utils/report";

const run = (endpoint: string) =>
  runWorkbenchAutomation({
    collection: {
      id: "fixture",
      name: "Fixture",
      data: null,
      folders: [],
      requests: [{ ...getDefaultRESTRequest(), name: "Request", endpoint }],
    },
    envs: { selected: [], global: [] },
    config: { executeScripts: false },
  });

describe("actual automation diagnostics", () => {
  it("retains real HTTP error status, response headers, body and measured timing", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(409, {
        "content-type": "application/json",
        "x-reason": "duplicate",
      });
      response.end('{"error":"pet already exists"}');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const port = (server.address() as { port: number }).port;
      const result = JSON.parse(
        JSON.stringify(await run(`http://127.0.0.1:${port}/pet`))
      );
      expect(result.steps[0].response.statusCode).toBe(409);
      expect(result.steps[0].response.headers).toContainEqual({
        key: "x-reason",
        value: "duplicate",
      });
      expect(JSON.parse(result.steps[0].response.body)).toEqual({
        error: "pet already exists",
      });
      expect(result.steps[0].elapsedMs).toBeGreaterThan(0);
      expect(result.steps[0].errorDetails).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("preserves ECONNREFUSED and its cause through JSON serialization without inventing an HTTP response", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = JSON.parse(
      JSON.stringify(await run(`http://127.0.0.1:${port}/pet`))
    );
    const step = result.steps[0];
    expect(step.passed).toBe(false);
    expect(step.response).toBeUndefined();
    expect(step.statusCode).toBeUndefined();
    expect(step.elapsedMs).toBeGreaterThan(0);
    expect(step.errorDetails[0].code).toBe("REQUEST_ERROR");
    expect(step.errorDetails[0].data.code).toBe("ECONNREFUSED");
    expect(step.errorDetails[0].data.message).toContain(`127.0.0.1:${port}`);
  });
  it("serializes non-enumerable Error messages and nested causes without copying Axios request configuration", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
      address: "127.0.0.1",
    });
    const error = Object.assign(new Error("original failure", { cause }), {
      config: { headers: { authorization: "secret" } },
    });
    const serialized = JSON.stringify(reportError(error));
    expect(serialized).toContain("original failure");
    expect(serialized).toContain("ECONNREFUSED");
    expect(serialized).not.toContain("secret");
  });
});
