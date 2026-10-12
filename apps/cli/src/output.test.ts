import { describe, expect, it } from "vitest";
import { emit, exitCodeFor, type CliError } from "./output.js";

/** Captures what emit() would write, without touching real stdio. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    streams: {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => err.push(line),
    },
  };
}

describe("emit", () => {
  it("writes the success envelope to stdout in json mode", () => {
    const c = capture();
    emit({ ok: true, data: { reply: "hello" } }, { json: true, ...c.streams });
    expect(JSON.parse(c.out[0]!)).toEqual({ ok: true, data: { reply: "hello" } });
    expect(c.err).toEqual([]);
  });

  it("writes human-readable text to stdout in text mode", () => {
    const c = capture();
    emit({ ok: true, data: { reply: "hello" } }, { json: false, text: "hello", ...c.streams });
    expect(c.out).toEqual(["hello"]);
  });

  it("writes the error envelope to stdout (not stderr) in json mode", () => {
    const c = capture();
    const error: CliError = { code: "DEVICE_OFFLINE", message: "offline", retryable: true };
    emit({ ok: false, error }, { json: true, ...c.streams });
    expect(JSON.parse(c.out[0]!)).toEqual({
      ok: false,
      error: { code: "DEVICE_OFFLINE", message: "offline", retryable: true },
    });
  });

  it("writes the error message to stderr in text mode", () => {
    const c = capture();
    emit(
      { ok: false, error: { code: "AUTH_FAILED", message: "bad token", retryable: false } },
      { json: false, ...c.streams },
    );
    expect(c.out).toEqual([]);
    expect(c.err).toEqual(["Error: bad token"]);
  });

  it("never includes a token value in any emitted line", () => {
    const c = capture();
    const secret = "super-secret-token-value";
    emit(
      {
        ok: false,
        error: { code: "GENERAL", message: `request failed with ${secret}`, retryable: false },
      },
      { json: true, redact: [secret], ...c.streams },
    );
    expect(c.out.join("")).not.toContain(secret);
  });
});

describe("exitCodeFor", () => {
  it("maps error codes to the documented exit codes", () => {
    expect(exitCodeFor(undefined)).toBe(0);
    expect(exitCodeFor({ code: "GENERAL", message: "", retryable: false })).toBe(1);
    expect(exitCodeFor({ code: "USAGE", message: "", retryable: false })).toBe(2);
    expect(exitCodeFor({ code: "AUTH_FAILED", message: "", retryable: false })).toBe(3);
    expect(exitCodeFor({ code: "TIMEOUT", message: "", retryable: true })).toBe(6);
    expect(exitCodeFor({ code: "UNREACHABLE", message: "", retryable: true })).toBe(1);
  });
});
