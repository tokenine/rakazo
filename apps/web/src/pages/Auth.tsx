import { Trans, useLingui } from "@lingui/react/macro";
import { BRAND_NAME } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import { Button, Input, Label } from "@rakazo/ui-web";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { clearSpaceSelection, rpc } from "../lib/rpc";

type AuthCapabilities = { otp: boolean };

const fieldClass = "mt-2 h-12 rounded-xl px-4 text-base md:text-base";
const submitClass = "mt-3 h-12 w-full rounded-xl text-base";
const AUTH_CAPABILITIES_TIMEOUT_MS = 8_000;
const MAX_AUTH_CAPABILITIES_RESPONSE_BYTES = 64 * 1024;

/**
 * The pending code stage survives tab switches: browsers may discard and
 * reload a backgrounded tab (Memory Saver) while the user checks their inbox,
 * and returning must land back on the code entry with the email prefilled.
 * TTL mirrors the server's 10-minute OTP expiry; closing the tab clears it.
 */
const AUTH_OTP_STAGE_KEY = "rakazo.auth.otp-stage";
const AUTH_OTP_STAGE_TTL_MS = 10 * 60_000;

interface StoredOtpStage {
  email: string;
  at: number;
}

function readStoredOtpStage(): StoredOtpStage | null {
  try {
    const raw = sessionStorage.getItem(AUTH_OTP_STAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOtpStage> | null;
    if (!parsed || typeof parsed.email !== "string" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > AUTH_OTP_STAGE_TTL_MS) {
      sessionStorage.removeItem(AUTH_OTP_STAGE_KEY);
      return null;
    }
    return { email: parsed.email, at: parsed.at };
  } catch {
    return null;
  }
}

function clearStoredOtpStage(): void {
  try {
    sessionStorage.removeItem(AUTH_OTP_STAGE_KEY);
  } catch {
    // Storage unavailable; clearing is best-effort.
  }
}

export function AuthPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Restored once per mount: a discarded/reloaded tab comes back on the code
  // stage with the email prefilled instead of restarting at the email form.
  const restoredStage = useMemo(() => readStoredOtpStage(), []);
  const [email, setEmail] = useState(restoredStage?.email ?? "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">(restoredStage ? "code" : "email");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  const title =
    stage === "code" ? <Trans>Check your email</Trans> : <Trans>Sign in to {BRAND_NAME}</Trans>;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_CAPABILITIES_TIMEOUT_MS);
    void fetch("/api/auth/capabilities", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load authentication capabilities");
        return readBoundedJsonResponse<AuthCapabilities>(
          response,
          MAX_AUTH_CAPABILITIES_RESPONSE_BYTES,
          controller.signal,
        );
      })
      .then((loaded) => {
        if (active) setCapabilities(loaded);
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => {
      // Do not abort on unmount: a guard redirect that bounces through this
      // page only mounts it for a render or two, and the cancelled fetch then
      // surfaces as a failed request. `active` drops the result and the timer
      // keeps its bound — abort() on an already settled fetch is a no-op.
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (stage === "email") {
        const result = await authClient.emailOtp.sendVerificationOtp({
          email: email.trim(),
          type: "sign-in",
        });
        if (result.error) {
          setError(result.error.message ?? t`Could not send the sign-in code`);
          return;
        }
        try {
          sessionStorage.setItem(
            AUTH_OTP_STAGE_KEY,
            JSON.stringify({ email: email.trim(), at: Date.now() } satisfies StoredOtpStage),
          );
        } catch {
          // Storage unavailable; the stage just won't survive a reload.
        }
        setStage("code");
        return;
      }
      const result = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: code.trim(),
      });
      if (result.error) {
        setError(result.error.message ?? t`Could not verify the code`);
        return;
      }
      clearStoredOtpStage();
      clearSpaceSelection();
      // First-run users (no model credential anywhere) are sent through
      // onboarding; everyone else lands where they were heading.
      let destination =
        searchParams.get("next") === "/integrations/setup" ? "/integrations/setup" : "/app";
      if (destination === "/app") {
        try {
          const bootstrap = await rpc.bootstrap({});
          if (bootstrap.me.needsModel) destination = "/onboarding";
        } catch {
          // Keep the plain /app destination rather than blocking sign-in.
        }
      }
      navigate(destination);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame onSubmit={submit} title={title}>
      {capabilities && !capabilities.otp ? (
        <>
          <p role="alert" className="w-full text-sm text-destructive">
            <Trans>
              This server does not have email delivery configured, so sign-in codes cannot be sent.
              Ask the server owner to configure email delivery.
            </Trans>
          </p>
          <p className="mt-8 text-muted-foreground">
            <Link to="/" className="font-medium text-foreground">
              <Trans>Back to home</Trans>
            </Link>
          </p>
        </>
      ) : (
        <>
          <div className="w-full">
            <Label htmlFor="email" className="text-muted-foreground">
              <Trans>Email</Trans>
            </Label>
            <Input
              id="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t`Your email address`}
              type="email"
              required
              readOnly={stage === "code"}
              className={fieldClass}
            />
          </div>
          {stage === "code" ? (
            <>
              <div className="mt-4 w-full">
                <Label htmlFor="otp" className="text-muted-foreground">
                  <Trans>Sign-in code</Trans>
                </Label>
                <Input
                  id="otp"
                  name="otp"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={t`6-digit code`}
                  required
                  autoFocus
                  className={`${fieldClass} text-center text-2xl tracking-[0.5em]`}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  clearStoredOtpStage();
                  setStage("email");
                  setCode("");
                  setError(null);
                }}
                className="mt-2 text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                <Trans>Use a different email</Trans>
              </button>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 w-full text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending} className={submitClass}>
            {pending ? (
              <Trans>Working…</Trans>
            ) : stage === "email" ? (
              <Trans>Continue with email</Trans>
            ) : (
              <Trans>Verify code</Trans>
            )}
          </Button>
        </>
      )}
    </AuthFrame>
  );
}

function AuthFrame({
  title,
  onSubmit,
  children,
}: {
  title: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-16 text-foreground">
      <form onSubmit={onSubmit} className="flex w-[460px] flex-col items-center">
        <img
          src="/favicon-ai7.svg"
          alt="Ai7"
          className="h-[78px] w-[78px] drop-shadow-[0_10px_24px_rgba(249,115,22,0.3)]"
        />
        <h1 aria-live="polite" className="mb-9 mt-7 text-4xl font-medium tracking-tight">
          {title}
        </h1>
        {children}
      </form>
    </div>
  );
}
