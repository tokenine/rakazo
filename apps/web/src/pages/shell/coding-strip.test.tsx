// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  codingSessions: {
    list: vi.fn(),
    terminalUrl: vi.fn(),
  },
  codingAcceptance: { get: vi.fn() },
}));

vi.mock("../../lib/rpc", () => ({ rpc }));
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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderStrip(root: Root, container: HTMLElement) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/app/bot-1"]}>
        <Routes>
          <Route
            path="/app/:botId"
            element={
              <div>
                <CodingSessionsStrip botId="bot-1" refreshTick={0} />
                <LocationProbe />
              </div>
            }
          />
          <Route path="/app/code/:sessionId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

describe("CodingSessionsStrip (R12: pills navigate to the workspace)", () => {
  const container = document.createElement("div");
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    vi.clearAllMocks();
  });

  async function renderWith(session: unknown) {
    rpc.codingSessions.list.mockResolvedValue([session]);
    document.body.appendChild(container);
    root = createRoot(container);
    renderStrip(root, container);
    await act(async () => {});
  }

  it("navigates to the code workspace when a pill is clicked", async () => {
    await renderWith(ompSession);
    const pill = container.querySelector('[data-testid="coding-session-pill-coding-omp-1"]') as
      | HTMLButtonElement
      | null;
    expect(pill).not.toBeNull();
    act(() => pill!.click());
    await act(async () => {});
    expect(
      (container.querySelector('[data-testid="location"]') as HTMLElement).textContent,
    ).toBe("/app/code/coding-omp-1");
  });

  it("does not expand an inline terminal or acceptance card in chat", async () => {
    rpc.codingSessions.terminalUrl.mockResolvedValue({ url: "wss://example.test/pty" });
    await renderWith(ompSession);
    const pill = container.querySelector('[data-testid="coding-session-pill-coding-omp-1"]') as
      | HTMLButtonElement
      | null;
    act(() => pill!.click());
    await act(async () => {});
    expect(container.querySelector('[data-testid="coding-session-terminal"]')).toBeNull();
    expect(container.querySelector('[data-testid^="acceptance-card-"]')).toBeNull();
  });
});
