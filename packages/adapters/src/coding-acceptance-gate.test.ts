import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import {
  ACCEPTANCE_REFUSAL_HINT,
  acceptanceRefusalReason,
  CODING_READ_ONLY_TOOLS,
  createAcceptanceGateService,
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

describe("acceptance-artifact gate is deny-by-default for coding sessions (T4, HIGH-1 fix)", () => {
  it("every allowlist name is a real builtin tool — no phantom entries", () => {
    const realNames = new Set(builtinAgentTools.map((tool) => tool.name));
    expect(CODING_READ_ONLY_TOOLS.size).toBeGreaterThan(0);
    for (const name of CODING_READ_ONLY_TOOLS) {
      expect(realNames.has(name)).toBe(true);
    }
  });

  it("the allowlist is read-only: mutation-capable builtins are never exempt", () => {
    for (const mutating of [
      "js",
      "client_js",
      "computer_act",
      "browser_act",
      "browser_navigate",
      "write_file",
      "shell",
      "attach_file",
      "open_path",
      "launch_app",
      "add_mcp_server",
      "schedule_create",
      "request_secret",
      "secret_request",
      "spawn_bot",
      "run_subagent",
      "ask_user",
      "message_user",
    ]) {
      expect(CODING_READ_ONLY_TOOLS.has(mutating)).toBe(false);
    }
  });

  it("refuses real mutation tools before acceptance — explicitly, counted on the session", async () => {
    const { gate, sessions } = gateWithSession();
    for (const toolName of ["js", "computer_act", "shell", "write_file"]) {
      const verdict = await gate.check({ runId: "run-1", toolName, args: {} });
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) {
        expect(verdict.reason).toContain(toolName);
        expect(verdict.reason).toMatch(/acceptance/i);
        expect(verdict.reason).toContain(ACCEPTANCE_REFUSAL_HINT);
      }
    }
    // The refusals are visible on the session, not silent.
    expect(sessions[0]!.refusals).toBe(4);
  });

  it("denies unknown and formerly-phantom tool names by default — no name-matching escape hatch", async () => {
    const { gate } = gateWithSession();
    for (const phantom of [
      "edit_file",
      "multi_edit",
      "apply_patch",
      "move_file",
      "delete_file",
      "totally_unknown_tool",
    ]) {
      const verdict = await gate.check({ runId: "run-1", toolName: phantom, args: {} });
      expect(verdict.allowed).toBe(false);
    }
  });

  it("lets every read-only allowlist tool through before acceptance", async () => {
    const { gate } = gateWithSession();
    for (const name of CODING_READ_ONLY_TOOLS) {
      await expect(gate.check({ runId: "run-1", toolName: name, args: {} })).resolves.toEqual({
        allowed: true,
      });
    }
    // Spot-check the archetypal readers explicitly.
    await expect(gate.check({ runId: "run-1", toolName: "read_file", args: {} })).resolves.toEqual({
      allowed: true,
    });
    await expect(
      gate.check({ runId: "run-1", toolName: "computer_observe", args: {} }),
    ).resolves.toEqual({ allowed: true });
  });

  it("allows mutation tools once the outcome and verification commands are recorded", async () => {
    const { gate } = gateWithSession();
    await gate.record({
      sessionId: "session-1",
      outcome: "Login page renders and validates input",
      verificationCommands: ["pnpm vitest run login"],
    });
    for (const toolName of ["write_file", "js", "computer_act", "shell"]) {
      await expect(gate.check({ runId: "run-1", toolName, args: {} })).resolves.toEqual({
        allowed: true,
      });
    }
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
    await gate.check({ runId: "run-1", toolName: "js", args: {} });
    await gate.check({ runId: "run-1", toolName: "computer_act", args: {} });
    expect(sessions[0]!.refusals).toBe(2);
  });
});

describe("acceptanceRefusalReason — shared with the executor fail-closed path (HIGH-1)", () => {
  it("names the refused tool and carries the actionable hint", () => {
    const reason = acceptanceRefusalReason("computer_act");
    expect(reason).toContain("computer_act");
    expect(reason).toMatch(/refused/i);
    expect(reason).toContain(ACCEPTANCE_REFUSAL_HINT);
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
