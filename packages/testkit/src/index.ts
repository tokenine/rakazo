import { setTimeout as sleep } from "node:timers/promises";

import { EmailEmulator } from "@rakazo/adapters";

export { DestinationEmulator, McpEmulator } from "@rakazo/adapters";

export function sessionCookieHeader(response: Response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  return response.headers.get("set-cookie")?.split(",")[0]?.split(";")[0] ?? "";
}

/**
 * Sign up through the product's passwordless email-OTP flow and return the
 * session cookie header. `emails` must be the same EmailEmulator instance that
 * was passed to `createApp({ email })`, so the one-time code stays offline.
 */
export async function otpSignUp(
  app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
  emails: EmailEmulator,
  email: string,
  name?: string,
): Promise<string> {
  const send = await app.request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, type: "sign-in" }),
  });
  if (send.status >= 400) {
    throw new Error(`otp send failed ${send.status}: ${await send.text()}`);
  }
  const code = await otpCode(emails, email);
  const response = await app.request("/api/auth/sign-in/email-otp", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, otp: code, ...(name === undefined ? {} : { name }) }),
  });
  if (response.status >= 400) {
    throw new Error(`otp sign-in failed ${response.status}: ${await response.text()}`);
  }
  return sessionCookieHeader(response);
}

/** Newest 6-digit code emailed to `email`; polls briefly for async delivery. */
export async function otpCode(emails: EmailEmulator, email: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sent = [...emails.sent]
      .reverse()
      .find((message) => message.to.toLowerCase() === email.toLowerCase());
    const code = sent?.text.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    if (Date.now() >= deadline) throw new Error(`no OTP code captured for ${email}`);
    await sleep(10);
  }
}
