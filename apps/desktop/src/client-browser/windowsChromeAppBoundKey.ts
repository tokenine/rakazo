/**
 * Windows App-Bound Cookie decryption — DEFERRED in Ai7 (macOS-first port).
 * The reader rejects with the unsupported code so Windows imports fall back to
 * the non-App-Bound path instead of pulling the Windows helper toolchain in.
 */
import type { BrowserDataLogger } from "./chromeCookieManager.js";

export type WindowsChromeAppBoundImportErrorCode =
  | "chrome_cookie_app_bound_decryption_failed"
  | "chrome_cookie_protection_unsupported";

export class WindowsChromeAppBoundImportError extends Error {
  constructor(readonly code: WindowsChromeAppBoundImportErrorCode) {
    super(code);
    this.name = "WindowsChromeAppBoundImportError";
  }
}

export type WindowsChromeAppBoundKeyReader = (options: {
  chromeExecutablePath: string;
  expectedAppVersion?: string;
  expectedBuildCommit?: string;
  logger: BrowserDataLogger;
  userDataDir: string;
}) => Promise<Buffer>;

export async function readWindowsChromeAppBoundKey(options: {
  logger: BrowserDataLogger;
}): Promise<Buffer> {
  options.logger.warn("[browser-data] Windows App-Bound import is not enabled in this build");
  throw new WindowsChromeAppBoundImportError("chrome_cookie_protection_unsupported");
}
