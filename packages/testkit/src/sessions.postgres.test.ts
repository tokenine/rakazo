import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator, EmailEmulator } from "@rakazo/adapters";
import { eventsAfter, followThreadEvents } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../../apps/api/src/app.ts";
import { otpSignUp } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
type AppHandles = Awaited<ReturnType<typeof createApp>>;
type Actor = { userId: string; spaceId: string };
type Bot = { id: string; threadId: string };
type Session = { id: string; name: string | null; isPrimary: boolean };

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

const emails = new EmailEmulator();

describeWithDatabase("bot session lifecycle (V12/V13/V14)", () => {
  let handles: AppHandles;
  let app: App;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-sessions-"));

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      composio: new ComposioEmulator(),
      email: emails,
    });
    app = handles.app;
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function raw(procedure: string, body: unknown, cookie: string, spaceId?: string) {
    return app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://127.0.0.1:5173",
        ...(spaceId ? { "x-rakazo-space-id": spaceId } : {}),
      },
      body: JSON.stringify({ json: body }),
    });
  }

  async function rpc<T>(procedure: string, body: unknown, cookie: string, spaceId?: string) {
    const response = await raw(procedure, body, cookie, spaceId);
    const text = await response.text();
    const payload = JSON.parse(text) as { json?: T; error?: { message?: string } };
    if (response.status >= 400 || payload.error) {
      throw new Error(`${procedure} ${response.status}: ${payload.error?.message ?? text}`);
    }
    return payload.json as T;
  }

  function botInput(name: string) {
    return { name, title: "", description: "", instructions: "", notifyOnFinish: false };
  }

  it("runs the full session lifecycle: create, rename, delete with promotion, guards, isolation", async () => {
    const owner = await otpSignUp(app, emails, `sessions-owner-${stamp}@rakazo.test`, "Owner");
    const ownerActor = await rpc<Actor>("me", {}, owner);
    const bot = await rpc<Bot>("bots/create", botInput("Sessions Bot"), owner);

    // --- V1/V12 setup: primary + one extra session.
    const second = await rpc<Session>(
      "threads/createSession",
      { botId: bot.id, name: "Research" },
      owner,
    );
    expect(second.isPrimary).toBe(false);

    let sessions = await rpc<Session[]>("threads/listSessions", { botId: bot.id }, owner);
    expect(sessions.map((session) => session.id)).toEqual([bot.threadId, second.id]);

    // --- V12: a subscribed client on one feed sees lifecycle events for the bot.
    // Subscribe from the feed's current head so only post-subscription
    // mutations reach the collector (a second client that is already caught up).
    const head = await eventsAfter(handles.prisma, bot.threadId, -1);
    const cursor = head.at(-1)?.seq ?? -1;
    const abort = new AbortController();
    const subscriber = followThreadEvents(
      handles.prisma,
      bot.threadId,
      cursor,
      undefined,
      abort.signal,
    );
    const collected: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const drain = (async () => {
      try {
        for await (const event of subscriber) {
          collected.push({ type: event.type, payload: event.payload });
        }
      } catch (error) {
      }
    })();
    // Let the generator finish its initial catch-up before mutating.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rpc<Session>(
      "threads/renameSession",
      { sessionId: second.id, name: "Deep research" },
      owner,
    );
    const third = await rpc<Session>("threads/createSession", { botId: bot.id }, owner);
    const deadline = Date.now() + 10_000;
    while (!collected.some((event) => event.type === "session.created")) {
      if (Date.now() > deadline) throw new Error(`no session.created on feed: ${JSON.stringify(collected)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    abort.abort();
    await drain;
    const renamed = collected.find((event) => event.type === "session.renamed");
    expect(renamed?.payload).toMatchObject({
      threadId: second.id,
      botId: bot.id,
      name: "Deep research",
    });
    const created = collected.find((event) => event.type === "session.created");
    expect(created?.payload).toMatchObject({ threadId: third.id, botId: bot.id });

    // --- V13: delete with an active run is refused, everything stays intact.
    const task = await handles.prisma.task.create({
      data: {
        spaceId: ownerActor.spaceId,
        botId: bot.id,
        threadId: third.id,
        userId: ownerActor.userId,
        prompt: "active run fixture",
        status: "queued",
      },
    });
    await handles.prisma.run.create({
      data: {
        spaceId: ownerActor.spaceId,
        botId: bot.id,
        threadId: third.id,
        taskId: task.id,
        userId: ownerActor.userId,
        status: "queued",
        trigger: "user",
      },
    });
    const busyDelete = await raw("threads/deleteSession", { sessionId: third.id }, owner);
    expect(busyDelete.status).toBe(409);
    expect(await busyDelete.text()).toMatch(/active run/i);
    sessions = await rpc<Session[]>("threads/listSessions", { botId: bot.id }, owner);
    expect(sessions.map((session) => session.id)).toContain(third.id);

    // --- V13: delete primary with siblings promotes the earliest remaining.
    await handles.prisma.run.updateMany({
      where: { threadId: third.id },
      data: { status: "cancelled" },
    });
    const promotedDelete = await raw(
      "threads/deleteSession",
      { sessionId: bot.threadId },
      owner,
    );
    expect(promotedDelete.status).toBe(200);
    sessions = await rpc<Session[]>("threads/listSessions", { botId: bot.id }, owner);
    expect(sessions.map((session) => session.id)).not.toContain(bot.threadId);
    expect(sessions[0]?.isPrimary).toBe(true);
    // Earliest createdAt among the siblings (Research was created before the third).
    expect(sessions[0]?.id).toBe(second.id);

    // --- V13: the last remaining session cannot be deleted.
    await rpc<{ ok: true }>("threads/deleteSession", { sessionId: third.id }, owner);
    const lastDelete = await raw("threads/deleteSession", { sessionId: second.id }, owner);
    expect(lastDelete.status).toBe(409);
    expect(await lastDelete.text()).toMatch(/last remaining session/i);

    // --- V14: a non-owner member of the space cannot touch the owner's sessions.
    const member = await otpSignUp(app, emails, `sessions-member-${stamp}@rakazo.test`, "Member");
    const memberActor = await rpc<Actor>("me", {}, member);
    await handles.prisma.member.create({
      data: {
        id: `sessions-member-${stamp}`,
        organizationId: ownerActor.spaceId,
        userId: memberActor.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    // The sign-up bootstrap may already have linked the member to the owner's
    // default space once the org Member row exists; only fill the gap if not.
    const existingMembership = await handles.prisma.spaceMember.findFirst({
      where: { spaceId: ownerActor.spaceId, userId: memberActor.userId },
      select: { id: true },
    });
    if (!existingMembership) {
      await handles.prisma.spaceMember.create({
        data: {
          id: `sessions-space-member-${stamp}`,
          spaceId: ownerActor.spaceId,
          organizationId: ownerActor.spaceId,
          userId: memberActor.userId,
          createdAt: new Date(),
        },
      });
    }
    const ownerBotAfter = await rpc<Bot[]>("bots/list", {}, owner);
    const target = ownerBotAfter[0]!;
    for (const [procedure, body] of [
      ["threads/listSessions", { botId: target.id }],
      ["threads/createSession", { botId: target.id, name: "Stolen" }],
    ] as const) {
      const response = await raw(procedure, body, member, ownerActor.spaceId);
      expect(response.status, procedure).toBeGreaterThanOrEqual(400);
    }
    const memberSessions = await handles.prisma.thread.findMany({
      where: { botId: target.id },
      select: { id: true, name: true },
    });
    expect(memberSessions.map((session) => session.name)).not.toContain("Stolen");
    const onlySession = memberSessions[0]!;
    for (const [procedure, body] of [
      ["threads/renameSession", { sessionId: onlySession.id, name: "Stolen name" }],
      ["threads/deleteSession", { sessionId: onlySession.id }],
    ] as const) {
      const response = await raw(procedure, body, member, ownerActor.spaceId);
      expect(response.status, procedure).toBeGreaterThanOrEqual(400);
    }
    expect(
      await handles.prisma.thread.findUnique({ where: { id: onlySession.id } }),
    ).toMatchObject({ name: onlySession.name });
  });
});
