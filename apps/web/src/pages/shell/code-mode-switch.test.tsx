// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  codingSessions: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../lib/rpc", () => ({ rpc }));
vi.mock("@lingui/react", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { CodeModeSwitch } from "./code-mode-switch";

const activeSession = {
  id: "coding-1",
  workspaceId: "bot:bot-1",
  engine: "omp",
  status: "active",
  title: null,
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderSwitch(root: Root, container: HTMLElement) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/app/bot-1"]}>
        <Routes>
          <Route
            path="/app/:botId"
            element={
              <div>
                <CodeModeSwitch botId="bot-1" mode="chat" />
                <LocationProbe />
              </div>
            }
          />
          <Route
            path="/app/code/:sessionId"
            element={
              <div>
                <LocationProbe />
              </div>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  act(() => button!.click());
}

describe("CodeModeSwitch (T39)", () => {
  const container = document.createElement("div");
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    vi.clearAllMocks();
    try {
      window.localStorage.removeItem("rakazo:coding-engine");
    } catch {
      /* private mode */
    }
  });

  it("renders a Chat | Code segmented control with Chat active in chat", async () => {
    document.body.appendChild(container);
    root = createRoot(container);
    rpc.codingSessions.list.mockResolvedValue([]);
    renderSwitch(root, container);
    const chat = container.querySelector('[data-testid="code-mode-chat"]') as HTMLButtonElement;
    const code = container.querySelector('[data-testid="code-mode-code"]') as HTMLButtonElement;
    expect(chat).not.toBeNull();
    expect(code).not.toBeNull();
    expect(chat.getAttribute("aria-pressed")).toBe("true");
    expect(code.getAttribute("aria-pressed")).toBe("false");
  });

  it("navigates to the workspace of the bot's active coding session", async () => {
    document.body.appendChild(container);
    root = createRoot(container);
    rpc.codingSessions.list.mockResolvedValue([activeSession]);
    renderSwitch(root, container);
    await act(async () => {});
    click(container, "code-mode-code");
    await act(async () => {});
    expect(
      (container.querySelector('[data-testid="location"]') as HTMLElement).textContent,
    ).toBe("/app/code/coding-1");
    expect(rpc.codingSessions.create).not.toHaveBeenCalled();
  });

  it("creates a coding session with the remembered engine when none is active", async () => {
    window.localStorage.setItem("rakazo:coding-engine", "omp");
    document.body.appendChild(container);
    root = createRoot(container);
    rpc.codingSessions.list.mockResolvedValue([]);
    rpc.codingSessions.create.mockResolvedValue({
      id: "coding-new",
      workspaceId: "bot:bot-1",
      engine: "omp",
      status: "active",
    });
    renderSwitch(root, container);
    await act(async () => {});
    click(container, "code-mode-code");
    await act(async () => {});
    expect(rpc.codingSessions.create).toHaveBeenCalledWith({ botId: "bot-1", engine: "omp" });
    expect(
      (container.querySelector('[data-testid="location"]') as HTMLElement).textContent,
    ).toBe("/app/code/coding-new");
  });
});
