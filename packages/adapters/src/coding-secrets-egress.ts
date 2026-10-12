/**
 * 004-code-mode S3 (T17, V8) — the single deny-list egress filter.
 *
 * Literal + base64/base64url + hex (lower/upper) + URL(percent) transforms
 * of granted secret values, applied across artifact surfaces: prompts,
 * transcripts, command results, checkpoints, handoff summaries, QA
 * evidence. This REPLACES the literal-only redaction
 * (redactAgentCommandResult) for CODING SESSIONS; non-coding runs keep the
 * legacy behavior (scoped replacement, per the task).
 *
 * Redaction errs on the side of secrecy: encoded-form false positives are
 * acceptable, leaks are not. Empty values are ignored (no-op), and a filter
 * with no values is an honest no-op — it never claims coverage it lacks.
 */

const MAX_FILTERABLE_FILE_BYTES = 1_048_576;

export function secretEgressVariants(value: string): string[] {
  if (!value) return [];
  const bytes = Buffer.from(value, "utf8");
  const b64 = bytes.toString("base64");
  return [
    value,
    b64,
    b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    bytes.toString("hex"),
    bytes.toString("hex").toUpperCase(),
    encodeURIComponent(value),
  ];
}

export interface EgressSweepHit {
  surface: string;
  variant: string;
}

export interface EgressSweepResult {
  clean: boolean;
  hits: EgressSweepHit[];
}

export class SecretEgressFilter {
  private readonly variants: Array<{ value: string; form: string }>;

  constructor(values: string[]) {
    this.variants = values
      .filter((value) => typeof value === "string" && value.length > 0)
      .flatMap((value) => secretEgressVariants(value).map((form) => ({ value, form })));
  }

  get isEmpty(): boolean {
    return this.variants.length === 0;
  }

  filter(text: string): string {
    if (this.isEmpty || !text) return text;
    let output = text;
    for (const { form } of this.variants) {
      if (output.includes(form)) output = output.split(form).join("[redacted]");
    }
    return output;
  }

  /** Command-result shape (the literal-only replacement's contract). */
  filterCommandResult<T extends { stdout: string; stderr: string; code: number }>(result: T): T {
    return {
      ...result,
      stdout: this.filter(result.stdout),
      stderr: this.filter(result.stderr),
    };
  }

  /**
   * Filter for checkpoint file content: UTF-8-decodable files up to 1 MiB
   * are filtered; anything else (binary, huge) passes unchanged — the sweep
   * (V8) covers the residual risk instead of corrupting files.
   */
  filterFileContent(content: Uint8Array): Uint8Array {
    if (
      this.isEmpty ||
      content.byteLength === 0 ||
      content.byteLength > MAX_FILTERABLE_FILE_BYTES
    ) {
      return content;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return content; // binary: leave untouched
    }
    const filtered = this.filter(text);
    if (filtered === text) return content;
    return new TextEncoder().encode(filtered);
  }
}

/**
 * V8 sweep: asserts granted values are absent (literal AND transformed) from
 * every artifact surface. Used by the verification evidence AND the
 * checkpoint/handoff/QA sweeps.
 */
export function sweepSurfacesForSecretEgress(
  values: string[],
  surfaces: Record<string, string>,
): EgressSweepResult {
  const hits: EgressSweepHit[] = [];
  for (const [surface, text] of Object.entries(surfaces)) {
    if (!text) continue;
    for (const value of values) {
      for (const form of secretEgressVariants(value)) {
        if (form && text.includes(form))
          hits.push({ surface, variant: form === value ? "literal" : "encoded" });
      }
    }
  }
  return { clean: hits.length === 0, hits };
}
