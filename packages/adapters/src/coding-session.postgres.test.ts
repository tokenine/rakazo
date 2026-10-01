import { randomUUID } from "node:crypto";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  continueCodingSession,
  createCodingSession,
  createSessionServiceDeps,
  loadCodingSession,
  releaseCodingSession,
  WorkspaceBusyError,
} from "./coding-session-service.js";

/**
 * V13/V14 database-level evidence. Self-skips without a database so the
 * offline suite stays deterministic; the service-layer V13 tests run offline
 * against the fake-prisma double in coding-session-service.test.ts.
 */
const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("coding sessions (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const users: string[] = [];

  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });

  afterAll(async () => {
    if (!db) return;
    await prisma.codingWorkspaceLease.deleteMany({});
    await prisma.codingSession.deleteMany({});
    for (const id of users) {
      await prisma.organization.deleteMany({ where: { id } });
      await prisma.user.deleteMany({ where: { id } });
    }
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function setup() {
    const id = randomUUID();
    users.push(id);
    await prisma.user.create({
      data: { id, name: "Coding test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Coding test", slug: id, createdAt: new Date() },
    });
    return id;
  }

  it("two sessions cannot own one workspace; reattach keeps the (workspace, engine) binding", async () => {
    const userId = await setup();
    const deps = createSessionServiceDeps({ prisma });
    const first = await createCodingSession(deps, {
      workspaceId: `ws-${userId}`,
      engine: "normal-pi",
      spaceId: userId,
      userId,
      botId: userId,
    });
    await expect(
      createCodingSession(deps, {
        workspaceId: `ws-${userId}`,
        engine: "omp",
        spaceId: userId,
        userId,
        botId: userId,
      }),
    ).rejects.toBeInstanceOf(WorkspaceBusyError);

    // Durable across "restart": a fresh service instance over the same DB rows.
    const reattached = await loadCodingSession(createSessionServiceDeps({ prisma }), {
      sessionId: first.id,
    });
    expect(reattached).toMatchObject({ workspaceId: `ws-${userId}`, engine: "normal-pi" });
  });

  it("labelled continuation transfers the lease and preserves the original session", async () => {
    const userId = await setup();
    const deps = createSessionServiceDeps({ prisma });
    const original = await createCodingSession(deps, {
      workspaceId: `ws-cont-${userId}`,
      engine: "normal-pi",
      spaceId: userId,
      userId,
      botId: userId,
    });
    // MED-4 (fix round): the original run must be stopped first — the row's
    // status is authoritative, the caller cannot claim it.
    await releaseCodingSession(deps, { sessionId: original.id });
    const continuation = await continueCodingSession(deps, {
      originalSessionId: original.id,
      targetEngine: "omp",
      label: "engine-change",
      handoffSummary: "handoff",
    });
    const leases = await prisma.codingWorkspaceLease.findMany();
    expect(leases.filter((lease) => lease.workspaceId === `ws-cont-${userId}`)).toHaveLength(1);
    expect(leases[0]).toMatchObject({
      sessionId: continuation.id,
      workspaceId: `ws-cont-${userId}`,
    });
    const originalRow = await prisma.codingSession.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(originalRow).toMatchObject({ status: "stopped", engine: "normal-pi" });
  });
});
