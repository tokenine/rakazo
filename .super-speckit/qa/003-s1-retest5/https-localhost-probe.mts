/**
 * Throwaway probe: is an `https://localhost` bundle endpoint actually reachable at
 * the runtime sink, or blocked by assertSafeRemoteUrl before any socket opens?
 *
 * The schema guard added in 466a8bcf only applies isLocalMcpHost() to `http:`
 * endpoints, so `https://localhost/mcp` passes schema validation. This decides
 * whether that is live SSRF or defence-in-depth with no reach. The resolver is
 * injected, so nothing is contacted either way.
 */
import { assertSafeRemoteUrl } from "../packages/adapters/src/remote-mcp.js";

const PUBLIC = [{ address: "93.184.216.34", family: 4 as const }];

async function main() {
  const cases = [
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://[::1]/mcp",
    "https://169.254.169.254/latest/meta-data",
    "http://localhost:3000/mcp",
    "https://example.com/mcp",
  ];
  for (const url of cases) {
    try {
      await assertSafeRemoteUrl(url, async () => PUBLIC);
      console.log(`ALLOWED  ${url}`);
    } catch (error) {
      console.log(`BLOCKED  ${url}  -> ${(error as Error).message}`);
    }
  }
}

void main();
