// Where the middleware should send a request, decided from the login cookie alone: no call to
// Convex and no signature check. That's safe because this only picks which page to render;
// Convex verifies the token on every query and mutation.
export function loginRedirect(
  pathname: string,
  token: string | undefined,
  nowMs: number,
): "/" | "/signin" | null {
  const loggedIn = token !== undefined && expiryMs(token) > nowMs;
  const onSignIn = pathname === "/signin";
  if (onSignIn && loggedIn) return "/";
  if (!onSignIn && !loggedIn) return "/signin";
  return null;
}

// The token's `exp` in ms, or 0 when it can't be read.
function expiryMs(token: string): number {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}
