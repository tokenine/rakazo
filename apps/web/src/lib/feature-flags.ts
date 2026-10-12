/**
 * Compile-time feature flags (Vite inlines `import.meta.env` at build time).
 * Everything defaults to OFF: a flag ships disabled until the deployment
 * explicitly opts in, so unfinished features never reach users by accident.
 */
export function codeWorkspaceEnabled(
  env: { VITE_FEATURE_CODE_WORKSPACE?: string } | undefined = import.meta.env,
): boolean {
  return env?.VITE_FEATURE_CODE_WORKSPACE === "true";
}
