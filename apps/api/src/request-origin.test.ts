import { describe, expect, it } from "vitest";
import { rpcRequestOrigin } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv({
  DATABASE_URL: "postgres://rakazo:rakazo@127.0.0.1:5433/rakazo",
  NODE_ENV: "test",
  WEB_ORIGIN: "http://192.168.1.199:5174",
  RAKAZO_EXTRA_ORIGINS: "https://aidex.tk9.dev",
});

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://192.168.1.199:5174/rpc/computer.screenUrl", { headers });
}

describe("rpcRequestOrigin", () => {
  it("prefers a trusted origin header", () => {
    expect(rpcRequestOrigin(requestWith({ origin: "https://aidex.tk9.dev" }), env)).toBe(
      "https://aidex.tk9.dev",
    );
  });

  it("rebuilds the origin from host and forwarded proto when origin is missing", () => {
    expect(
      rpcRequestOrigin(requestWith({ host: "aidex.tk9.dev", "x-forwarded-proto": "https" }), env),
    ).toBe("https://aidex.tk9.dev");
    expect(
      rpcRequestOrigin(
        requestWith({ host: "aidex.tk9.dev", "x-forwarded-proto": "https,http" }),
        env,
      ),
    ).toBe("https://aidex.tk9.dev");
  });

  it("defaults to plain http for a host header without forwarded proto", () => {
    expect(rpcRequestOrigin(requestWith({ host: "192.168.1.199:5174" }), env)).toBe(
      "http://192.168.1.199:5174",
    );
  });

  it("returns nothing for untrusted origins so callers fall back to webOrigin", () => {
    expect(
      rpcRequestOrigin(requestWith({ origin: "https://evil.example.com" }), env),
    ).toBeUndefined();
    expect(rpcRequestOrigin(requestWith({ host: "evil.example.com" }), env)).toBeUndefined();
  });

  it("skips non-http(s) trusted schemes and tries the host candidate instead", () => {
    expect(
      rpcRequestOrigin(
        requestWith({
          origin: "rakazo://app",
          host: "aidex.tk9.dev",
          "x-forwarded-proto": "https",
        }),
        env,
      ),
    ).toBe("https://aidex.tk9.dev");
  });

  it("returns nothing when no candidate exists", () => {
    expect(rpcRequestOrigin(requestWith({}), env)).toBeUndefined();
  });
});
