import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_REFUSAL_HINT,
  createAcceptanceGateService,
  EDIT_CLASS_CODING_TOOLS,
  parseAcceptanceRecord,
} from "./coding-acceptance-gate.js";

function fakePrisma(sessions: Array<Record<string, unknown>> = []) {
  const prisma = {
    codingSession: {
      findFirst: async ({ where }: { where: { latestRunId?: string } }) =>
        sessions.find((row) => row.latestRunId === where.latestRunId) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        sessions.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = sessions.find((entry) => entry.id === where.id)!;
        for (const key of Object.keys(data)) {
          const value = data[key];
          if (value !== null && typeof value === "object" && "increment" in (value as object)) {
            row[key] = ((row[key] as number) ?? 0) + (value as { increment: number }).increment;
          } else {
            row[key] = value;
          }
        }
        return row;
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, sessions };
}

function gateWithSession() {
  const { prisma, sessions } = fakePrisma([
    {
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
      latestRunId: "run-1",
      acceptance: null,
      refusals: 0,
    },
  ]);
  const gate = createAcceptanceGateService({ prisma });
  return { gate, sessions };
}

describe("acceptance-artifact gate (T4, V2 precondition)", () => {
  it("classifies edit ops that require a recorded acceptance", () => {
    expect(EDIT_CLASS_CODING_TOOLS.has("write_file")).toBe(true);
    expect(EDIT_CLASS_CODING_TOOLS.has("shell")).toBe(true);
    // Read-only tools never require the gate.
    expect(EDIT_CLASS_CODING_TOOLS.has("read_file")).toBe(false);
    expect(EDIT_CLASS_CODING_TOOLS.has("list_files")).toBe(false);
  });

  it("refuses the first edit before an acceptance record exists — explicitly", async () => {
    const { gate, sessions } = gateWithSession();
    const verdict = await gate.check({ runId: "run-1", toolName: "write_file", args: {} });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toMatch(/acceptance/i);
      expect(verdict.reason).toContain(ACCEPTANCE_REFUSAL_HINT);
    }
    // The refusal is visible on the session, not silent.
    expect(sessions[0]!.refusals).toBe(1);
  });

  it("allows edits once the outcome and verification commands are recorded", async () => {
    const { gate } = gateWithSession();
    await gate.record({
      sessionId: "session-1",
      outcome: "Login page renders and validates input",
      verificationCommands: ["pnpm vitest run login"],
    });
    const verdict = await gate.check({ runId: "run-1", toolName: "write_file", args: {} });
    expect(verdict).toEqual({ allowed: true });
  });

  it("never gates read-only tools, even before acceptance", async () => {
    const { gate } = gateWithSession();
    await expect(gate.check({ runId: "run-1", toolName: "read_file", args: {} })).resolves.toEqual({
      allowed: true,
    });
    await expect(gate.check({ runId: "run-1", toolName: "list_files", args: {} })).resolves.toEqual(
      { allowed: true },
    );
  });

  it("refuses the gate record itself unless it carries an outcome and at least one command", async () => {
    const { gate } = gateWithSession();
    await expect(
      gate.record({ sessionId: "session-1", outcome: "", verificationCommands: [] }),
    ).rejects.toThrow();
    await expect(
      gate.record({ sessionId: "session-1", outcome: "outcome", verificationCommands: [] }),
    ).rejects.toThrow();
    await expect(
      gate.record({
        sessionId: "session-1",
        outcome: "  ",
        verificationCommands: ["node test.js"],
      }),
    ).rejects.toThrow();
  });

  it("stores the acceptance record and reads it back", async () => {
    const { gate, sessions } = gateWithSession();
    await gate.record({
      sessionId: "session-1",
      outcome: "Login page renders and validates input",
      verificationCommands: ["pnpm vitest run login", "node scripts/verify.js"],
    });
    const stored = sessions[0]!.acceptance as Record<string, unknown>;
    expect(stored).toMatchObject({
      outcome: "Login page renders and validates input",
      verificationCommands: ["pnpm vitest run login", "node scripts/verify.js"],
    });
    expect(parseAcceptanceRecord(stored)).toMatchObject({
      outcome: "Login page renders and validates input",
    });
  });

  it("ignores runs that do not belong to a coding session (no coding row)", async () => {
    const { gate } = gateWithSession();
    await expect(
      gate.check({ runId: "ordinary-run", toolName: "write_file", args: {} }),
    ).resolves.toEqual({ allowed: true });
  });

  it("counts repeated refusals so the block is observable, not a one-off", async () => {
    const { gate, sessions } = gateWithSession();
    await gate.check({ runId: "run-1", toolName: "shell", args: {} });
    await gate.check({ runId: "run-1", toolName: "write_file", args: {} });
    expect(sessions[0]!.refusals).toBe(2);
  });
});

describe("parseAcceptanceRecord", () => {
  it("returns null for absent or malformed records", () => {
    expect(parseAcceptanceRecord(null)).toBeNull();
    expect(parseAcceptanceRecord(undefined)).toBeNull();
    expect(parseAcceptanceRecord({})).toBeNull();
    expect(parseAcceptanceRecord({ outcome: "x" })).toBeNull();
    expect(
      parseAcceptanceRecord({ outcome: "x", verificationCommands: "node test.js" }),
    ).toBeNull();
  });
});
