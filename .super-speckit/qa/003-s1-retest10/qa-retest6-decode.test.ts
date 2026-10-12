/**
 * QA003-retest6 probe: can a malformed percent-escape in an MCP endpoint reach
 * the export path loop and turn into a 500?
 *
 * The commit comment claims "a malformed percent-escape is treated as a literal
 * segment and left for the detectors" — but decodeURIComponent("%ZZ") throws
 * URIError, and the export loop has no try/catch around it. Whether that becomes
 * a 500 depends on whether an endpoint containing "%ZZ" can be persisted, i.e.
 * whether McpRemoteEndpointSchema rejects it first.
 *
 * Throwaway checker artifact.
 */
import { McpRemoteEndpointSchema } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";

describe("malformed percent-escape reachability in an MCP endpoint", () => {
  it("records whether McpRemoteEndpointSchema accepts an endpoint containing %ZZ", () => {
    const cases = [
      "https://mcp.example.com/t/%ZZ",
      "https://mcp.example.com/t/%E0%A4%A",
      "https://mcp.example.com/t/%",
      "https://mcp.example.com/t/ok",
    ];
    for (const endpoint of cases) {
      const parsed = McpRemoteEndpointSchema.safeParse(endpoint);
      console.error(
        `SCHEMA ${parsed.success ? "ACCEPTS" : "REJECTS"} ${endpoint}` +
          (parsed.success ? "" : ` -> ${parsed.error.issues[0]?.message}`),
      );
    }
    // The assertion that matters: if any malformed-escape endpoint is accepted by
    // the schema, it can be persisted and will reach decodeURIComponent in export.
    const accepted = cases.filter((c) => McpRemoteEndpointSchema.safeParse(c).success);
    expect(accepted).toEqual([]);
  });
});
