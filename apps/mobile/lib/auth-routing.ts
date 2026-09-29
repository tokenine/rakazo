export type AuthMode = "in" | "up" | "forgot";

export const explicitSignInRoute = {
  pathname: "/sign-in",
  params: { mode: "in" },
} as const;

// Sign-up was folded into sign-in on the web: the OTP code both signs in
// existing accounts and creates allow-listed new ones.
export function initialAuthMode(requestedMode?: string | string[]): AuthMode {
  return requestedMode === "up" ? "up" : "in";
}
