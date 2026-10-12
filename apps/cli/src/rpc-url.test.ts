import { describe, expect, it } from "vitest";
import { createClient } from "./client.js";

/** The server's oRPC handler only routes path-style URLs: /rpc/threads/send. */
describe("rpc url shape", () => {
  it("posts each method to its encoded path under the base url", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: [] }),
      };
    }) as unknown as typeof globalThis.fetch;

    const client = createClient({ baseUrl: "http://127.0.0.1:3100/rpc", spaceId: "s", fetch: fetchImpl });
    await client.listSessions("bot_1");

    expect(urls).toEqual(["http://127.0.0.1:3100/rpc/threads/listSessions"]);
  });

  it("encodes special characters in path segments", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: [] }),
      };
    }) as unknown as typeof globalThis.fetch;

    const client = createClient({ baseUrl: "http://127.0.0.1:3100/rpc/", spaceId: "s", fetch: fetchImpl });
    await client.listMcpAssignments("bot_1");

    expect(urls).toEqual(["http://127.0.0.1:3100/rpc/mcp/assignments/list"]);
  });
});
