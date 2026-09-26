import { Trans } from "@lingui/react/macro";
import { useNavigate } from "react-router-dom";
import { WindowChrome } from "./WindowChrome";

/**
 * Landing page — Ai7 brand hero: flame lockup on a warm gradient, brand
 * tagline, single call to action. Lockup art swaps with the app theme.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div
      className="relative flex min-h-full flex-col overflow-hidden bg-background"
      data-rakazo-surface="welcome"
    >
      <style>{`[data-theme="dark"] .ai7-lockup-light{display:none}[data-theme="light"] .ai7-lockup-dark{display:none}`}</style>
      {/* warm brand glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(52% 42% at 50% 0%, rgba(249,115,22,0.22), transparent 70%), radial-gradient(38% 30% at 82% 78%, rgba(244,63,94,0.12), transparent 70%), radial-gradient(36% 30% at 14% 72%, rgba(250,204,21,0.12), transparent 70%)",
        }}
      />
      <div className="app-drag relative flex gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <div className="relative flex flex-1 flex-col items-center justify-center gap-9 pb-[80px]">
        <img
          src="/brand/ai7-lockup-light.svg"
          alt="Ai7 — AI-Powered Workforce"
          className="ai7-lockup-light h-[300px] w-auto max-w-[86vw] drop-shadow-[0_18px_40px_rgba(249,115,22,0.28)]"
        />
        <img
          src="/brand/ai7-lockup-dark.svg"
          alt="Ai7 — AI-Powered Workforce"
          className="ai7-lockup-dark h-[300px] w-auto max-w-[86vw] drop-shadow-[0_18px_44px_rgba(249,115,22,0.4)]"
        />
        <p className="max-w-[620px] text-center text-[26px] leading-[1.4] text-foreground/75">
          <Trans>
            Your team of always-on agents
            <br />
            that you can give real work to.
          </Trans>
        </p>
        <button
          type="button"
          onClick={() => navigate("/sign-up")}
          className="app-no-drag rounded-full px-[36px] py-[15px] text-[19px] font-medium text-white shadow-lg shadow-orange-500/30 transition hover:scale-[1.04]"
          style={{ background: "linear-gradient(135deg, #FB923C, #F97316 45%, #EF4444)" }}
        >
          <Trans>Sign up</Trans>&nbsp;&nbsp;→
        </button>
      </div>
    </div>
  );
}
