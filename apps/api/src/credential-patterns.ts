/**
 * Credential-pattern detection for export refusal.
 *
 * `containsSecret` in @rakazo/core is a *known-secret* substring detector: it can
 * only find values that are already in the secret store. It cannot find a
 * credential a user pasted into a prompt. Export needs both, so this module adds
 * pattern detection and the two are OR'd together.
 *
 * See .super-speckit/bugs/003-S1-export-secret-scan-noop.md — passing an empty
 * secret list to containsSecret silently disabled the whole scan.
 */

/**
 * Deliberately narrow: each pattern is a high-confidence provider prefix or
 * structural marker. A general "looks random" heuristic is deliberately absent —
 * false positives here block a legitimate export, so the cost of over-matching
 * is real. Space-owner secrets are still caught by the containsSecret pass.
 */
/**
 * Terminal boundary for a pattern whose token alphabet EXCLUDES underscore.
 *
 * `\b` cannot terminate such a token before a `_`, because both the last token
 * character and `_` are word characters — so `ghp_<token>_` would not match at
 * all. A provider token followed by an underscore is still a provider token, so
 * the boundary is "not followed by another character from this token's alphabet"
 * rather than a word boundary.
 *
 * Patterns whose alphabet INCLUDES underscore (OpenAI, Google, Anthropic, Stripe)
 * keep `\b`: there the underscore is consumed by the quantifier and the boundary
 * applies after it.
 */
const CREDENTIAL_PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  // OpenAI
  { name: "OpenAI secret key", re: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/ },
  // GitHub tokens
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/ },
  // AWS access key id
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}(?![0-9A-Z])/ },
  // Google API key
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // Slack
  { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  // Stripe
  { name: "Stripe secret key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  // Anthropic
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  // Hugging Face
  { name: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/ },
  // Private key blocks
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // Bearer/JWT style assignment in free text
  { name: "inline bearer token", re: /\b(?:bearer|authorization:\s*bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/i },
];

/**
 * Scan free text for credential-shaped content.
 *
 * Returns the names of the patterns that matched, so callers can refuse with a
 * specific reason. An empty array means nothing was detected — note this is the
 * opposite convention from the containsSecret fast path, which used an empty
 * secret list to mean "always false"; the caller must not pass an empty list to
 * containsSecret and treat the result as a pass.
 */
export function detectCredentialPatterns(value: string): string[] {
  const found: string[] = [];
  for (const { name, re } of CREDENTIAL_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(value)) found.push(name);
  }
  return found;
}
