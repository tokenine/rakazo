import type { TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { BRAND_NAME } from "@rakazo/contracts";
import { emailAllowed, isMessagingEmail, parseAllowlist, signupPolicyFromEnv } from "@rakazo/core";
import { bootstrapUserSpace, type PrismaClient } from "@rakazo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, emailOTP, organization } from "better-auth/plugins";

export interface AuthEnv {
  secret: string;
  baseURL: string;
  webOrigin: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  extraOrigins?: string[];
  email?: TransactionalEmailProvider;
  onEmailError?: (error: unknown) => void;
  beforeDeleteUser?: (userId: string) => Promise<void>;
}

export async function resolveSignupPolicy(
  prisma: Pick<PrismaClient, "deploymentSettings">,
  env: Pick<AuthEnv, "signupsEnabled" | "signupAllowlist">,
): Promise<{ enabled: boolean; allowlist: string[] }> {
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
    select: { signupsEnabled: true, signupAllowlist: true, signupPolicyInitialized: true },
  });
  if (settings?.signupPolicyInitialized) {
    return {
      enabled: settings.signupsEnabled,
      allowlist: parseAllowlist(settings.signupAllowlist),
    };
  }
  return signupPolicyFromEnv(env);
}

/** OTP endpoints that admit new users, so signup policy applies to them too. */
const OTP_SIGNIN_PATHS = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp"]);

export function createAuth(prisma: PrismaClient, env: AuthEnv) {
  return betterAuth({
    appName: BRAND_NAME,
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: buildTrustedOrigins(env),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    // Passwordless: the only way in is a one-time code delivered by email.
    // `overrideDefaultEmailVerification` lets a successful OTP sign-in prove
    // mailbox ownership, which keeps the allowlist gating below fail-closed.
    plugins: [
      bearer(),
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "owner",
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10,
        allowedAttempts: 3,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp }) => {
          if (!env.email) {
            throw new APIError("BAD_REQUEST", {
              message: "This server does not have email delivery configured",
            });
          }
          // Keep the response timing generic. Production providers track and retry
          // the promise, while the composition root drains accepted delivery on shutdown.
          void env.email.send(otpEmail(email, otp)).catch((error) => env.onEmailError?.(error));
        },
      }),
    ],
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await env.beforeDeleteUser?.(user.id);
          const memberships = await prisma.member.findMany({
            where: { userId: user.id },
            select: {
              organizationId: true,
              organization: { select: { members: { select: { userId: true } } } },
            },
          });
          const personalOrganizationIds = memberships
            .filter(({ organization }) =>
              organization.members.every((member) => member.userId === user.id),
            )
            .map(({ organizationId }) => organizationId);

          await prisma.$transaction([
            prisma.deploymentSettings.updateMany({
              where: { ownerUserId: user.id },
              data: { ownerUserId: null },
            }),
            // Messaging identities are deliberately FK-free, so clear them
            // here or the unique address would point at a deleted bot forever.
            prisma.messagingIdentity.deleteMany({
              where: { userId: user.id },
            }),
            prisma.organization.deleteMany({
              where: { id: { in: personalOrganizationIds } },
            }),
          ]);
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        for (const value of [ctx.body?.email, ctx.body?.newEmail]) {
          if (typeof value === "string" && isMessagingEmail(value)) {
            throw new APIError("BAD_REQUEST", { message: "Email is not available" });
          }
        }
        let policy: { enabled: boolean; allowlist: string[] } | undefined;
        if (OTP_SIGNIN_PATHS.has(ctx.path)) {
          policy = await resolveSignupPolicy(prisma, env);
          const email = String(ctx.body?.email ?? "").trim();
          if (!env.email) {
            throw new APIError("BAD_REQUEST", {
              message: "This server does not have email delivery configured",
            });
          }
          // Closed or allowlisted registrations still admit existing users —
          // the gates below only apply to addresses that have never signed up.
          const existing = email
            ? await prisma.user.findUnique({
                where: { email: email.toLowerCase() },
                select: { id: true },
              })
            : null;
          if (!existing) {
            if (!policy.enabled) {
              throw new APIError("BAD_REQUEST", { message: "Registration is closed" });
            }
            if (!emailAllowed(email, policy.allowlist)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not allowed to register" });
            }
          }
        }
        return {
          context: {
            context: {
              internalAdapter: {
                ...ctx.context.internalAdapter,
                // Authorize at lookup: bearer conversion happens after before
                // hooks, and auth mutations also read sessions through here.
                findSession: async (token: string) => {
                  const session = await ctx.context.internalAdapter.findSession(token);
                  if (!session || isMessagingEmail(session.user.email)) return null;
                  if (session.user.emailVerified) return session;
                  policy ??= await resolveSignupPolicy(prisma, env);
                  return policy.allowlist.length === 0 ? session : null;
                },
              },
            },
          },
        };
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            // The auth adapter can still be inside the signup transaction.
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            const policy = await resolveSignupPolicy(prisma, env);
            if (
              !user ||
              isMessagingEmail(user.email) ||
              (!user.emailVerified && policy.allowlist.length > 0)
            ) {
              throw new APIError("FORBIDDEN", { message: "Email verification required" });
            }
            // Unverified signup must not provision resources or claim the
            // deployment owner. Bootstrap only at the first admitted session.
            const membership = await prisma.spaceMember.findFirst({ where: { userId: user.id } });
            if (!membership) {
              if (!policy.enabled || !emailAllowed(user.email, policy.allowlist)) {
                throw new APIError("FORBIDDEN", { message: "Registration is closed" });
              }
              await bootstrapUserSpace(prisma, user, env);
            }
          },
        },
      },
      user: {
        create: {
          before: async (user) => {
            if (isMessagingEmail(user.email)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not available" });
            }
          },
        },
        update: {
          before: async (user) => {
            if (user.email && isMessagingEmail(user.email)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not available" });
            }
          },
        },
      },
    },
  });
}

export function otpEmail(email: string, otp: string): TransactionalEmail {
  const safeOtp = escapeHtml(otp);
  return {
    to: email,
    subject: `${BRAND_NAME} sign-in code: ${otp}`,
    text: `Your ${BRAND_NAME} sign-in code is:\n\n${otp}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.`,
    html: `<p>Your ${BRAND_NAME} sign-in code is:</p><p><strong style="font-size:20px;letter-spacing:4px;">${safeOtp}</strong></p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export type Auth = ReturnType<typeof createAuth>;

/** Assemble Better Auth trustedOrigins, adding localhost↔127.0.0.1 twins for loopback. */
export function buildTrustedOrigins(env: Pick<AuthEnv, "webOrigin" | "baseURL" | "extraOrigins">) {
  const configured = [env.webOrigin, env.baseURL, ...(env.extraOrigins ?? [])];
  const twins = [env.webOrigin, env.baseURL].flatMap(loopbackTwinOrigins);
  return [...new Set([...configured, ...twins])];
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/** Same-scheme/port localhost and 127.0.0.1 variants when `origin` is loopback. */
function loopbackTwinOrigins(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (!isLoopbackHost(url.hostname)) return [];
    const twins: string[] = [];
    for (const host of ["localhost", "127.0.0.1"] as const) {
      if (host === url.hostname) continue;
      const twin = new URL(origin);
      twin.hostname = host;
      twins.push(twin.origin);
    }
    return twins;
  } catch {
    return [];
  }
}

export const blockedAuthPaths = [
  "/organization/create",
  "/organization/invite",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
];
