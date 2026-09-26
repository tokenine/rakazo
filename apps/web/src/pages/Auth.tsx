import { Trans, useLingui } from "@lingui/react/macro";
import { BRAND_NAME } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import { Button, Input, Label } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { clearSpaceSelection } from "../lib/rpc";

type AuthMode = "in" | "up";
type AuthCapabilities = { otp: boolean };

const fieldClass = "mt-2 h-12 rounded-xl px-4 text-base md:text-base";
const submitClass = "mt-3 h-12 w-full rounded-xl text-base";
const AUTH_CAPABILITIES_TIMEOUT_MS = 8_000;
const MAX_AUTH_CAPABILITIES_RESPONSE_BYTES = 64 * 1024;

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  const title =
    stage === "code" ? (
      <Trans>Check your email</Trans>
    ) : mode === "up" ? (
      <Trans>Create your {BRAND_NAME}</Trans>
    ) : (
      <Trans>Sign in to {BRAND_NAME}</Trans>
    );

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
      active = false;
      clearTimeout(timer);
      controller.abort();
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
        setStage("code");
        return;
      }
      const result = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: code.trim(),
        // New accounts pick up the display name here; existing users are unaffected.
        ...(mode === "up" && name.trim() ? { name: name.trim() } : {}),
      });
      if (result.error) {
        setError(result.error.message ?? t`Could not verify the code`);
        return;
      }
      clearSpaceSelection();
      navigate(
        mode === "up"
          ? "/onboarding"
          : searchParams.get("next") === "/integrations/setup"
            ? "/integrations/setup"
            : "/app",
      );
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
          {stage === "email" && mode === "up" ? (
            <div className="mb-4 w-full">
              <Label htmlFor="name" className="text-muted-foreground">
                <Trans>Name</Trans>
              </Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t`Your name`}
                className={fieldClass}
              />
            </div>
          ) : null}
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
          <p className="mt-8 text-muted-foreground">
            {mode === "in" ? (
              <>
                <Trans>Don’t have an account?</Trans>{" "}
                <Link to="/sign-up" className="font-medium text-foreground">
                  <Trans>Sign up</Trans>
                </Link>
              </>
            ) : (
              <>
                <Trans>Already have an account?</Trans>{" "}
                <Link to="/sign-in" className="font-medium text-foreground">
                  <Trans>Sign in</Trans>
                </Link>
              </>
            )}
          </p>
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
