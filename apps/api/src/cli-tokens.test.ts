import { createHash } from "node:crypto";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/db", () => ({
  requireMembership: vi.fn(async (_p: unknown, userId: string) => ({
    userId,
    spaceId: "space-1",
    email: "user@example.com",
  })),
}));

import { actorForCliToken, hashCliToken, mintCliToken, revokeCliToken } from "./cli-tokens.js";

function prismaWith(cliToken: {
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
}) {
  return { cliToken } as unknown as PrismaClient;
}

describe("hashCliToken", () => {
  it("is sha256 hex of the raw token", () => {
    expect(hashCliToken("raw-value")).toBe(createHash("sha256").update("raw-value").digest("hex"));
  });
});

describe("mintCliToken", () => {
  it("stores only the hash and returns the raw token once", async () => {
    const create = vi.fn(async (args: { data: { tokenHash: string } }) => ({
      id: "cli_1",
      ...args.data,
    }));
    const prisma = prismaWith({
      findUnique: vi.fn(),
      create,
      update: vi.fn(),
      updateMany: vi.fn(),
    });

    const result = await mintCliToken(prisma, { userId: "u1", name: "my agent" });

    expect(result.token).toMatch(/^rakazo_cli_/);
    expect(result.token).not.toContain(create.mock.calls[0]![0].data.tokenHash);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        name: "my agent",
        tokenHash: hashCliToken(result.token),
      }),
    });
  });
});

describe("actorForCliToken", () => {
  it("resolves an active token to the owner's actor and touches lastUsedAt", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = prismaWith({
      findUnique: vi.fn(async () => ({
        id: "cli_1",
        userId: "u1",
        revokedAt: null,
      })),
      create: vi.fn(),
      update,
      updateMany: vi.fn(),
    });

    const actor = await actorForCliToken(prisma, "some-raw-token");

    expect(actor).toMatchObject({ userId: "u1", spaceId: "space-1" });
    expect(prisma.cliToken.update).toHaveBeenCalledWith({
      where: { id: "cli_1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("returns null for an unknown, revoked, or empty token", async () => {
    const base = { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
    const revoked = prismaWith({
      findUnique: vi.fn(async () => ({
        id: "cli_1",
        userId: "u1",
        revokedAt: new Date(),
      })),
      ...base,
    });
    expect(await actorForCliToken(revoked, "raw")).toBeNull();

    const unknown = prismaWith({
      findUnique: vi.fn(async () => null),
      ...base,
    });
    expect(await actorForCliToken(unknown, "raw")).toBeNull();

    expect(await actorForCliToken(unknown, "")).toBeNull();
    expect(await actorForCliToken(unknown, "   ")).toBeNull();
  });
});

describe("revokeCliToken", () => {
  it("marks only the owner's token revoked", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = prismaWith({
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany,
    });

    await revokeCliToken(prisma, { id: "cli_1", userId: "u1" });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "cli_1", userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
