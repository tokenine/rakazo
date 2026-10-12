/**
 * Shared command output: one path for the JSON envelope, exit codes, and
 * token redaction. Every command emits through here — nothing prints tokens.
 */

export interface CliError {
  code: "GENERAL" | "USAGE" | "AUTH_FAILED" | "TIMEOUT" | "UNREACHABLE";
  message: string;
  retryable: boolean;
}

export interface Success<T> {
  ok: true;
  data: T;
}

export interface Failure {
  ok: false;
  error: CliError;
}

export type Envelope<T> = Success<T> | Failure;

export interface EmitOptions {
  json: boolean;
  /** Human-readable line for text mode success; defaults to JSON of data. */
  text?: string;
  /** Secret values stripped from every emitted line. */
  redact?: string[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function redactAll(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function emit<T>(envelope: Envelope<T>, opts: EmitOptions): void {
  const stdout = opts.stdout ?? ((line: string) => console.log(line));
  const stderr = opts.stderr ?? ((line: string) => console.error(line));
  const secrets = opts.redact ?? [];

  if (opts.json) {
    stdout(redactAll(JSON.stringify(envelope), secrets));
    if (!envelope.ok) stderr(redactAll(`Error: ${envelope.error.message}`, secrets));
    return;
  }

  if (envelope.ok) {
    stdout(redactAll(opts.text ?? JSON.stringify(envelope.data, null, 2), secrets));
  } else {
    stderr(redactAll(`Error: ${envelope.error.message}`, secrets));
  }
}

/** Documented exit codes: 0 success / 1 general / 2 usage / 3 auth / 6 timeout. */
export function exitCodeFor(error: CliError | undefined): number {
  if (!error) return 0;
  switch (error.code) {
    case "USAGE":
      return 2;
    case "AUTH_FAILED":
      return 3;
    case "TIMEOUT":
      return 6;
    default:
      return 1;
  }
}

export function cliError(code: CliError["code"], message: string): Failure {
  return {
    ok: false,
    error: { code, message, retryable: code === "TIMEOUT" || code === "UNREACHABLE" },
  };
}
