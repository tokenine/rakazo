import { Trans, useLingui } from "@lingui/react/macro";
import type { BotSession } from "@rakazo/contracts";
import { Badge, Button, Input, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Compact session switcher inside the bot chat header (design decision for
 * 001: primary-first then last-activity ordering, unread badges, new/rename/
 * delete actions, semantic tokens only). Live updates arrive through the
 * session.* thread events; the parent refreshes `sessions` on them.
 */
export function SessionSwitcher({
  activeThreadId,
  sessions,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  activeThreadId: string | null | undefined;
  sessions: BotSession[];
  onSelect: (sessionId: string) => void;
  /** Called after navigation so Shell can refresh the list. */
  onCreate: (createdSession: BotSession) => void;
  onRename: (sessionId: string, name: string) => void;
  onDelete: (session: BotSession) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const active =
    sessions.find((session) => session.id === activeThreadId) ??
    (sessions.length > 0 ? (sessions.find((session) => session.isPrimary) ?? null) : null);
  const canDelete = sessions.length > 1;

  useEffect(() => {
    if (creating) nameInputRef.current?.focus();
  }, [creating]);

  const startRename = (session: BotSession) => {
    setRenamingId(session.id);
    setRenameValue(session.name ?? "");
    setConfirmingId(null);
  };

  const submitRename = (session: BotSession) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === (session.name ?? "")) {
      setRenamingId(null);
      return;
    }
    onRename(session.id, trimmed);
    setRenamingId(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="session-switcher-trigger"
            aria-label={t`Sessions`}
            className="app-no-drag flex h-7 max-w-[220px] shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-accent"
          />
        }
      >
        <span className="truncate" dir="auto">
          {active?.isPrimary ? (
            <Trans>Primary</Trans>
          ) : (
            (active?.name ?? <Trans>Sessions</Trans>)
          )}
        </span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <div
          role="listbox"
          aria-label={t`Sessions`}
          data-testid="session-switcher-list"
          className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
        >
          {sessions.map((session) => {
            const isActive = session.id === active?.id;
            return (
              <div
                key={session.id}
                className="group/session rounded-lg hover:bg-accent"
                data-testid="session-switcher-row"
                data-active={isActive ? "" : undefined}
              >
                {renamingId === session.id ? (
                  <div className="flex items-center gap-1.5 p-1.5">
                    <Input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") submitRename(session);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                      aria-label={t`Session name`}
                      className="h-7 flex-1 text-[13px]"
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t`Save name`}
                      data-testid="session-rename-save"
                      onClick={() => submitRename(session)}
                    >
                      <Check size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t`Cancel`}
                      onClick={() => setRenamingId(null)}
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-testid="session-switcher-option"
                      onClick={() => {
                        onSelect(session.id);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    >
                      <span
                        dir="auto"
                        className={`min-w-0 flex-1 truncate text-[13.5px] ${
                          isActive ? "font-medium text-foreground" : "text-foreground/80"
                        }`}
                      >
                        {session.name ?? (session.isPrimary ? t`Primary` : t`New session`)}
                      </span>
                      {session.isPrimary ? (
                        <Badge
                          variant="secondary"
                          className="rounded-full px-1.5 py-0 text-[10.5px] font-normal text-muted-foreground"
                        >
                          <Trans>Primary</Trans>
                        </Badge>
                      ) : null}
                      {session.unread ? (
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 shrink-0 rounded-full bg-foreground"
                        />
                      ) : null}
                      <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
                        {formatSessionTime(session.lastMessageAt ?? session.createdAt)}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover/session:opacity-100 focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={t`Rename session`}
                        data-testid="session-rename-trigger"
                        onClick={() => startRename(session)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </Button>
                      {confirmingId === session.id ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          aria-label={t`Confirm delete`}
                          data-testid="session-delete-confirm"
                          onClick={() => {
                            setConfirmingId(null);
                            onDelete(session);
                            setOpen(false);
                          }}
                        >
                          <Check size={13} aria-hidden="true" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={t`Delete session`}
                          data-testid="session-delete-trigger"
                          disabled={!canDelete}
                          title={canDelete ? undefined : t`The last session cannot be deleted`}
                          onClick={() => setConfirmingId(session.id)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {creating ? (
          <form
            className="flex items-center gap-1.5 border-t border-border p-1.5 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = newName.trim();
              if (!trimmed) return;
              onCreate({ id: "", name: trimmed } as BotSession);
              setNewName("");
              setCreating(false);
              setOpen(false);
            }}
          >
            <Input
              ref={nameInputRef}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t`Session name`}
              aria-label={t`Session name`}
              className="h-7 flex-1 text-[13px]"
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              aria-label={t`Create session`}
              data-testid="session-create-submit"
            >
              <Check size={14} aria-hidden="true" />
            </Button>
          </form>
        ) : (
          <button
            type="button"
            data-testid="session-create-trigger"
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setCreating(true)}
          >
            <Plus size={14} aria-hidden="true" />
            <Trans>New session</Trans>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Compact roster-style time for a session row: clock for today, date otherwise. */
function formatSessionTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
