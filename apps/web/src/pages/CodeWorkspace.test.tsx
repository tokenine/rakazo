// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  bots: { list: vi.fn() },
  codingSessions: {
    list: vi.fn(),
    terminalUrl: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    gitGraph: vi.fn(),
  },
  computer: { screenUrl: vi.fn() },
  codingAcceptance: { get: vi.fn() },
}));

vi.mock("../lib/rpc", () => ({ rpc }));
vi.mock("../components/computer/TerminalApp", () => ({
  CodingSessionTerminal: ({ sessionId, interactive }: { sessionId: string; interactive: boolean }) => (
    <div
      data-testid="coding-session-terminal"
      data-session-id={sessionId}
      data-interactive={interactive ? "true" : "false"}
    />
  ),
}));
// The lingui macro plugin compiles `const { t } = useLingui()` to a `_: t` destructure.
vi.mock("@lingui/react", () => {
  // Compiled macro calls pass a descriptor ({ id, message }); tagged templates pass parts.
  const t = (input: { message?: string } | TemplateStringsArray) =>
    "message" in input
      ? (input.message ?? "")
      : Array.from(input as TemplateStringsArray).join("");
  return {
    Trans: ({ children }: { children: ReactNode }) => children,
    t,
    useLingui: () => ({ _: t, t }),
  };
});
vi.mock("@lingui/react/macro", () => {
  // Compiled macro calls pass a descriptor ({ id, message }); tagged templates pass parts.
  const t = (input: { message?: string } | TemplateStringsArray) =>
    "message" in input
      ? (input.message ?? "")
      : Array.from(input as TemplateStringsArray).join("");
  return { useLingui: () => ({ _: t, t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { CodeWorkspacePage } from "./CodeWorkspace";

const bot = { id: "bot-1", name: "Porter" };
const session = {
  id: "coding-1",
  workspaceId: "bot:bot-1",
  engine: "omp",
  status: "active",
  title: null,
};

function mount(root: Root, container: HTMLElement) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/app/code/coding-1"]}>
        <Routes>
          <Route path="/app/code/:sessionId" element={<CodeWorkspacePage />} />
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

describe("CodeWorkspacePage (T39/T42/T43 web)", () => {
  const container = document.createElement("div");
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    vi.clearAllMocks();
  });

  function happyMocks() {
    rpc.bots.list.mockResolvedValue([bot]);
    rpc.codingSessions.list.mockImplementation(async ({ botId }: { botId: string }) =>
      botId === "bot-1" ? [session] : [],
    );
    rpc.computer.screenUrl.mockResolvedValue({ url: null });
    rpc.codingAcceptance.get.mockResolvedValue(null);
    rpc.codingSessions.terminalUrl.mockResolvedValue({
      url: "wss://example.test/pty?view_only=true",
    });
    rpc.codingSessions.listFiles.mockResolvedValue([
      { path: "src", kind: "dir", size: 0, executable: true },
      { path: "README.md", kind: "file", size: 30, executable: false },
    ]);
    rpc.codingSessions.gitGraph.mockResolvedValue({
      commits: [
        {
          sha: "abc1234def5678",
          parents: [],
          subject: "feat: first",
          author: "Porter",
          date: new Date(Date.now() - 3_600_000).toISOString(),
        },
      ],
      refs: ["main"],
      dirty: 2,
      notRepo: false,
    });
  }

  it("renders the panel rail with Terminal, Files and Git enabled for a live session", async () => {
    document.body.appendChild(container);
    root = createRoot(container);
    happyMocks();
    mount(root, container);
    await act(async () => {});
    for (const id of ["panel-terminal", "panel-files", "panel-git"]) {
      const button = container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
      expect(button, id).toBeTruthy();
      expect(button.disabled).toBe(false);
    }
  });

  it("renders the terminal view-only (input disabled) without a control lease", async () => {
    document.body.appendChild(container);
    root = createRoot(container);
    happyMocks();
    mount(root, container);
    await act(async () => {});
    const terminal = container.querySelector('[data-testid="coding-session-terminal"]') as
      | HTMLElement
      | null;
    expect(terminal).not.toBeNull();
    expect(terminal!.getAttribute("data-interactive")).toBe("false");
  });

  it("lists files lazily and opens a read-only preview on click", async () => {
    document.body.appendChild(container);
    root = createRoot(container);
    happyMocks();
    rpc.codingSessions.readFile.mockResolvedValue({
      path: "README.md",
      content: "hello workspace",
    });
    mount(root, container);
    await act(async () => {});
    click(container, "panel-files");
    await act(async () => {});
    const file = container.querySelector(
      '[data-testid="file-entry-README.md"]',
    ) as HTMLButtonElement | null;
    expect(file).not.toBeNull();
    click(container, "file-entry-README.md");
    await act(async () => {});
    expect(rpc.codingSessions.readFile).toHaveBeenCalledWith({
      sessionId: "coding-1",
      path: "README.md",
    });
    const preview = container.querySelector('[data-testid="file-preview"]') as HTMLElement | null;
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain("hello workspace");
  });

  it("renders the git graph and falls back to one truthful line when not a repo", async () => {
    document.body.appendChild(container);
    root = createRoot(container);
    happyMocks();
    mount(root, container);
    await act(async () => {});
    click(container, "panel-git");
    await act(async () => {});
    const graph = container.querySelector('[data-testid="git-graph"]') as HTMLElement | null;
    expect(graph).not.toBeNull();
    expect(graph!.textContent).toContain("feat: first");
    expect(graph!.textContent).toContain("abc1234");
    expect(graph!.textContent).toContain("main");
    expect(graph!.textContent).toContain("2");

    act(() => root.unmount());
    rpc.codingSessions.gitGraph.mockResolvedValue({
      commits: [],
      refs: [],
      dirty: 0,
      notRepo: true,
    });
    const second = document.createElement("div");
    document.body.appendChild(second);
    const secondRoot = createRoot(second);
    mount(secondRoot, second);
    await act(async () => {});
    click(second, "panel-git");
    await act(async () => {});
    const empty = second.querySelector('[data-testid="git-empty"]') as HTMLElement | null;
    act(() => secondRoot.unmount());
    expect(empty).not.toBeNull();
  });
});
