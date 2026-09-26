import { Trans, useLingui } from "@lingui/react/macro";
import type { AvatarStyle, SpaceMemoryConfig } from "@rakazo/contracts";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Switch } from "@rakazo/ui-web";
import {
  Brain,
  CloudDownload,
  Cpu,
  Gauge,
  Monitor,
  Settings,
  UserPlus,
  Volume2,
  XIcon,
} from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { computersAreUnavailable } from "../components/ComputersUnavailableHint";
import { rpc } from "../lib/rpc";
import {
  ComputerSettingsPanel,
  GeneralSettingsPanels,
  UpdatesSettingsPanel,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

export type SettingsSection =
  | "general"
  | "signups"
  | "models"
  | "memory"
  | "voice"
  | "usage"
  | "computer"
  | "updates";

type NavItem = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export function SettingsOverlay({
  email,
  name,
  usage,
  initialSection = "general",
  avatarStyle,
  onAvatarStyleChange,
  isDeploymentOwner = false,
  sandboxProvider,
  messagingEnabled = false,
  onOpenMessaging,
  memoryConfig,
  onMemoryConfigChange,
  onClose,
  onVoiceStatusMaybeChanged,
}: {
  email?: string | null;
  name: string;
  usage?: { runs: number; inputTokens: number; outputTokens: number } | null;
  initialSection?: SettingsSection;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  isDeploymentOwner?: boolean;
  sandboxProvider?: string | null;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  memoryConfig: SpaceMemoryConfig | null | undefined;
  onMemoryConfigChange: (config: SpaceMemoryConfig | null) => void;
  onClose: () => void;
  onVoiceStatusMaybeChanged?: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const panelRef = useRef<HTMLDivElement>(null);
  const usageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const showComputer = isDeploymentOwner && computersAreUnavailable(sandboxProvider);
  const panelBusy = memoryBusy || voiceBusy;

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (section === "usage") {
      usageRef.current?.focus();
    }
  }, [section]);

  const navItems: NavItem[] = [
    { id: "general", label: t`General`, icon: Settings },
    { id: "models", label: t`Models`, icon: Cpu },
    { id: "memory", label: t`Memory`, icon: Brain },
    { id: "voice", label: t`Voice`, icon: Volume2 },
    { id: "usage", label: t`Usage`, icon: Gauge },
    ...(showComputer ? [{ id: "computer" as const, label: t`Computer`, icon: Monitor }] : []),
    ...(isDeploymentOwner ? [{ id: "signups" as const, label: t`Sign-ups`, icon: UserPlus }] : []),
    { id: "updates", label: t`Updates`, icon: CloudDownload },
  ];

  const sectionTitle =
    navItems.find((item) => item.id === section)?.label ??
    (section === "general" ? t`General` : t`Settings`);

  const closeLabel =
    section === "models"
      ? t`Close model settings`
      : section === "memory"
        ? t`Close memory settings`
        : section === "voice"
          ? t`Close voice settings`
          : t`Close user settings`;

  async function refreshVoiceStatus() {
    await onVoiceStatusMaybeChanged?.();
  }

  function leaveSettings(next: () => void) {
    if (panelBusy) return;
    void refreshVoiceStatus().finally(next);
  }

  function requestClose() {
    leaveSettings(onClose);
  }

  const widePane = section === "models" || section === "voice";

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (panelBusy) {
          details.cancel();
          return;
        }
        requestClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        data-testid="user-settings"
        data-settings-section={section}
        showCloseButton={false}
        initialFocus={() =>
          section === "usage" ? (usageRef.current ?? panelRef.current) : panelRef.current
        }
        className={`flex max-h-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100%-5rem)] ${
          widePane
            ? "h-[min(760px,calc(100%-2rem))] w-[min(1080px,calc(100%-2rem))] sm:max-w-[1080px]"
            : "h-[min(720px,calc(100%-2rem))] w-[min(920px,calc(100%-2rem))] sm:max-w-[920px]"
        }`}
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            data-testid="settings-nav"
            aria-label={t`Settings`}
            className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border px-3 py-3 md:w-[200px] md:flex-col md:overflow-y-auto md:border-b-0 md:border-e md:px-3 md:py-4"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`settings-nav-${item.id}`}
                  aria-current={active ? "page" : undefined}
                  disabled={panelBusy}
                  onClick={() => setSection(item.id)}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-7">
              <DialogTitle className="text-2xl font-medium text-foreground">
                {sectionTitle}
              </DialogTitle>
              <DialogClose
                aria-label={closeLabel}
                disabled={panelBusy}
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
              </DialogClose>
            </div>

            <div
              className={`min-h-0 flex-1 ${
                section === "models" || section === "voice" || section === "memory"
                  ? "flex flex-col overflow-hidden"
                  : "rk-scroll overflow-y-auto overscroll-contain px-6 pb-6 pt-5 sm:px-8 sm:pb-8"
              }`}
            >
              {section === "general" ? (
                <GeneralSettingsPanels
                  email={email}
                  name={name}
                  avatarStyle={avatarStyle}
                  onAvatarStyleChange={onAvatarStyleChange}
                  messagingEnabled={messagingEnabled}
                  onOpenMessaging={
                    onOpenMessaging ? () => leaveSettings(onOpenMessaging) : undefined
                  }
                  isDeploymentOwner={isDeploymentOwner}
                />
              ) : null}
              {section === "usage" ? (
                <UsageSettingsPanel usage={usage} panelRef={usageRef} />
              ) : null}
              {section === "computer" && showComputer ? <ComputerSettingsPanel /> : null}
              {section === "signups" && isDeploymentOwner ? <SignupsSettingsPanel /> : null}
              {section === "updates" ? (
                <UpdatesSettingsPanel isDeploymentOwner={isDeploymentOwner} />
              ) : null}
              {section === "models" ? (
                <ModelSettingsOverlay embedded onClose={requestClose} />
              ) : null}
              {section === "memory" ? (
                <MemorySettingsOverlay
                  embedded
                  onClose={requestClose}
                  config={memoryConfig}
                  onConfigChange={onMemoryConfigChange}
                  onBusyChange={setMemoryBusy}
                />
              ) : null}
              {section === "voice" ? (
                <VoiceSettingsOverlay embedded onClose={requestClose} onBusyChange={setVoiceBusy} />
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deployment-owner signup policy: toggle open sign-ups and edit the
 * allowlist. Entries are full emails (exact) or `@domain.com` to admit a
 * whole mail domain — the same list powers demo whitelisting and
 * per-customer domain licensing.
 */
function SignupsSettingsPanel() {
  const { t } = useLingui();
  const [enabled, setEnabled] = useState(true);
  const [allowlist, setAllowlist] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.deployment
      .get()
      .then((settings) => {
        setEnabled(settings.signupsEnabled);
        setAllowlist(settings.signupAllowlist.join("\n"));
        setLoaded(true);
      })
      .catch(() => setError(t`Could not load sign-up settings`));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const entries = allowlist
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const updated = await rpc.deployment.update({
        signupsEnabled: enabled,
        signupAllowlist: entries,
      });
      setEnabled(updated.signupsEnabled);
      setAllowlist(updated.signupAllowlist.join("\n"));
      setSaved(true);
    } catch {
      setError(t`Could not save sign-up settings`);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <p className="text-[13.5px] text-muted-foreground/70">{error ?? t`Loading…`}</p>;
  }
  return (
    <div data-testid="signups-settings" className="max-w-[560px] space-y-5">
      <p className="text-[13.5px] leading-6 text-muted-foreground/80">
        <Trans>
          Control who can create an account. Entries are exact emails, or `@company.com` to admit
          everyone on that mail domain — leave empty to allow anyone.
        </Trans>
      </p>
      <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
        <div>
          <div className="text-[14px] font-medium text-foreground">
            <Trans>Open sign-ups</Trans>
          </div>
          <div className="text-[12.5px] text-muted-foreground/70">
            <Trans>When off, only existing accounts can sign in.</Trans>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <label className="block text-[14px] text-muted-foreground">
        <Trans>Allowlist</Trans>
        <textarea
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
          rows={7}
          placeholder={"dome@company.com\n@customer-domain.com"}
          className="mt-2 w-full rounded-xl border border-border bg-transparent px-3 py-2.5 font-mono text-[13px] text-foreground outline-none focus:border-foreground/40"
        />
      </label>
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      {saved ? <p className="text-[13px] text-success">{t`Saved.`}</p> : null}
      <Button disabled={saving} onClick={() => void save()}>
        {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
      </Button>
    </div>
  );
}
