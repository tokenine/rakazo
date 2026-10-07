import { describe, expect, it, vi } from "vitest";
import { GOOGLE_CALLBACK_PATH, GoogleConnector, googleRedirectUri } from "./google-connector.js";

const CONTEXT = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
} as never;

function fakeSecrets() {
  return {
    put: vi.fn(async (plaintext: string, _context: unknown, recordId: string) => ({
      id: recordId,
      ciphertext: `enc:${plaintext}`,
    })),
    load: vi.fn((ciphertext: string, _recordId: string) => ciphertext.slice(4)),
  };
}

type ConnectionRow = {
  id: string;
  spaceId: string;
  userId: string;
  connectorId: string;
  provider: string;
  status: string;
  secretId: string | null;
  providerRef: string | null;
};

function fakePrisma(rows: ConnectionRow[], secrets: Map<string, string> = new Map()) {
  const store = {
    rows,
    secrets,
    secret: {
      create: vi.fn(async ({ data }: { data: { id: string; ciphertext: string } }) => {
        store.secrets.set(data.id, data.ciphertext);
        return data;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { ciphertext: string } }) => {
          store.secrets.set(where.id, data.ciphertext);
          return data;
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const ciphertext = store.secrets.get(where.id);
        return ciphertext ? { id: where.id, ciphertext } : null;
      }),
    },
    connection: {
      findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
        rows.filter((row) => !where.status || row.status === where.status),
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const providerRef = (where as { providerRef?: string }).providerRef;
        const provider = (where as { provider?: string }).provider;
        const status = (where as { status?: string | { in: string[] } }).status;
        const statuses = typeof status === "string" ? [status] : status?.in;
        return (
          rows.find((row) => {
            if (providerRef !== undefined && row.providerRef !== providerRef) return false;
            if (provider !== undefined && row.provider !== provider) return false;
            if (statuses && !statuses.includes(row.status)) return false;
            return (
              row.spaceId === "space-1" && row.userId === "user-1" && row.connectorId === "google"
            );
          }) ?? null
        );
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<ConnectionRow> }) => {
          const row = rows.find((entry) => entry.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(store)),
  };
  return store;
}

function connector(
  prisma: ReturnType<typeof fakePrisma>,
  fetchImpl: unknown,
  config = { clientId: "client-id", clientSecret: "client-secret" },
) {
  return new GoogleConnector(config, {
    prisma: prisma as never,
    secrets: fakeSecrets() as never,
    fetch: fetchImpl as typeof globalThis.fetch,
  });
}

