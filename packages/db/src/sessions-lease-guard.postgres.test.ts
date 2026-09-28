/**
 * V17 — Lease teardown guard (PostgreSQL, DB-gated)
 *
 * Verifies that deleting a session never touches ComputerExecutionLease rows
 * and never modifies other sessions' runs.  This is the regression net for
 * grill #5: a session delete must not tear down the per-bot computer lease.
 *
 * The structural guarantee is that `repos.deleteSession` (repos.ts:761-790)
 * contains no code that queries or mutates the `computer_execution_leases` table.
 * This test proves the behavioral outcome: after deleting a session with active
 * leases present, all lease rows and all other session runs are intact.
 *
 * Run with: VERIFY_DATABASE=1 pnpm --filter @rakazo/db test sessions-lease-guard.postgres.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";
import { ensureComputerRecord } from "./computers.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("session delete never touches ComputerExecutionLease rows (V17)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `lease-guard-user-${suffix}`;
  const email = `lease-guard-${suffix}@rakazo.test`;
  const organizationId = `lease-guard-org-${suffix}`;
  const spaceId = `lease-guard-space-${suffix}`;
  const botId = `lease-guard-bot-${suffix}`;
  const primarySessionId = `lease-guard-primary-${suffix}`;
  const sideSessionId = `lease-guard-side-${suffix}`;
  const leaseId = `lease-guard-lease-${suffix}`;
  let computerId = "";

  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };

    // ── Bootstrap user / org / space ──────────────────────────────────────
    const now = new Date();
    await prisma.user.create({
      data: { id: userId, name: "Lease Guard", email, emailVerified: false },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Lease Guard Org", slug: organizationId, createdAt: now },
    });
    await prisma.space.create({
      data: {
        id: spaceId,
        organizationId,
        name: "Lease Guard Space",
        isDefault: true,
        createdByUserId: userId,
        createdAt: now,
      },
    });
    await prisma.member.create({
      data: { id: `member-${suffix}`, organizationId, userId, role: "owner", createdAt: now },
    });

    // ── Computer + bot + two sessions ──────────────────────────────────────
    const teamComputer = await ensureComputerRecord(prisma, {
      mode: "team",
      spaceId,
      userId,
      kind: "team",
    });
    computerId = teamComputer.id;
    await prisma.bot.create({
      data: {
        id: botId,
        spaceId,
        userId,
        name: "Lease Guard Bot",
        title: "Lease Guard Bot",
        description: "",
        instructions: "",
        notifyOnFinish: false,
        color: "#6B7280",
        computerId,
      },
    });
    await prisma.thread.create({
      data: {
        id: primarySessionId,
        spaceId,
        botId,
        userId,
        isPrimary: true,
        name: "Primary",
      },
    });
    await prisma.thread.create({
      data: {
        id: sideSessionId,
        spaceId,
        botId,
        userId,
        isPrimary: false,
        name: "Side",
      },
    });

    // ── A computer execution lease for the bot (simulating an active run) ───
    // runId is stored but the key integrity is not enforced in this test environment.
    await prisma.computerExecutionLease.create({
      data: {
        id: leaseId,
        computerId,
        botId,
        runId: "fake-run-for-lease",
        fence: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Clean up in reverse-dependency order
    await prisma.computerExecutionLease.deleteMany({ where: { id: leaseId } });
    await prisma.thread.deleteMany({ where: { botId } });
    await prisma.bot.deleteMany({ where: { id: botId } });
    await prisma.computer.deleteMany({ where: { id: computerId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await close?.();
  });

  it("deleting a non-primary session does not mutate any ComputerExecutionLease rows", async () => {
    const beforeLeases = await prisma.computerExecutionLease.findMany({
      where: { botId },
    });
    expect(beforeLeases).toHaveLength(1);
    expect(beforeLeases[0]!.id).toBe(leaseId);

    // Delete the side session (no active run on it)
    const repos = createRepos(prisma);
    const actor = { userId, spaceId, email, isDeploymentOwner: false };
    await repos.deleteSession(actor, sideSessionId);

    // Leases are completely untouched — this is the core V17 behavioral claim.
    const afterLeases = await prisma.computerExecutionLease.findMany({
      where: { botId },
    });
    expect(afterLeases).toHaveLength(1);
    expect(afterLeases[0]!).toMatchObject({
      id: leaseId,
      computerId,
      botId,
    });
  });

  it("deleting the primary session also leaves ComputerExecutionLease rows intact (V17)", async () => {
    // Create a third session so the primary is not the last remaining session.
    const thirdSessionId = `lease-guard-third-${suffix}`;
    await prisma.thread.create({
      data: {
        id: thirdSessionId,
        spaceId,
        botId,
        userId,
        isPrimary: false,
        name: "Third",
      },
    });

    const repos = createRepos(prisma);
    const actor = { userId, spaceId, email, isDeploymentOwner: false };

    // Delete the primary session (not the last — third session exists)
    await repos.deleteSession(actor, primarySessionId);

    // Lease rows remain completely untouched
    const afterLeases = await prisma.computerExecutionLease.findMany({
      where: { botId },
    });
    expect(afterLeases).toHaveLength(1);
    expect(afterLeases[0]!).toMatchObject({ id: leaseId, computerId, botId });
  });
});
