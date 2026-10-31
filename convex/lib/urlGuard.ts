import { ConvexError } from "convex/values";

// Every outbound provider request goes through guardedFetch (spec: outbound URL guard).
// Default: https only, and every address the host resolves to must be public.
// Allowlisted hosts skip both checks; that is how a self-hoster reaches Ollama on the LAN.

export type Resolve = (hostname: string) => Promise<string[]>;
export type GuardOptions = { allowlist: string[]; resolve: Resolve; maxRedirects?: number };

const IPV4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.map(Number);
}

function inPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const bit = (b: number[]) => (b[i >> 3] >> (7 - (i & 7))) & 1;
    if (bit(bytes) !== bit(prefix)) return false;
  }
  return true;
}

function isBlockedIPv4(bytes: number[]): boolean {
  return IPV4_BLOCKED.some(([net, bits]) => inPrefix(bytes, parseIPv4(net)!, bits));
}

function parseIPv6(ip: string): number[] | null {
  let s = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = parseIPv4(v4[1]);
    if (!b) return null;
    s = s.slice(0, -v4[1].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
}

function isBlockedIPv6(b: number[]): boolean {
  const zeroUpTo = (n: number) => b.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (zeroUpTo(10) && b[10] === 0xff && b[11] === 0xff) return isBlockedIPv4(b.slice(12)); // ::ffff:a.b.c.d
  if (zeroUpTo(12)) return isBlockedIPv4(b.slice(12)); // deprecated ::a.b.c.d
  if (inPrefix(b, [0x00, 0x64, 0xff, 0x9b, ...Array(12).fill(0)], 96)) return isBlockedIPv4(b.slice(12)); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIPv4(b.slice(2, 6)); // 6to4
  if ((b[0] & 0xfe) === 0xfc) return true; // unique local fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (b[0] === 0xff) return true; // multicast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isBlockedIPv6(v6);
  return true; // not an address we understand: refuse
}

const isIpLiteral = (host: string) => parseIPv4(host) !== null || parseIPv6(host) !== null;

export function isAllowlisted(url: URL, allowlist: string[]): boolean {
  return allowlist.some((entry) => entry === url.hostname || entry === url.host);
}

async function checkUrl(url: URL, opts: GuardOptions): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConvexError("Only http and https URLs are supported");
  if (isAllowlisted(url, opts.allowlist)) return;
  if (url.protocol !== "https:") throw new ConvexError(`${url.host} must use https, or be added to the private host allowlist`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIpLiteral(host) ? [host] : await opts.resolve(host).catch(() => []);
  if (addresses.length === 0) throw new ConvexError(`Could not resolve ${url.hostname}`);
  if (addresses.some(isBlockedAddress)) {
    throw new ConvexError(`${url.host} is a private address. Add it to the private host allowlist to use it.`);
  }
}

// ponytail: checks DNS, then lets fetch resolve again, so a rebinding DNS server
// can swap the address in between; pinning the connection needs a custom agent.
export async function guardedFetch(input: string, init: RequestInit, opts: GuardOptions): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    await checkUrl(url, opts);
    const res = await fetch(url.href, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    url = new URL(location, url);
  }
  throw new ConvexError("Too many redirects");
}
