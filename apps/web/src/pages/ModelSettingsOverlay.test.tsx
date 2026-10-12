// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const models = vi.hoisted(() => ({
  list: vi.fn(),
  credentials: vi.fn(),
  connect: vi.fn(),
  setDefault: vi.fn(),
  probeOpenAiCompatible: vi.fn(),
}));

const me = vi.hoisted(() => vi.fn());

vi.mock("../lib/rpc", () => ({ rpc: { models, me } }));
vi.mock("../lib/use-model-oauth-signin", () => ({
  useModelOAuthSignIn: () => ({
    oauth: null,
    pasteCode: "",
    setPasteCode: () => {},
    oauthPending: false,
    cancelOAuthAttempt: () => {},
    startSubscriptionSignIn: () => {},
    submitOAuthCode: () => {},
  }),
}));
vi.mock("../lib/localized-provider-hint", () => ({
  localizedProviderHint: () => "API key",
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
    Plural: ({ one }: { one: ReactNode }) => one,
  };
});
vi.mock("@rakazo/core", () => ({
  createModelProbe: () => ({ probe: async () => {}, reset: () => {}, invalidate: () => {} }),
  initialModelProbeState: { models: [], probing: false },
  waitForModelOAuthCompletion: vi.fn(),
}));
vi.mock("@rakazo/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
    Dialog: Container,
    DialogClose: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    ModelThinkingOptions: () => null,
    NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  };
});

import { ModelSettingsOverlay } from "./ModelSettingsOverlay";

const catalog = [
  {
    provider: "ai7",
    providerName: "Ai7",
    id: "basic",
    label: "Basic",
    billing: "",
    auth: "api-key",
    subscription: false,
    reasoning: false,
    thinkingLevels: [],
  },
  {
    provider: "openai-compatible",
    providerName: "OpenAI-compatible",
    id: "custom",
    label: "Custom model",
    billing: "",
    auth: "api-key",
    subscription: false,
    reasoning: false,
    thinkingLevels: [],
  },
];

function renderOverlay(root: Root) {
  act(() => {
    root.render(<ModelSettingsOverlay onClose={() => {}} />);
  });
}

describe("ModelSettingsOverlay OpenAI-compatible presets", () => {
  const container = document.createElement("div");
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
  });

  async function openOnOpenAiCompatible() {
    models.list.mockResolvedValue(catalog);
    models.credentials.mockResolvedValue([]);
    me.mockResolvedValue({ id: "user-1", defaultProvider: null, defaultModel: null });
    document.body.appendChild(container);
    root = createRoot(container);
    renderOverlay(root);
    await act(async () => {});
    const providerButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("OpenAI-compatible"),
    );
    expect(providerButton).toBeDefined();
    act(() => providerButton!.click());
    await act(async () => {});
  }

  it("offers a preset picker and fills the server URL when Z.AI is chosen", async () => {
    await openOnOpenAiCompatible();
    const presetSelect = container.querySelector(
      'select[aria-label="Server preset"]',
    ) as HTMLSelectElement | null;
    expect(presetSelect).not.toBeNull();
    const options = [...presetSelect!.options].map((option) => option.textContent);
    expect(options).toContain("Z.AI Coding Plan");
    expect(options).toContain("MiniMax");

    act(() => {
      presetSelect!.value = "https://api.z.ai/api/coding/paas/v4";
      presetSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const urlInput = container.querySelector(
      'input[aria-label="OpenAI-compatible server URL"]',
    ) as HTMLInputElement;
    expect(urlInput.value).toBe("https://api.z.ai/api/coding/paas/v4");
  });

  it("marks a preset address and returns to custom when cleared", async () => {
    await openOnOpenAiCompatible();
    const presetSelect = () =>
      container.querySelector('select[aria-label="Server preset"]') as HTMLSelectElement;
    const urlInput = () =>
      container.querySelector(
        'input[aria-label="OpenAI-compatible server URL"]',
      ) as HTMLInputElement;

    act(() => {
      presetSelect().value = "https://api.minimax.io/v1";
      presetSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(presetSelect().value).toBe("https://api.minimax.io/v1");
    expect(urlInput().value).toBe("https://api.minimax.io/v1");

    act(() => {
      presetSelect().value = "";
      presetSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(urlInput().value).toBe("");
  });
});
