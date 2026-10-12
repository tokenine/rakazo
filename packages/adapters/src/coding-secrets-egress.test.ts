import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SecretEgressFilter,
  secretEgressVariants,
  sweepSurfacesForSecretEgress,
} from "./coding-secrets-egress.js";
import { LocalAgentHomeStore } from "./home.js";

/**
 * 004-code-mode S3 (T17, V8) — the single deny-list egress filter.
 *
 * Literal + base64/base64url + hex + URL(percent) transforms of granted
 * values, applied across artifact surfaces. The variant computation in these
 * tests is an INDEPENDENT oracle (node Buffer transforms written out here),
 * not a re-export of the implementation, so a broken transform cannot hide
 * behind itself.
 *
 * V8's "green only with a planted secret": every sweep below runs against a
 * PLANTED unique value AND includes a control asserting the sweep detects
 * the planted value in an unfiltered surface — so a subsystem that stopped
 * planting/filtering could not pass vacuously.
 */

const PLANTED = "ghp_e2e0a7c1plantedsecret99";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function oracleVariants(value: string): string[] {
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return [
    value,
    b64,
    b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    Buffer.from(value, "utf8").toString("hex"),
    Buffer.from(value, "utf8").toString("hex").toUpperCase(),
    encodeURIComponent(value),
  ];
}

describe("egress filter transforms (T17)", () => {
  it("computes the documented transform set for a granted value", () => {
    const variants = secretEgressVariants(PLANTED);
    for (const expected of oracleVariants(PLANTED)) {
      expect(variants).toContain(expected);
    }
  });

  it("filters literal and encoded forms from text, keeping everything else intact", () => {
    const filter = new SecretEgressFilter([PLANTED]);
    const text = [
      `token is ${PLANTED} inline`,
      `b64: ${Buffer.from(PLANTED).toString("base64")}`,
      `hex: ${Buffer.from(PLANTED).toString("hex")}`,
      `pct: ${encodeURIComponent(PLANTED)}`,
      "clean line stays",
    ].join("\n");
    const filtered = filter.filter(text);
    for (const variant of oracleVariants(PLANTED)) {
      expect(filtered).not.toContain(variant);
    }
    expect(filtered).toContain("clean line stays");
    expect(filtered.match(/\[redacted\]/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("filters base64url and uppercase-hex forms too", () => {
    const filter = new SecretEgressFilter([PLANTED]);
    const b64url = Buffer.from(PLANTED)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const filtered = filter.filter(
      `x ${b64url} y ${Buffer.from(PLANTED).toString("hex").toUpperCase()} z`,
    );
    expect(filtered).not.toContain(b64url);
    expect(filtered).not.toContain(Buffer.from(PLANTED).toString("hex").toUpperCase());
  });

  it("redacts command results (the transform-aware replacement for literal-only)", () => {
    const filter = new SecretEgressFilter([PLANTED]);
    const result = filter.filterCommandResult({
      stdout: `out ${PLANTED} ${Buffer.from(PLANTED).toString("base64")}`,
      stderr: `err ${Buffer.from(PLANTED).toString("hex")}`,
      code: 0,
    });
    for (const variant of oracleVariants(PLANTED)) {
      expect(result.stdout).not.toContain(variant);
      expect(result.stderr).not.toContain(variant);
    }
    expect(result.code).toBe(0);
  });

  it("sweep detects the planted value in an UNFILTERED surface (V8 control: green requires the plant)", () => {
    const sweep = sweepSurfacesForSecretEgress([PLANTED], {
      raw: `transcript with ${PLANTED} plainly`,
    });
    expect(sweep.clean).toBe(false);
    expect(sweep.hits[0]!.surface).toBe("raw");
    expect(sweep.hits[0]!.variant).toBe("literal");
  });

  it("sweep over all artifact surfaces comes back clean after filtering (V8)", () => {
    const filter = new SecretEgressFilter([PLANTED]);
    const surfaces = {
      prompt: filter.filter(`credentials are provided as env vars; never print ${PLANTED}`),
      transcript: filter.filter(
        `agent said: the token is ${Buffer.from(PLANTED).toString("base64")}`,
      ),
      commandResult: filter.filter(`stdout ${Buffer.from(PLANTED).toString("hex")}`),
      handoffSummary: filter.filter(`handoff notes mention ${encodeURIComponent(PLANTED)}`),
      qaEvidence: filter.filter(`evidence log ${PLANTED}`),
    };
    const sweep = sweepSurfacesForSecretEgress([PLANTED], surfaces);
    expect(sweep.clean).toBe(true);
    expect(sweep.hits).toEqual([]);
  });

  it("ignores empty values and refuses to filter when no values are registered (no-op, not false confidence)", () => {
    const filter = new SecretEgressFilter(["", PLANTED]);
    expect(filter.filter(`still ${PLANTED}`)).not.toContain(PLANTED);
    const empty = new SecretEgressFilter([]);
    expect(empty.filter(`untouched ${PLANTED}`)).toContain(PLANTED);
  });
});

describe("checkpoint egress (T17: checkpoints surface)", () => {
  it("control: a checkpoint revision of an unfiltered workspace CONTAINS the planted value (proves the sweep works on revisions)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-s3-home-control-"));
    dirs.push(root);
    const store = new LocalAgentHomeStore(root);
    const staging = await mkdtemp(path.join(tmpdir(), "rakazo-s3-staging-"));
    dirs.push(staging);
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, ".env"), `GITHUB_TOKEN=${PLANTED}\n`, "utf8");
    const revision = await store.commit("bot-1", staging, {
      operationId: "op",
      traceId: "op",
      spaceId: "s",
      userId: "u",
      signal: new AbortController().signal,
    } as never);
    const restoredDir = await mkdtemp(path.join(tmpdir(), "rakazo-s3-restore-"));
    dirs.push(restoredDir);
    await store.restore("bot-1", revision, restoredDir, undefined as never);
    const content = await readFile(path.join(restoredDir, ".env"), "utf8");
    // Control: the sweep MUST find the planted value in an unfiltered
    // revision — otherwise this surface could pass vacuously.
    expect(sweepSurfacesForSecretEgress([PLANTED], { revision: content }).clean).toBe(false);
  });

  it("a checkpoint commit with the egress filter stores NO variant of the granted value", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-s3-home-"));
    dirs.push(root);
    const store = new LocalAgentHomeStore(root, {
      egressFilter: new SecretEgressFilter([PLANTED]),
    });
    const staging = await mkdtemp(path.join(tmpdir(), "rakazo-s3-staging-"));
    dirs.push(staging);
    await mkdir(staging, { recursive: true });
    await writeFile(
      path.join(staging, ".env"),
      `GITHUB_TOKEN=${PLANTED}\nB64=${Buffer.from(PLANTED).toString("base64")}\n`,
      "utf8",
    );
    const revision = await store.commit("bot-1", staging, {
      operationId: "op",
      traceId: "op",
      spaceId: "s",
      userId: "u",
      signal: new AbortController().signal,
    } as never);
    const restoredDir = await mkdtemp(path.join(tmpdir(), "rakazo-s3-restore-"));
    dirs.push(restoredDir);
    await store.restore("bot-1", revision, restoredDir, undefined as never);
    const content = await readFile(path.join(restoredDir, ".env"), "utf8");
    const sweep = sweepSurfacesForSecretEgress([PLANTED], { revision: content });
    expect(sweep.hits).toEqual([]);
    expect(content).toContain("GITHUB_TOKEN=[redacted]");
  });
});
