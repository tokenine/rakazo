import { Trans, useLingui } from "@lingui/react/macro";
import type { AvatarStyle, WalletOverview } from "@rakazo/contracts";
import { BotAvatar, Button, Input, Label, Switch, Toggle } from "@rakazo/ui-web";
import { ChevronDown } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { ComputersUnavailableHint } from "../components/ComputersUnavailableHint";
import { DesktopUpdateSection } from "../components/DesktopUpdates";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import {
  getResponseStreamingPreference,
  setResponseStreamingPreference,
} from "../lib/response-streaming";
import { rpc } from "../lib/rpc";
import {
  type AppearancePreference,
  getUiAppearancePreference,
  setUiAppearance,
} from "../lib/ui-appearance";
import { UI_LOCALE_LABELS, UI_LOCALES, type UiLocale } from "../lib/ui-locale";

export type SettingsGeneralProps = {
  email?: string | null;
  name: string;
  onNameChange: (name: string) => Promise<void>;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  isDeploymentOwner?: boolean;
  /** Desktop app only: force bots into the client Browser pane (client_js). */
  clientBrowserPreferred?: boolean;
  onClientBrowserPreferredChange?: (value: boolean) => Promise<void>;
};

export function GeneralSettingsPanels({
  email,
  name,
  onNameChange,
  avatarStyle,
  onAvatarStyleChange,
  messagingEnabled = false,
  onOpenMessaging,
  isDeploymentOwner = false,
  clientBrowserPreferred = false,
  onClientBrowserPreferredChange,
}: SettingsGeneralProps) {
  const { t } = useLingui();
  const [locale, setLocale] = useState<UiLocale>(() => getActiveUiLocale());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const [streamReplies, setStreamReplies] = useState(
    () => getResponseStreamingPreference() === "on",
  );
  const streamRepliesId = useId();
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [browserPending, setBrowserPending] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(name);
  const [editingName, setEditingName] = useState(false);
  const [namePending, setNamePending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    const next = nameDraft.trim();
    if (!next || namePending) return;
    setNamePending(true);
    setNameError(null);
    try {
      await onNameChange(next);
      setEditingName(false);
    } catch {
      setNameError(t`Couldn't update your name`);
    } finally {
      setNamePending(false);
    }
  }

  async function chooseClientBrowser(value: boolean) {
    if (browserPending || !onClientBrowserPreferredChange) return;
    setBrowserPending(true);
    setBrowserError(null);
    try {
      await onClientBrowserPreferredChange(value);
    } catch {
      setBrowserError(t`Couldn't update the built-in browser setting`);
    } finally {
      setBrowserPending(false);
    }
  }

  function chooseLocale(next: UiLocale) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(activated);
    });
  }

  async function chooseAvatarStyle(next: AvatarStyle) {
    if (avatarPending || next === avatarStyle) return;
    setAvatarPending(true);
    setAvatarError(null);
    try {
      await onAvatarStyleChange(next);
    } catch {
      setAvatarError(t`Couldn't update avatars`);
    } finally {
      setAvatarPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border px-4 py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Account</Trans>
        </h3>
        {editingName ? (
          <form onSubmit={saveName} className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={t`Your name`}
              autoFocus
              autoComplete="name"
              maxLength={64}
              data-testid="account-name-input"
              className="h-9 max-w-[240px] flex-1 rounded-lg"
            />
            <Button
              type="submit"
              size="sm"
              className="rounded-full"
              disabled={namePending || !nameDraft.trim()}
            >
              <Trans>Save</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setEditingName(false);
                setNameDraft(name);
                setNameError(null);
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
          </form>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] text-foreground/75">{name || t`You`}</p>
              {email ? <p className="mt-1 text-[13px] text-muted-foreground/70">{email}</p> : null}
            </div>
            <Button
              variant="secondary"
              className="rounded-full"
              data-testid="account-name-edit"
              onClick={() => {
                setNameDraft(name);
                setEditingName(true);
              }}
            >
              <Trans>Edit</Trans>
            </Button>
          </div>
        )}
        {nameError ? (
          <p role="alert" className="mt-2 text-[12.5px] text-destructive">
            {nameError}
          </p>
        ) : null}
      </section>

      {onClientBrowserPreferredChange ? (
        <section
          className="rounded-xl border border-border px-4 py-4"
          data-testid="built-in-browser-setting"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium text-foreground">
                <Trans>Built-in browser</Trans>
              </h3>
              <p className="mt-1 text-[12.5px] text-muted-foreground/80">
                <Trans>
                  Bots work in this app's Browser pane with your own logins (TikTok, Facebook, …)
                  and cannot use their own computer's browser.
                </Trans>
              </p>
            </div>
            <Switch
              checked={clientBrowserPreferred}
              disabled={browserPending}
              onCheckedChange={(value) => void chooseClientBrowser(value)}
              aria-label={t`Built-in browser`}
            />
          </div>
          {browserError ? (
            <p role="alert" className="mt-3 text-[12.5px] text-destructive">
              {browserError}
            </p>
          ) : null}
        </section>
      ) : null}

      {messagingEnabled && onOpenMessaging ? (
        <section className="rounded-xl border border-border px-4 py-4">
          <h3 className="text-[15px] font-medium text-foreground">
            <Trans>Messaging</Trans>
          </h3>
          <p className="mt-3 text-[13px] text-muted-foreground/70">
            <Trans>Chat apps, group channels, and agent connections.</Trans>
          </p>
          <Button variant="secondary" className="mt-3 rounded-full" onClick={onOpenMessaging}>
            <Trans>Manage messaging settings</Trans>
          </Button>
        </section>
      ) : null}

      <section className="rounded-xl border border-border px-4 py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Appearance</Trans>
        </h3>
        <AppearancePicker
          value={appearance}
          onChange={(next) => {
            setAppearance(next);
            setUiAppearance(next);
          }}
        />
      </section>

      <section className="rounded-xl border border-border px-4 py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Language</Trans>
        </h3>
        <UiLocalePicker value={locale} onChange={chooseLocale} />
      </section>

      <section
        className="rounded-xl border border-border px-4 py-4"
        data-testid="avatar-style-select"
      >
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Avatars</Trans>
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(["robot", "organic"] as const).map((style) => (
            <Toggle
              key={style}
              variant="outline"
              pressed={style === avatarStyle}
              disabled={avatarPending}
              onPressedChange={() => void chooseAvatarStyle(style)}
              data-testid={`avatar-style-${style}`}
              className="h-auto justify-start gap-3 px-3.5 py-3 text-[14px] font-normal"
            >
              <BotAvatar
                color="#D9508A"
                identity="avatar-style-preview"
                size={32}
                variant={style}
              />
              <span>{style === "robot" ? <Trans>Robot</Trans> : <Trans>Organic</Trans>}</span>
            </Toggle>
          ))}
        </div>
        {avatarError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-destructive">
            {avatarError}
          </p>
        ) : null}
      </section>

      {isDeploymentOwner ? (
        <Button variant="outline" render={<Link to="/integrations/setup" />}>
          <Trans>Server integrations</Trans>
        </Button>
      ) : null}

      <details data-testid="advanced-settings" className="group rounded-xl border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-[14px] text-foreground/75">
          <span>
            <span className="block text-[15px] text-foreground">
              <Trans>Advanced</Trans>
            </span>
            <span className="mt-1 block text-[12.5px] text-muted-foreground/80">
              <Trans>Optional controls most people never need</Trans>
            </span>
          </span>
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="border-t border-border px-4 pb-5">
          <div className="flex items-start gap-3 pt-5">
            <Switch
              id={streamRepliesId}
              data-testid="response-streaming-toggle"
              className="mt-0.5"
              checked={streamReplies}
              onCheckedChange={(checked) => {
                setStreamReplies(checked);
                setResponseStreamingPreference(checked ? "on" : "off");
              }}
            />
            <Label htmlFor={streamRepliesId} className="text-[14px] font-normal text-foreground/75">
              <Trans>Stream replies</Trans>
            </Label>
          </div>
          <ApprovalRulesSettings />
        </div>
      </details>
    </div>
  );
}

