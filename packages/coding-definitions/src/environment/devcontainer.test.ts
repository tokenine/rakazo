/**
 * T27 — V17 RED: devcontainer.json parser + applier
 *
 * Verifies:
 * 1. DevcontainerParser parses a fixture devcontainer.json (subset + disclosed container keys)
 * 2. The parser is behind the IEnvironmentParser seam (swappable)
 * 3. parse() returns null for invalid input
 * 4. features are normalized to features-lite shape
 * 5. container-only keys are disclosed
 */

import { describe, expect, it } from "vitest";
import {
  DevcontainerParser,
  CompositeEnvironmentParser,
  type IEnvironmentParser,
  type ParsedEnvironment,
} from "./devcontainer.js";

const FIXTURE_DEVCONTAINER = {
  image: "mcr.microsoft.com/devcontainers/typescript-node:22",
  dockerFile: "./Dockerfile",
  postCreateCommand: "npm install && npm run build",
  forwardPorts: [3000, 9229],
  features: {
    "ghcr.io/devcontainer/features/node": {
      version: "22",
      options: { nodeGypDependencies: false },
    },
    "ghcr.io/owner/custom-feature": "latest",
  },
  customizations: {
    vscode: {
      extensions: ["esbenp.prettier-vscode"],
    },
  },
  // Container-only keys that should appear in disclosedContainerKeys
  containerEnv: { NODE_ENV: "development" },
  settings: { "terminal.integrated.shell.linux": "/bin/bash" },
};

describe("T27 RED: DevcontainerParser", () => {
  it("parses a fixture devcontainer.json into the Rakazo subset", () => {
    const parser = new DevcontainerParser();
    const result = parser.parse(FIXTURE_DEVCONTAINER);

    expect(result).not.toBeNull();
    const env = result as ParsedEnvironment;

    // Subset keys
    expect(env.definition.postCreateCommand).toBe("npm install && npm run build");
    expect(env.definition.forwardPorts).toEqual([3000, 9229]);
    expect(env.definition.customizations).toEqual({
      vscode: { extensions: ["esbenp.prettier-vscode"] },
    });

    // features-lite normalization
    expect(env.definition.features).toHaveLength(2);
    expect(env.definition.features).toContainEqual({
      name: "ghcr.io/devcontainer/features/node",
      url: undefined,
      dest: undefined,
    });
    expect(env.definition.features).toContainEqual({
      name: "ghcr.io/owner/custom-feature",
      url: "latest",
      dest: undefined,
    });
  });

  it("discloses container-only keys", () => {
    const parser = new DevcontainerParser();
    const result = parser.parse(FIXTURE_DEVCONTAINER);
    expect(result).not.toBeNull();

    const env = result as ParsedEnvironment;
    expect(env.disclosedContainerKeys).toContain("image");
    expect(env.disclosedContainerKeys).toContain("dockerFile");
    expect(env.disclosedContainerKeys).toContain("containerEnv");
    expect(env.disclosedContainerKeys).toContain("settings");
    expect(env.disclosedContainerKeys).not.toContain("postCreateCommand");
    expect(env.disclosedContainerKeys).not.toContain("forwardPorts");
  });

  it("returns null for non-object input", () => {
    const parser = new DevcontainerParser();
    expect(parser.parse(null)).toBeNull();
    expect(parser.parse("string")).toBeNull();
    expect(parser.parse(42)).toBeNull();
    expect(parser.parse(["array"])).toBeNull();
  });

  it("returns null for a devcontainer.json missing all subset keys", () => {
    const parser = new DevcontainerParser();
    // Only container-only keys — no Rakazo subset
    expect(parser.parse({ image: "node:22" })).not.toBeNull();
    expect(parser.parse({ dockerFile: "./Dockerfile" })).not.toBeNull();
    // Empty object is valid (empty subset)
    const result = parser.parse({});
    expect(result).not.toBeNull();
    expect((result as ParsedEnvironment).definition.features).toEqual([]);
  });

  it("handles compact features form (string values)", () => {
    const parser = new DevcontainerParser();
    const result = parser.parse({
      features: {
        "ghcr.io/owner/feature-1": "latest",
        "ghcr.io/owner/feature-2": "1.0.0",
      },
    });
    expect(result).not.toBeNull();
    expect((result as ParsedEnvironment).definition.features).toEqual([
      { name: "ghcr.io/owner/feature-1", url: "latest", dest: undefined },
      { name: "ghcr.io/owner/feature-2", url: "1.0.0", dest: undefined },
    ]);
  });

  it("IEnvironmentParser seam: parser is an IEnvironmentParser", () => {
    const parser: IEnvironmentParser = new DevcontainerParser();
    expect(parser.formatName).toBe("devcontainer.json (subset)");
    expect(typeof parser.parse).toBe("function");
    expect(parser.parse(FIXTURE_DEVCONTAINER)).not.toBeNull();
  });

  it("CompositeEnvironmentParser dispatches to DevcontainerParser by default", () => {
    const composite = new CompositeEnvironmentParser();
    const result = composite.parse(FIXTURE_DEVCONTAINER);
    expect(result).not.toBeNull();
    expect((result as ParsedEnvironment).definition.postCreateCommand).toBe(
      "npm install && npm run build",
    );
  });

  it("CompositeEnvironmentParser.prepend allows custom parser insertion", () => {
    const customParser: IEnvironmentParser = {
      formatName: "custom-format",
      parse: (raw) =>
        typeof raw === "object" && raw !== null && "custom" in raw
          ? {
              definition: { postCreateCommand: "custom-cmd", forwardPorts: [], features: [] },
              disclosedContainerKeys: [],
            }
          : null,
    };

    const composite = new CompositeEnvironmentParser().prepend(customParser);
    expect(composite.parse({ custom: true })).not.toBeNull();
    expect(
      (composite.parse({ custom: true }) as ParsedEnvironment).definition
        .postCreateCommand,
    ).toBe("custom-cmd");
    // Falls through to DevcontainerParser
    expect(
      (composite.parse(FIXTURE_DEVCONTAINER) as ParsedEnvironment).definition
        .postCreateCommand,
    ).toBe("npm install && npm run build");
  });
});
