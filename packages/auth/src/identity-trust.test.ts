import type { TransactionalEmail } from "@rakazo/adapter-kit";
import { bootstrapUserSpace } from "@rakazo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./index.js";

// Exercise Better Auth's real routing, the emailOTP plugin and session hooks
// with its official offline adapter. Only persistence is faked.
vi.mock("better-auth/adapters/prisma", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return {
    prismaAdapter: (prisma: { authData: Record<string, unknown[]> }) =>
      memoryAdapter(prisma.authData),
  };
});
vi.mock("@rakazo/db", () => ({ bootstrapUserSpace: vi.fn(async () => ({ spaceId: "space-1" })) }));

function fixture({
  allowlist = "",
  delivery = true,
  baseURL = "http://auth.example.test",
  webOrigin = "http://web.example.test",
  requestOrigin,
}: {
  allowlist?: string;
  delivery?: boolean;
  baseURL?: string;
  webOrigin?: string;
  requestOrigin?: string;
} = {}) {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const policy = {
    signupsEnabled: true,
    signupAllowlist: allowlist,
    signupPolicyInitialized: true,
  };
  const messages: TransactionalEmail[] = [];
  const members = new Set<string>();
  const prisma = {
    authData: data,
    deploymentSettings: { findUnique: vi.fn(async () => policy) },
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
        members.has(where.userId) ? { spaceId: "space-1" } : null,
      ),
    },
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { email: string } }) =>
          data.user?.find((user) => user.email === where.email) ?? null,
      ),
    },
  };
  vi.mocked(bootstrapUserSpace).mockImplementation(async (_prisma, user) => {
    members.add(user.id);
    return { spaceId: "space-1" };
  });
  const auth = createAuth(prisma as never, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL,
    webOrigin,
    signupsEnabled: "true",
    signupAllowlist: "",
    email: delivery
      ? {
          describe: () => ({
            id: "offline-email",
            contractVersion: "1",
            adapterVersion: "1",
            capabilities: { transactional: true },
          }),
          send: async (message) => {
            messages.push(message);
          },
        }
      : undefined,
  });
  const request = (path: string, body?: unknown, token?: string) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          origin: requestOrigin ?? webOrigin,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const requestOtp = (email = "approved@example.test") =>
    request("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const lastCode = () => {
    const match = messages.at(-1)!.text.match(/\b(\d{6})\b/);
    if (!match) throw new Error("no OTP code in the captured email");
    return match[1]!;
  };
  const verify = (email = "approved@example.test", code = lastCode()) =>
    request("/sign-in/email-otp", { email, otp: code });
  return { auth, request, requestOtp, verify, lastCode, data, policy, messages, members };
}

beforeEach(() => vi.clearAllMocks());

describe("loopback trusted origins", () => {
  it("accepts Origin localhost when webOrigin is 127.0.0.1", async () => {
    const f = fixture({
      baseURL: "http://127.0.0.1:5173",
      webOrigin: "http://127.0.0.1:5173",
      requestOrigin: "http://localhost:5173",
    });
    expect((await f.requestOtp()).status).toBe(200);
  });

  it("accepts Origin 127.0.0.1 when webOrigin is localhost", async () => {
    const f = fixture({
      baseURL: "http://localhost:5173",
      webOrigin: "http://localhost:5173",
      requestOrigin: "http://127.0.0.1:5173",
    });
    expect((await f.requestOtp()).status).toBe(200);
  });
});

describe("identity trust through auth endpoints", () => {
  it("fails closed when email delivery is unavailable — no codes, no users, no bootstrap", async () => {
    const f = fixture({ delivery: false });
    expect((await f.requestOtp()).status).toBe(400);
    expect(f.data.user).toHaveLength(0);
    expect(f.messages).toHaveLength(0);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("fails closed for an allowlisted address when email delivery is unavailable", async () => {
    const f = fixture({ allowlist: "@example.test", delivery: false });
    expect((await f.requestOtp()).status).toBe(400);
    expect(f.data.user).toHaveLength(0);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("admits allowlisted users by mailbox proof and bootstraps on first OTP session", async () => {
    const f = fixture({ allowlist: "approved@example.test" });
    // A non-allowlisted address cannot even request a code.
    expect((await f.requestOtp("outsider@example.test")).status).toBe(400);
    expect(f.messages).toHaveLength(0);
    // The allowlisted address gets a code, and the right one.
    expect((await f.requestOtp()).status).toBe(200);
    expect(f.messages).toHaveLength(1);
    // A forged or wrong code does not create a session.
    expect((await f.verify("approved@example.test", "000000")).status).toBeGreaterThanOrEqual(400);
    expect(f.data.session).toHaveLength(0);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
    // The emailed code admits the user, marks the mailbox verified, and
    // provisions the space exactly once.
    const response = await f.verify();
    expect(response.status).toBe(200);
    const { token, user } = (await response.json()) as {
      token: string;
      user: { emailVerified: boolean };
    };
    expect(token).toEqual(expect.any(String));
    expect(user.emailVerified).toBe(true);
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);
    expect(
      await f.auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }),
    ).toMatchObject({ user: { emailVerified: true } });
    // A repeat sign-in must not bootstrap a second space.
    expect((await f.requestOtp()).status).toBe(200);
    expect((await f.verify()).status).toBe(200);
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);
  });

  it("rechecks policy before admitting an existing but unprovisioned signup", async () => {
    const f = fixture({ allowlist: "@example.test" });
    await f.requestOtp();
    expect((await f.verify()).status).toBe(200);
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);

    // An existing but never-provisioned address cannot enter once registration closes.
    f.policy.signupsEnabled = false;
    f.data.user!.push({
      id: "u-existing",
      email: "existing@example.test",
      emailVerified: true,
      name: "Existing",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await f.requestOtp("existing@example.test")).status).toBe(200);
    expect((await f.verify("existing@example.test", f.lastCode())).status).toBeGreaterThanOrEqual(
      400,
    );
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);

    // A brand-new outsider address is rejected outright.
    expect((await f.requestOtp("newcomer@elsewhere.test")).status).toBe(400);
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);
  });

  it("gates unverified sessions when the live allowlist is enabled", async () => {
    const f = fixture();
    // Provision an account through the normal OTP flow first.
    await f.requestOtp("legacy@example.test");
    const signedIn = await f.verify("legacy@example.test");
    const { token } = (await signedIn.json()) as { token: string };
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);

    // Simulate a pre-upgrade account whose mailbox was never verified, then
    // enable the live allowlist: unverified sessions must fail closed.
    f.data.user![0]!.emailVerified = false;
    f.policy.signupAllowlist = "@example.test";
    expect(await f.auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await (await f.request("/get-session", undefined, token)).json()).toBeNull();
    expect((await f.request("/update-user", { name: "Changed" }, token)).status).toBe(401);
  });

  it("reserves internal messaging emails across code requests and sign-ins", async () => {
    const f = fixture();
    for (const email of [
      "msg-sendblue15550001111@messaging.invalid",
      "MSG-Test@MESSAGING.INVALID",
    ]) {
      expect((await f.requestOtp(email)).status).toBe(400);
      expect((await f.verify(email, "123456")).status).toBe(400);
    }
    expect(f.data.user).toHaveLength(0);
    expect(f.messages).toHaveLength(0);
  });
});
