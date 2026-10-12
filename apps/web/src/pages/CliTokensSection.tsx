import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

type CliTokenRow = Awaited<ReturnType<typeof rpc.cliTokens.list>>[number];

/** Account settings panel: CLI tokens issued via `rakazo login` (007). */
export function CliTokensSection() {
  const { t } = useLingui();
  const [tokens, setTokens] = useState<CliTokenRow[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await rpc.cliTokens.list());
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await rpc.cliTokens.revoke({ id });
      await load();
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="rounded-xl border border-border px-4 py-4">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>CLI tokens</Trans>
      </h3>
      <p className="mt-3 text-[13px] text-muted-foreground/70">
        <Trans>Terminals authorized with `rakazo login`. Revoke to cut access immediately.</Trans>
      </p>
      {tokens === null ? null : tokens.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          <Trans>None yet.</Trans>
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-foreground">
                  {token.name}
                  {token.revokedAt ? (
                    <span className="ml-2 text-muted-foreground">
                      <Trans>revoked</Trans>
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {t`Added ${new Date(token.createdAt).toLocaleDateString()}`}
                  {token.lastUsedAt
                    ? t` · last used ${new Date(token.lastUsedAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              {token.revokedAt ? null : (
                <Button
                  variant="secondary"
                  className="shrink-0 rounded-full"
                  disabled={revoking === token.id}
                  onClick={() => void revoke(token.id)}
                >
                  {revoking === token.id ? t`Revoking…` : t`Revoke`}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
