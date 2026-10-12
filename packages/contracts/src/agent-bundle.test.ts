import { describe, expect, it } from "vitest";
import { AgentBundleMcpServerSchema } from "./agent-bundle.js";

// BUG-003-S1-06: the loopback guard used to live only in the http: branch, so
// loopback/private HTTPS endpoints parsed and persisted, deferring the refusal
// to a confusing per-run connector error. The schema is the boundary that must
// hold even if the connect-time sink is ever relaxed.
describe("AgentBundleMcpServerSchema.endpoint", () => {
  const makeServer = (endpoint: string) =>
    AgentBundleMcpServerSchema.safeParse({
      slug: "test",
      name: "Test",
      description: "",
      transport: "streamable_http",
      endpoint,
    });

  it("accepts a public HTTPS endpoint", () => {
    expect(makeServer("https://example.com/mcp").success).toBe(true);
  });

  it("rejects loopback HTTPS endpoints", () => {
    expect(makeServer("https://localhost/mcp").success).toBe(false);
    expect(makeServer("https://127.0.0.1/mcp").success).toBe(false);
    expect(makeServer("https://[::1]/mcp").success).toBe(false);
  });

  it("rejects private-range HTTPS endpoints", () => {
    expect(makeServer("https://10.1.2.3/mcp").success).toBe(false);
    expect(makeServer("https://192.168.0.5/mcp").success).toBe(false);
    expect(makeServer("https://172.16.1.1/mcp").success).toBe(false);
  });

  it("rejects link-local and metadata HTTPS endpoints", () => {
    expect(makeServer("https://169.254.169.254/latest/meta-data").success).toBe(false);
    expect(makeServer("https://metadata.google.internal/mcp").success).toBe(false);
  });

  it("rejects every HTTP endpoint — bundles must be HTTPS", () => {
    expect(makeServer("http://example.com/mcp").success).toBe(false);
  });
});
