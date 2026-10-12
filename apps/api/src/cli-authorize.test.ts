import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("./cli-tokens.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli-tokens.js")>();
  return {
    ...actual,
    mintCliToken: vi.fn(async (_p: unknown, input: { userId: string; name: string }) => ({
      id: "cli_1",
      name: input.name,
      token: "rakazo_cli_issued-once",
    })),
  };
});

import { claimCliToken, cliTokensList, cliTokensRevoke } from "./cli-authorize.js";
import type { RouterDeps } from "./router.js";

function deps(actor: { userId: string } | null) {
  return {
    actor,
    prisma: {
      cliToken: {
        findMany: vi.fn(async () => [
          {
            id: "cli_1",
            name: "agent",
            createdAt: new Date("2026-10-12T00:00:00Z"),
            lastUsedAt: null,
            revokedAt: null,
          },
        ]),
      },
    },
  } as unknown as { actor: typeof actor; prisma: PrismaClient };
}

describe("cliTokens list/revoke", () => {
  it("lists only the caller's tokens as serialized rows", async () => {
    const d = deps({ userId: "u1" });
    const rows = await cliTokensList(d as never);
    expect(rows).toEqual([
      {
        id: "cli_1",
        name: "agent",
        createdAt: "2026-10-12T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
  });

  it("revokes an owned token", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const d = deps({ userId: "u1" });
    (d.prisma as unknown as Record<string, unknown>).cliToken = { updateMany };
    await cliTokensRevoke(d as never, { id: "cli_1" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "cli_1", userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe("claimCliToken (authorize page)", () => {
  it("mints once for a sessioned user and returns the raw token in the response body", async () => {
    const d = deps({ userId: "u1" });
    const res = await claimCliToken(d as never, { name: "my laptop" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string };
    expect(body.token).toBe("rakazo_cli_issued-once");
  });

  it("refuses an unauthenticated claim", async () => {
    const d = deps(null);
    const res = await claimCliToken(d as never, { name: "x" });
    expect(res.status).toBe(401);
  });
});
