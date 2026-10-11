// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  codingSessions: {
    list: vi.fn(),
    terminalUrl: vi.fn(),
  },
  codingAcceptance: { get: vi.fn() },
}));

vi.mock("../../lib/rpc", () => ({ rpc }));
vi.mock("../../components/computer/TerminalApp", () => ({
  CodingSessionTerminal: ({ sessionId, hidden }: { sessionId: string; hidden: boolean }) => (
    <div data-testid="coding-session-terminal" data-session-id={sessionId} data-hidden={hidden} />
  ),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { CodingSessionsStrip } from "./coding-strip";

const ompSession = {
  id: "coding-omp-1",
  workspaceId: "bot:bot-1",
  engine: "omp",
  status: "active",
  title: "Refactor",
};

function renderStrip(root: Root, container: HTMLElement) {
  act(() => {
    root.render(<CodingSessionsStrip botId="bot-1" refreshTick={0} />);
  });
  return container;
}

describe("CodingSessionsStrip omp terminal", () => {
  const container = document.createElement("div");
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    vi.clearAllMocks();
  });

  async function expand(session: unknown) {
    rpc.codingSessions.list.mockResolvedValue([session]);
    rpc.codingAcceptance.get.mockResolvedValue(null);
    rpc.codingSessions.terminalUrl.mockResolvedValue({ url: null });
    document.body.appendChild(container);
    root = createRoot(container);
    renderStrip(root, container);
    await act(async () => {});
    const pill = container.querySelector('[data-testid="coding-session-pill-coding-omp-1"]') as
      | HTMLButtonElement
      | null;
    expect(pill).not.toBeNull();
    act(() => pill!.click());
    await act(async () => {});
  }

  it("shows a native terminal for an expanded active omp session", async () => {
    await expand(ompSession);
    const terminal = container.querySelector('[data-testid="coding-session-terminal"]') as
      | HTMLElement
      | null;
    expect(terminal).not.toBeNull();
    expect(terminal!.getAttribute("data-session-id")).toBe("coding-omp-1");
  });

  it("keeps pi sessions and ended sessions chat-only", async () => {
    await expand({ ...ompSession, engine: "normal-pi" });
    expect(container.querySelector('[data-testid="coding-session-terminal"]')).toBeNull();

    const ended = document.createElement("div");
    const endedRoot = createRoot(ended);
    rpc.codingSessions.list.mockResolvedValue([{ ...ompSession, status: "ended" }]);
    act(() => {
      endedRoot.render(<CodingSessionsStrip botId="bot-1" refreshTick={0} />);
    });
    await act(async () => {});
    const pill = ended.querySelector(
      '[data-testid="coding-session-pill-coding-omp-1"]',
    ) as HTMLButtonElement | null;
    act(() => pill!.click());
    await act(async () => {});
    expect(ended.querySelector('[data-testid="coding-session-terminal"]')).toBeNull();
    act(() => endedRoot.unmount());
  });
});
