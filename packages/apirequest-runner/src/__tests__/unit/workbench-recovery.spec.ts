import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { getDefaultRESTRequest } from "@apirequest/data";
import {
  runWorkbenchAutomation,
  type WorkbenchRecovery,
} from "../../workbench";

describe("durable background request recovery", () => {
  it("restarts from the checkpoint without repeating completed requests, including at iteration boundaries", async () => {
    const calls: string[] = [];
    const server = createServer((request, response) => {
      calls.push(request.url!);
      response.writeHead(request.url === "/first" ? 409 : 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ path: request.url }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const request = getDefaultRESTRequest();
    const input = {
      collection: {
        id: "frozen",
        name: "Frozen",
        data: null,
        folders: [],
        requests: ["first", "second"].map((name) => ({
          ...request,
          name,
          endpoint: `http://127.0.0.1:${port}/${name}`,
        })),
      },
      envs: { selected: [], global: [] },
      config: { iterations: 2, executeScripts: false },
    };
    let checkpoint!: WorkbenchRecovery;
    try {
      await expect(
        runWorkbenchAutomation(input, async (progress) => {
          if (progress.completed === 1 && !progress.recovery?.inFlight) {
            checkpoint = JSON.parse(JSON.stringify(progress.recovery));
            throw new Error("simulate process loss");
          }
        })
      ).rejects.toThrow("simulate process loss");
      expect(calls).toEqual(["/first"]);
      expect(checkpoint.results[0].response?.statusCode).toBe(409);
      let secondCheckpoint!: WorkbenchRecovery;
      await expect(
        runWorkbenchAutomation(
          { ...checkpoint.input, recovery: checkpoint },
          async (progress) => {
            if (progress.completed === 2 && !progress.recovery?.inFlight) {
              secondCheckpoint = JSON.parse(JSON.stringify(progress.recovery));
              throw new Error("second process loss");
            }
          }
        )
      ).rejects.toThrow("second process loss");
      const final = await runWorkbenchAutomation({
        ...secondCheckpoint.input,
        recovery: secondCheckpoint,
      });
      expect(calls).toEqual(["/first", "/second", "/first", "/second"]);
      expect(final.steps.map((step) => step.iteration)).toEqual([1, 1, 2, 2]);
      expect(final.steps).toHaveLength(4);
      expect(final.summary.failed).toBe(2);
      expect(final.steps[0].response?.body).toContain("/first");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("saves an in-flight marker before dispatch and preserves updated variables in the checkpoint", async () => {
    const calls: string[] = [];
    const server = createServer((request, response) => {
      calls.push(request.url!);
      response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    let marker: WorkbenchRecovery | undefined;
    try {
      await expect(
        runWorkbenchAutomation(
          {
            collection: {
              id: "test",
              name: "Test",
              data: null,
              folders: [],
              requests: [
                {
                  ...getDefaultRESTRequest(),
                  name: "Unknown",
                  endpoint: `http://127.0.0.1:${port}/<<token>>`,
                },
              ],
            },
            envs: {
              selected: [
                {
                  key: "token",
                  initialValue: "",
                  currentValue: "saved-token",
                  secret: false,
                },
              ],
              global: [],
            },
            config: { executeScripts: false },
          },
          (progress) => {
            if (progress.recovery?.inFlight) {
              marker = progress.recovery;
              throw new Error("before dispatch");
            }
          }
        )
      ).rejects.toThrow("before dispatch");
      expect(calls).toHaveLength(0);
      expect(marker?.inFlight).toEqual({ name: "Unknown", iteration: 1 });
      const report = await runWorkbenchAutomation({
        ...marker!.input,
        recovery: marker,
      });
      expect(calls).toEqual(["/saved-token"]);
      expect(report.steps).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

it("restores a variable written by the previous request's script", async () => {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(request.url!);
    response.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const request = getDefaultRESTRequest();
  let checkpoint!: WorkbenchRecovery;
  try {
    const input = {
      collection: {
        id: "state",
        name: "State",
        data: null,
        folders: [],
        requests: [
          {
            ...request,
            name: "Set token",
            endpoint: `http://127.0.0.1:${port}/first`,
            testScript: 'hopp.env.set("token", "restored")',
          },
          {
            ...request,
            name: "Use token",
            endpoint: `http://127.0.0.1:${port}/<<token>>`,
          },
        ],
      },
      envs: {
        selected: [
          {
            key: "token",
            initialValue: "",
            currentValue: "initial",
            secret: false,
          },
        ],
        global: [],
      },
      config: { keepVariableValues: true },
    };
    await expect(
      runWorkbenchAutomation(input, (progress) => {
        if (progress.completed === 1 && !progress.recovery?.inFlight) {
          checkpoint = progress.recovery!;
          throw new Error("lost process");
        }
      })
    ).rejects.toThrow("lost process");
    expect(checkpoint.results[0].errors).toEqual([]);
    expect(checkpoint.envs.selected[0].currentValue).toBe("restored");
    const final = await runWorkbenchAutomation({
      ...checkpoint.input,
      recovery: checkpoint,
    });
    expect(calls).toEqual(["/first", "/restored"]);
    expect(final.steps).toHaveLength(2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
