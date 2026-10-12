/**
 * 004-code-mode T35 — RED: codingAcceptance RPC routes record and retrieve
 * acceptance artifacts for coding sessions.
 *
 * Route: /rpc/codingAcceptance/record  (POST)
 * Route: /rpc/codingAcceptance/get    (GET)
 */

import { describe, it, expect, vi } from "vitest";
import { createAcceptanceGateService } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";

describe("T35 RED: codingAcceptance gate service records and retrieves acceptance", () => {
  // Fake Prisma client that captures the update call.
  function makeFakePrisma() {
    const sessions = new Map<string, { id: string; acceptance: unknown }>();

    const fakePrisma = {
      codingSession: {
        update: vi.fn((args: { where: { id: string }; data: { acceptance: unknown } }) => {
          const { where, data } = args;
          const existing = sessions.get(where.id) ?? { id: where.id, acceptance: null };
          const updated = { ...existing, ...data };
          sessions.set(where.id, updated);
          return Promise.resolve(updated);
        }),
        findFirst: vi.fn((args: { where: { id?: string } }) => {
          if (args.where?.id) {
            return Promise.resolve(sessions.get(args.where.id) ?? null);
          }
          return Promise.resolve(null);
        }),
        findUnique: vi.fn((args: { where: { id: string } }) => {
          return Promise.resolve(sessions.get(args.where.id) ?? null);
        }),
      },
    } as unknown as PrismaClient;

    return { prisma: fakePrisma, sessions };
  }

  it("record → session acceptance field is updated", async () => {
    const { prisma } = makeFakePrisma();
    const gate = createAcceptanceGateService({ prisma });

    // Pre-seed a session.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.codingSession.update as any)({
      where: { id: "session-1" },
      data: { acceptance: null },
    });

    const record = await gate.record({
      sessionId: "session-1",
      outcome: "implemented feature X",
      verificationCommands: ["npm test", "npm run build"],
    });

    expect(record.outcome).toBe("implemented feature X");
    expect(record.verificationCommands).toEqual(["npm test", "npm run build"]);
    expect(record.recordedAt).toBeTruthy();
    expect(prisma.codingSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: {
        acceptance: expect.objectContaining({
          outcome: "implemented feature X",
          verificationCommands: ["npm test", "npm run build"],
        }),
      },
    });
  });

  it("get → returns recorded acceptance", async () => {
    const { prisma } = makeFakePrisma();
    const gate = createAcceptanceGateService({ prisma });

    // Pre-seed with acceptance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.codingSession.update as any)({
      where: { id: "session-2" },
      data: {
        acceptance: {
          outcome: "done",
          verificationCommands: ["npm test"],
          recordedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const result = await gate.get("session-2");

    expect(result).toEqual({
      outcome: "done",
      verificationCommands: ["npm test"],
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("get → returns null when no acceptance recorded", async () => {
    const { prisma } = makeFakePrisma();
    const gate = createAcceptanceGateService({ prisma });

    // Pre-seed WITHOUT acceptance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.codingSession.update as any)({
      where: { id: "session-3" },
      data: { acceptance: null },
    });

    const result = await gate.get("session-3");

    expect(result).toBeNull();
  });
});
