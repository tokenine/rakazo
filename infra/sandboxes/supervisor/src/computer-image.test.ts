import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { describe, expect, it } from "vitest";
import { ensureComputerImageBuilt } from "./computer-image.js";

const docker = new Docker();

interface Fixture {
  source: {
    tag: string;
    dockerfile: string;
    buildContext: { context: string; src: string[] };
  };
  inspections: Array<"ok" | "missing">;
  stream?: PassThrough;
  getImageCalls: number[];
}

function fixture(options: {
  exists: boolean;
  inspections: Array<"ok" | "missing">;
  stream?: () => PassThrough;
}): Fixture & { docker: Parameters<typeof ensureComputerImageBuilt>[0] } {
  const dir = mkdtempSync(path.join(tmpdir(), "computer-image-"));
  if (options.exists) writeFileSync(path.join(dir, "Dockerfile"), "FROM debian:bookworm-slim\n");
  const calls: number[] = [];
  let inspection = 0;
  const stream = options.stream;
  const fake = {
    modem: docker.modem,
    getImage(name: string) {
      if (name !== "rakazo/computer:local") throw new Error(`unexpected image ${name}`);
      const index = inspection++;
      calls.push(index);
      const verdict = options.inspections[index] ?? "missing";
      return {
        inspect: () =>
          verdict === "ok"
            ? Promise.resolve({ Id: "sha256:test" })
            : Promise.reject(new Error("(HTTP code 404) no such image")),
      };
    },
    buildImage() {
      if (!stream) throw new Error("buildImage should not be called");
      return Promise.resolve(stream() as unknown as NodeJS.ReadableStream);
    },
  };
  return {
    docker: fake as unknown as Parameters<typeof ensureComputerImageBuilt>[0],
    source: {
      tag: "rakazo/computer:local",
      dockerfile: path.join(dir, "Dockerfile"),
      buildContext: { context: dir, src: ["Dockerfile"] },
    },
    inspections: options.inspections,
    stream: stream?.(),
    getImageCalls: calls,
  };
}

function cleanup(fixtureDir: Fixture) {
  rmSync(path.dirname(fixtureDir.source.dockerfile), { recursive: true, force: true });
}

describe("ensureComputerImageBuilt", () => {
  it("resolves without building when the image already exists", async () => {
    const setup = fixture({ exists: true, inspections: ["ok"] });
    try {
      await expect(ensureComputerImageBuilt(setup.docker, setup.source)).resolves.toBeUndefined();
      expect(setup.getImageCalls).toEqual([0]);
    } finally {
      cleanup(setup);
    }
  });

  it("throws the actionable hint when the Dockerfile is missing", async () => {
    const setup = fixture({ exists: false, inspections: [] });
    try {
      expect(existsSync(setup.source.dockerfile)).toBe(false);
      await expect(ensureComputerImageBuilt(setup.docker, setup.source)).rejects.toThrow(
        /Build it with: docker build -t rakazo\/computer:local/,
      );
    } finally {
      cleanup(setup);
    }
  });

  it("rejects with the real build error when the stream reports a failed step", async () => {
    const setup = fixture({
      exists: true,
      inspections: ["missing"],
      stream: () => {
        const build = new PassThrough();
        setImmediate(() => {
          build.write(
            `${JSON.stringify({
              errorDetail: { message: "executor failed: apt-get install exited with code 100" },
              error: "executor failed: apt-get install exited with code 100",
            })}\n`,
          );
          build.end();
        });
        return build;
      },
    });
    try {
      await expect(ensureComputerImageBuilt(setup.docker, setup.source)).rejects.toThrow(
        /apt-get install exited with code 100/,
      );
    } finally {
      cleanup(setup);
    }
  });

  it("does not report success when the stream ends but the tag is still missing", async () => {
    const setup = fixture({
      exists: true,
      inspections: ["missing", "missing"],
      stream: () => {
        const build = new PassThrough();
        setImmediate(() => {
          build.write(`${JSON.stringify({ stream: "Step 1/2 : FROM debian:bookworm-slim\n" })}\n`);
          build.end();
        });
        return build;
      },
    });
    try {
      await expect(ensureComputerImageBuilt(setup.docker, setup.source)).rejects.toThrow(
        /no such image/,
      );
      expect(setup.getImageCalls).toEqual([0, 1]);
    } finally {
      cleanup(setup);
    }
  });
});
