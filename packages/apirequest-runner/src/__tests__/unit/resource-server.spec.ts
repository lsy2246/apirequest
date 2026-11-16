import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import fs from "fs/promises";
import { getResourceContents } from "../../utils/getters";

vi.mock("fs/promises", () => ({ default: { access: vi.fn(), readFile: vi.fn() } }));
vi.mock("axios", async (importOriginal) => {
  const original = await importOriginal<typeof import("axios")>();
  return { ...original, default: { ...original.default, get: vi.fn() } };
});

describe("remote resource server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
  });

  it("requires an explicit server before sending an access token", async () => {
    await expect(
      getResourceContents({
        pathOrId: "collection-id",
        accessToken: "test-token",
        resourceType: "collection",
      })
    ).rejects.toThrow("requires serverUrl");
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("sends the remote request to the configured server", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error("test-server-unavailable"));
    await expect(
      getResourceContents({
        pathOrId: "collection-id",
        accessToken: "test-token",
        serverUrl: "http://127.0.0.1:3170",
        resourceType: "collection",
      })
    ).rejects.toThrow();
    expect(axios.get).toHaveBeenCalledWith(
      "http://127.0.0.1:3170/v1/access-tokens/collection/collection-id",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });
});
