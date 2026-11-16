const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

// A backend URL (the Convex client, upload and file URLs) as this browser can reach it. Dev and
// a plain self-host hand out loopback URLs; opened from another device (Tailscale, LAN) those
// would point at that device, so the host serving this page stands in. The backend listens on
// every interface, on the same ports.
export function reachable(url: string, pageHost = globalThis.location?.hostname): string {
  const u = new URL(url);
  if (!pageHost || !LOOPBACK.has(u.hostname) || LOOPBACK.has(pageHost)) return url;
  u.hostname = pageHost;
  // URL adds a "/" path to a bare origin; keep the caller's shape.
  return url.endsWith("/") || u.pathname !== "/" ? u.href : u.href.slice(0, -1);
}