function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

interface PairingState {
  pending: boolean;
  pairingUrl: string | null;
  error: string | null;
}

export function WalletSettingsPanel() {
  const { t } = useLingui();
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pairing, setPairing] = useState<Record<string, PairingState>>({});

  async function refresh() {
    setRefreshing(true);
    setLoadError(null);
    try {
      setOverview(await rpc.wallet.get({}));
    } catch {
      setLoadError(t`Couldn't load wallet information`);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startPairing(botId: string) {
    if (pairing[botId]?.pending) return;
    setPairing((current) => ({
      ...current,
      [botId]: { pending: true, pairingUrl: current[botId]?.pairingUrl ?? null, error: null },
    }));
    try {
      const result = await rpc.wallet.pair({ botId });
      setPairing((current) => ({
        ...current,
        [botId]: {
          pending: false,
          pairingUrl: result.pairingUrl,
          error: result.pairingUrl
            ? null
            : t`The pairing link did not appear in time — try again or ask the bot in its chat.`,
        },
      }));
    } catch (error) {
      setPairing((current) => ({
        ...current,
        [botId]: {
          pending: false,
          pairingUrl: current[botId]?.pairingUrl ?? null,
          error:
            error instanceof Error && error.message
              ? error.message
              : t`Couldn't start the pairing on the bot's computer`,
        },
      }));
    }
  }

  return (
    <div className="space-y-5" data-testid="wallet-settings">
      <section className="rounded-xl border border-border px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium text-foreground">
              <Trans>Agent wallets</Trans>
            </h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground/80">
              <Trans>Each bot keeps its own ThaiFi wallet on its computer.</Trans>
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 rounded-full"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <Trans>Refresh</Trans>
          </Button>
        </div>
        {loadError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-destructive">
            {loadError}
          </p>
        ) : !overview ? (
          <p className="mt-3 text-[13px] text-muted-foreground/70">
            <Trans>Loading…</Trans>
          </p>
        ) : overview.agentWallets.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground/70">
            <Trans>Create a bot and start its computer to give it a wallet.</Trans>
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {overview.agentWallets.map((entry) => {
              const pair = pairing[entry.botId];
              const pairable = entry.state === "unpaired" || entry.state === "expired";
              return (
                <li key={entry.botId} className="rounded-lg border border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[14px] font-medium text-foreground">
                      {entry.botName}
                    </span>
                    {entry.state === "ready" ? (
                      <a
                        href={`${overview.explorerUrl}/address/${entry.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {shortAddress(entry.address)}
                      </a>
                    ) : entry.state === "unpaired" ? (
                      <span className="shrink-0 text-[12.5px] text-muted-foreground">
                        <Trans>Not paired</Trans>
                      </span>
                    ) : entry.state === "expired" ? (
                      <span className="shrink-0 text-[12.5px] text-muted-foreground">
                        <Trans>Key expired</Trans>
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12.5px] text-muted-foreground">
                        <Trans>Computer is off</Trans>
                      </span>
                    )}
                  </div>
                  {entry.state === "ready" ? (
                    <>
                      <dl className="mt-2 grid grid-cols-3 gap-2">
                        {entry.balances.map((balance) => (
                          <div key={balance.symbol}>
                            <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                              {balance.symbol}
                            </dt>
                            <dd className="text-[14px] text-foreground">{balance.formatted}</dd>
                          </div>
                        ))}
                      </dl>
                      {entry.error ? (
                        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
                          {entry.error}
                        </p>
                      ) : null}
                    </>
                  ) : pairable ? (
                    <div className="mt-2">
                      {entry.state === "expired" ? (
                        <p className="text-[12.5px] text-muted-foreground">
                          <Trans>
                            The wallet key expired — pair again to let this bot spend on-chain.
                          </Trans>
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="rounded-full"
                          disabled={pair?.pending}
                          onClick={() => void startPairing(entry.botId)}
                        >
                          {pair?.pending ? <Trans>Starting…</Trans> : <Trans>Start pairing</Trans>}
                        </Button>
                        <span className="text-[12.5px] text-muted-foreground">
                          <Trans>
                            or ask the bot in its chat to run thaifi login — the newest link wins.
                          </Trans>
                        </span>
                      </div>
                      {pair?.pairingUrl ? (
                        <p className="mt-2 text-[12.5px]">
                          <Trans>Approve with passkey/PIN:</Trans>{" "}
                          <a
                            href={pair.pairingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all font-medium text-foreground underline-offset-2 hover:underline"
                          >
                            {pair.pairingUrl}
                          </a>
                        </p>
                      ) : null}
                      {pair?.pairingUrl ? (
                        <p className="mt-1 text-[12.5px] text-muted-foreground">
                          <Trans>After approving, press Refresh to see the balance.</Trans>
                        </p>
                      ) : null}
                      {pair?.error ? (
                        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
                          {pair.error}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-[12px] text-muted-foreground/70">
        <Trans>ThaiFi chain · Chain ID 17</Trans>
      </p>
    </div>
  );
}

export function UsageSettingsPanel({
  usage,
  panelRef,
}: {
  usage?: { runs: number; inputTokens: number; outputTokens: number } | null;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-testid="usage-settings"
      className="rounded-xl border border-border px-4 py-4 outline-none"
    >
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Usage</Trans>
      </h3>
      {usage ? (
        <p className="mt-3 text-[14px] text-foreground/75">
          <Trans>
            {usage.runs} runs · {usage.inputTokens + usage.outputTokens} tokens
          </Trans>
        </p>
      ) : null}
      <p className={`text-[12.5px] text-muted-foreground/80 ${usage ? "mt-2" : "mt-3"}`}>
        <Trans>Model spend uses your provider keys.</Trans>
      </p>
    </div>
  );
}

export function ComputerSettingsPanel() {
  return (
    <div
      data-testid="computers-setup-settings"
      className="rounded-xl border border-border px-4 py-4"
    >
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Computers</Trans>
      </h3>
      <ComputersUnavailableHint className="mt-3 text-[13px] leading-relaxed text-muted-foreground" />
    </div>
  );
}

export function UpdatesSettingsPanel({
  isDeploymentOwner = false,
}: {
  isDeploymentOwner?: boolean;
}) {
  return (
    <div className="space-y-5">
      <DesktopUpdateSection />
      <SoftwareUpdateSection isDeploymentOwner={isDeploymentOwner} />
    </div>
  );
}

function AppearancePicker({
  value,
  onChange,
}: {
  value: AppearancePreference;
  onChange: (next: AppearancePreference) => void;
}) {
  const { t } = useLingui();
  const options: { value: AppearancePreference; label: string }[] = [
    { value: "system", label: t`System` },
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
  ];

  return (
    <fieldset
      aria-label={t`Appearance`}
      data-testid="ui-appearance-select"
      className="mt-3 grid min-w-0 grid-cols-3 gap-1 rounded-lg bg-muted p-1"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          data-testid={`ui-appearance-${option.value}`}
          pressed={option.value === value}
          onPressedChange={() => onChange(option.value)}
          className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          {option.label}
        </Toggle>
      ))}
    </fieldset>
  );
}

function UiLocalePicker({
  value,
  onChange,
}: {
  value: UiLocale;
  onChange: (locale: UiLocale) => void;
}) {
  const { t } = useLingui();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = Math.max(0, UI_LOCALES.indexOf(value));
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);

  useEffect(() => {
    setHighlightedIndex(selectedIndex);
    setOpen(false);
  }, [selectedIndex, value]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlightedIndex]?.focus();
  }, [highlightedIndex, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function choose(index: number) {
    const next = UI_LOCALES[index];
    if (!next) return;
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(index: number) {
    setHighlightedIndex((index + UI_LOCALES.length) % UI_LOCALES.length);
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex(UI_LOCALES.length - 1);
    }
  }

  function onOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(UI_LOCALES.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative mt-3">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        data-testid="ui-locale-select"
        aria-label={t`Language`}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-start text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="min-w-0 truncate">{UI_LOCALE_LABELS[value]}</span>
        <span className="ml-3 shrink-0 text-muted-foreground" aria-hidden="true">
          <ChevronDown size={16} strokeWidth={1.8} />
        </span>
      </button>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t`Language`}
          className="rk-scroll absolute left-0 right-0 top-full z-20 mt-1 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {UI_LOCALES.map((code, index) => (
            <button
              key={code}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={code === value}
              tabIndex={index === highlightedIndex ? 0 : -1}
              className={`w-full rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent ${
                code === value ? "bg-accent" : ""
              }`}
              onClick={() => choose(index)}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
            >
              {UI_LOCALE_LABELS[code]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