function row(overrides: Partial<ConnectionRow>): ConnectionRow {
  return {
    id: "conn-1",
    spaceId: "space-1",
    userId: "user-1",
    connectorId: "google",
    provider: "gmail",
    status: "connected",
    secretId: null,
    providerRef: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("google connector catalog and begin", () => {
  it("describes the google provider and lists the three featured apps", async () => {
    const provider = connector(fakePrisma([]), undefined);
    expect(provider.describe().id).toBe("google");
    const catalog = await provider.catalog(CONTEXT);
    expect(catalog.map((item) => item.slug)).toEqual(["gmail", "googlecalendar", "googledrive"]);
    expect(catalog.every((item) => item.connectorId === "google" && !item.connected)).toBe(true);
  });

  it("marks connected slugs from stored rows", async () => {
    const prisma = fakePrisma([row({ provider: "gmail" })]);
    const provider = connector(prisma, undefined);
    const catalog = await provider.catalog(CONTEXT);
    expect(catalog.find((item) => item.slug === "gmail")?.connected).toBe(true);
    expect(catalog.find((item) => item.slug === "googledrive")?.connected).toBe(false);
  });

  it("builds the Google auth URL with per-app scopes and the deployment callback", async () => {
    const provider = connector(fakePrisma([]), undefined);
    const started = await provider.begin(
      { provider: "gmail", redirectUrl: "https://bs.example.test/app" },
      CONTEXT,
    );
    const url = new URL(started.authorizationUrl!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `https://bs.example.test${GOOGLE_CALLBACK_PATH}`,
    );
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(started.state).toBeTruthy();
    expect(googleRedirectUri("https://bs.example.test/")).toBe(
      `https://bs.example.test${GOOGLE_CALLBACK_PATH}`,
    );
  });

  it("rejects unknown providers", async () => {
    const provider = connector(fakePrisma([]), undefined);
    await expect(
      provider.begin({ provider: "googledocs", redirectUrl: "https://x.test/app" }, CONTEXT),
    ).rejects.toThrow(/Unknown Google app/);
  });
});

describe("google oauth callback", () => {
  it("exchanges the code and attaches tokens to the pending connection", async () => {
    const pending = row({ status: "pending", providerRef: "state-1" });
    const prisma = fakePrisma([pending]);
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "access-token-1",
        refresh_token: "refresh-token-1",
        expires_in: 3600,
        id_token: `x.${Buffer.from(
          JSON.stringify({ email: "dome@example.test", sub: "sub-1" }),
        ).toString("base64url")}.y`,
      }),
    );
    const provider = connector(prisma, fetch);
    await provider.handleCallback({
      state: "state-1",
      code: "code-1",
      webOrigin: "https://bs.example.test",
    });

    const tokenCall = fetch.mock.calls.find(([url]) =>
      String(url).includes("oauth2.googleapis.com/token"),
    );
    expect(tokenCall).toBeDefined();
    const body = String((tokenCall![1] as RequestInit).body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=code-1");
    expect(body).toContain(
      "redirect_uri=https%3A%2F%2Fbs.example.test%2Fapi%2Fintegrations%2Fgoogle%2Fcallback",
    );

    expect(pending.secretId).toBe("google-connection:conn-1");
    const stored = JSON.parse(prisma.secrets.get("google-connection:conn-1")!.slice(4)) as {
      access_token: string;
      refresh_token?: string;
      email?: string;
    };
    expect(stored.access_token).toBe("access-token-1");
    expect(stored.refresh_token).toBe("refresh-token-1");
    expect(stored.email).toBe("dome@example.test");
    expect(await provider.connectionReady(CONTEXT, "gmail")).toBe(true);
  });

  it("keeps the previous refresh token when Google omits it on re-consent", async () => {
    const pending = row({
      status: "pending",
      providerRef: "state-2",
      secretId: "google-connection:conn-1",
    });
    const prisma = fakePrisma([pending]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "old", refresh_token: "refresh-token-old", expires_at: 1 })}`,
    );
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "access-token-2", expires_in: 3600 }));
    const provider = connector(prisma, fetch);
    await provider.handleCallback({
      state: "state-2",
      code: "code-2",
      webOrigin: "https://bs.example.test",
    });
    const stored = JSON.parse(prisma.secrets.get("google-connection:conn-1")!.slice(4)) as {
      access_token: string;
      refresh_token?: string;
    };
    expect(stored.access_token).toBe("access-token-2");
    expect(stored.refresh_token).toBe("refresh-token-old");
  });

  it("fails readably when the state no longer matches a pending row", async () => {
    const provider = connector(fakePrisma([]), vi.fn());
    await expect(
      provider.handleCallback({ state: "gone", code: "code", webOrigin: "https://x.test" }),
    ).rejects.toThrow(/no longer pending/);
  });
});

describe("google tool execution", () => {
  it("searches Gmail and returns per-message summaries", async () => {
    const prisma = fakePrisma([row({ provider: "gmail", secretId: "google-connection:conn-1" })]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "access-token", expires_at: Date.now() + 3600_000 })}`,
    );
    const fetch = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/messages?")) {
        return jsonResponse({ messages: [{ id: "m1", threadId: "t1" }] });
      }
      return jsonResponse({
        id: "m1",
        snippet: "Hello",
        payload: {
          headers: [
            { name: "From", value: "a@example.test" },
            { name: "Subject", value: "Hi" },
            { name: "Date", value: "Wed, 7 Oct 2026" },
          ],
        },
      });
    });
    const provider = connector(prisma, fetch);
    const events = [];
    for await (const event of provider.execute(
      {
        tool: "gmail_search",
        args: { query: "is:unread" },
        executionId: "e1",
        route: { connectorId: "google", resourceId: "gmail", toolName: "gmail_search" },
      },
      CONTEXT,
    )) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    const result = (events[0] as { type: string; data?: { messages: Array<{ subject: string }> } })
      .data;
    expect(result?.messages[0]?.subject).toBe("Hi");
    expect((events[0] as { type: string }).type).toBe("result");
  });

  it("refreshes an expired access token and persists the new one", async () => {
    const prisma = fakePrisma([row({ provider: "gmail", secretId: "google-connection:conn-1" })]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "expired-access-token", refresh_token: "refresh-token", expires_at: Date.now() - 1_000 })}`,
    );
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com/token")) {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({ messages: [] });
    });
    const provider = connector(prisma, fetch);
    const events = [];
    for await (const event of provider.execute(
      {
        tool: "gmail_search",
        args: {},
        executionId: "e1",
        route: { connectorId: "google", resourceId: "gmail", toolName: "gmail_search" },
      },
      CONTEXT,
    )) {
      events.push(event);
    }
    expect((events[0] as { type: string }).type).toBe("result");
    const stored = JSON.parse(prisma.secrets.get("google-connection:conn-1")!.slice(4)) as {
      access_token: string;
      refresh_token?: string;
    };
    expect(stored.access_token).toBe("fresh-access-token");
    expect(stored.refresh_token).toBe("refresh-token");
  });

  it("sends Gmail messages as base64url MIME", async () => {
    const prisma = fakePrisma([row({ provider: "gmail", secretId: "google-connection:conn-1" })]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "access-token", expires_at: Date.now() + 3600_000 })}`,
    );
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "sent-1", threadId: "t9" }));
    const provider = connector(prisma, fetch);
    const events = [];
    for await (const event of provider.execute(
      {
        tool: "gmail_send",
        args: { to: "b@example.test", subject: "Hello", body: "World" },
        executionId: "e1",
        route: { connectorId: "google", resourceId: "gmail", toolName: "gmail_send" },
      },
      CONTEXT,
    )) {
      events.push(event);
    }
    expect((events[0] as { type: string }).type).toBe("result");
    const sendCall = fetch.mock.calls.find(([url]) => String(url).includes("/messages/send"));
    const sentBody = JSON.parse(String((sendCall![1] as RequestInit).body)) as { raw: string };
    expect(Buffer.from(sentBody.raw, "base64url").toString("utf8")).toContain("To: b@example.test");
  });

  it("uploads a text file to Drive and returns the link", async () => {
    const prisma = fakePrisma([
      row({ provider: "googledrive", secretId: "google-connection:conn-1" }),
    ]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "access-token", expires_at: Date.now() + 3600_000 })}`,
    );
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "f1",
        name: "report.md",
        webViewLink: "https://drive.google.com/file/d/f1/view",
      }),
    );
    const provider = connector(prisma, fetch);
    const events = [];
    for await (const event of provider.execute(
      {
        tool: "gdrive_upload_file",
        args: { name: "report.md", content: "# Report" },
        executionId: "e1",
        route: { connectorId: "google", resourceId: "googledrive", toolName: "gdrive_upload_file" },
      },
      CONTEXT,
    )) {
      events.push(event);
    }
    const data = (events[0] as { data?: { uploaded?: boolean; link?: string } }).data;
    expect(data?.uploaded).toBe(true);
    expect(data?.link).toContain("drive.google.com");
  });

  it("creates calendar events on the primary calendar", async () => {
    const prisma = fakePrisma([
      row({ provider: "googlecalendar", secretId: "google-connection:conn-1" }),
    ]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "access-token", expires_at: Date.now() + 3600_000 })}`,
    );
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "ev1", htmlLink: "https://calendar.google.com/x" }));
    const provider = connector(prisma, fetch);
    const events = [];
    for await (const event of provider.execute(
      {
        tool: "gcal_create_event",
        args: {
          summary: "Dentist",
          start: "2026-10-08T14:00:00+07:00",
          end: "2026-10-08T15:00:00+07:00",
        },
        executionId: "e1",
        route: {
          connectorId: "google",
          resourceId: "googlecalendar",
          toolName: "gcal_create_event",
        },
      },
      CONTEXT,
    )) {
      events.push(event);
    }
    const data = (events[0] as { data?: { created?: boolean } }).data;
    expect(data?.created).toBe(true);
  });
});

describe("google revoke", () => {
  it("revokes the stored refresh token", async () => {
    const connected = row({ providerRef: "state-1", secretId: "google-connection:conn-1" });
    const prisma = fakePrisma([connected]);
    prisma.secrets.set(
      "google-connection:conn-1",
      `enc:${JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_at: Date.now() + 1 })}`,
    );
    const fetch = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("oauth2.googleapis.com/revoke");
      return new Response("", { status: 200 });
    });
    const provider = connector(prisma, fetch);
    await expect(provider.revoke("state-1", CONTEXT)).resolves.toBeUndefined();
  });

  it("survives a remote revoke failure", async () => {
    const connected = row({ providerRef: "state-2", secretId: "google-connection:conn-2" });
    const prisma = fakePrisma([connected]);
    prisma.secrets.set(
      "google-connection:conn-2",
      `enc:${JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_at: Date.now() + 1 })}`,
    );
    const provider = connector(prisma, vi.fn().mockRejectedValue(new Error("offline")));
    await expect(provider.revoke("state-2", CONTEXT)).resolves.toBeUndefined();
  });
});
