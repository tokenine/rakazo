/**
 * Local replacements for the small set of `@zcode/shared` values the ported
 * browser modules need. Types mirror the ZCode originals so the copied
 * executor/Chrome-import modules stay byte-identical where possible.
 */

export const ZCODE_VERSION = "aidex-1.0.0";
export const ZCODE_COMMIT = "";

export type ChromeBrowserDataImportError =
  | "chrome_profile_not_found"
  | "chrome_profile_ambiguous"
  | "chrome_executable_not_found"
  | "chrome_cookie_access_denied"
  | "chrome_cookie_elevation_required"
  | "chrome_cookie_elevation_cancelled"
  | "chrome_cookie_helper_verification_failed"
  | "chrome_cookie_app_bound_decryption_failed"
  | "chrome_cookie_protection_unsupported"
  | "chrome_profile_locked"
  | "chrome_local_storage_import_failed"
  | "chrome_import_not_supported"
  | "chrome_browser_data_import_unavailable"
  | "chrome_data_import_failed"
  | "chrome_default_profile_not_found";

export interface ChromeBrowserDataImportOptions {
  allowElevatedChromeDecryption?: boolean;
}

export interface ChromeBrowserDataImportResult {
  success: boolean;
  cookies: { imported: number; skipped: number; failed: number };
  localStorage: {
    originsImported: number;
    entriesImported: number;
    originsSkipped: number;
    originsFailed: number;
    error?: ChromeBrowserDataImportError;
  };
  issues?: ChromeBrowserDataImportError[];
  error?: ChromeBrowserDataImportError;
}

export interface EmbeddedBrowserDataClearResult {
  success: boolean;
  error?: string;
}
