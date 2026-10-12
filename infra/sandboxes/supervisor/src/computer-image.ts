import { existsSync } from "node:fs";

/**
 * The slice of the dockerode client the image build needs. Structural so tests
 * can substitute a fake while real builds pass the supervisor's client.
 */
export interface DockerImageBuildClient {
  modem: {
    followProgress(
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null, output?: unknown[]) => void,
      onProgress?: (event: unknown) => void,
    ): void;
  };
  getImage(name: string): { inspect(): Promise<unknown> };
  buildImage(
    context: { context: string; src: string[] },
    options: { t: string },
  ): Promise<NodeJS.ReadableStream>;
}

export interface ComputerImageSource {
  tag: string;
  dockerfile: string;
  buildContext: { context: string; src: string[] };
}

/**
 * dockerode's followProgress resolves when the build stream ends, even when the
 * daemon ended the stream because a build step failed — the failure only appears
 * as in-stream error events (classic {"error": ...} JSON or BuildKit "ERROR:"
 * lines) that are never surfaced as a rejected promise. Treating stream end as
 * success then reports the later image-inspect 404 ("no such image") instead of
 * the real cause, so scan the collected events for those markers explicitly.
 */
function buildFailureMessage(events: unknown[]): string | undefined {
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const record = event as {
      error?: unknown;
      errorDetail?: { message?: unknown };
      stream?: unknown;
    };
    if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
    if (typeof record.errorDetail?.message === "string" && record.errorDetail.message.trim()) {
      return record.errorDetail.message.trim();
    }
    if (typeof record.stream === "string" && record.stream.startsWith("ERROR: ")) {
      return record.stream.replace(/^ERROR:\s*/, "").trim();
    }
  }
  return undefined;
}

/**
 * Ensure the computer image exists, building it from the bundled context when
 * missing. Rejects with the build's own error text when the build fails, and
 * still rejects when the stream ends cleanly but the tag never appeared.
 */
export async function ensureComputerImageBuilt(
  docker: DockerImageBuildClient,
  source: ComputerImageSource,
): Promise<void> {
  try {
    await docker.getImage(source.tag).inspect();
    return;
  } catch {
    // image absent — build below
  }
  if (!existsSync(source.dockerfile)) {
    throw new Error(
      `Missing ${source.tag}. Build it with: docker build -t ${source.tag} infra/sandboxes/computer`,
    );
  }
  const stream = await docker.buildImage(source.buildContext, { t: source.tag });
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err, output) => {
      if (err) {
        reject(err);
        return;
      }
      const buildError = buildFailureMessage(output ?? []);
      if (buildError) {
        reject(new Error(`computer image build failed: ${buildError}`));
        return;
      }
      docker
        .getImage(source.tag)
        .inspect()
        .then(() => resolve())
        .catch((error: unknown) =>
          reject(
            error instanceof Error
              ? error
              : new Error(`computer image build did not produce ${source.tag}`),
          ),
        );
    });
  });
}
