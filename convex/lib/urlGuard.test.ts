import { afterEach, describe, expect, test } from "vitest";
import { fakeFetch } from "../../test/fakeFetch";
import { guardedFetch, isBlockedAddress } from "./urlGuard";

// Spec seam 2: the guard with an injected resolver.
const resolveTo = (...addresses: string[]) => async () => addresses;
const ok = { body: { ok: true } };
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

describe("isBlockedAddress", () => {
  test.each([
    "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "0.0.0.0", "169.254.169.254",
    "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a00:1", "2002:a00:1::1", "[::1]",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  test.each(["160.79.104.10", "8.8.8.8", "172.32.0.1", "2607:6bc0::10", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("guardedFetch", () => {
  test("public https host goes through", async () => {
    fake = fakeFetch({ "GET https://api.example.com/x": ok });
    const res = await guardedFetch("https://api.example.com/x", {}, { allowlist: [], resolve: resolveTo("160.79.104.10") });
    expect(res.status).toBe(200);
  });

  test("refuses a hostname whose DNS answer includes any private address", async () => {
    fake = fakeFetch({});
    const opts = { allowlist: [], resolve: resolveTo("160.79.104.10", "10.0.0.7") };
    await expect(guardedFetch("https://sneaky.example.com/x", {}, opts)).rejects.toThrow("private address");
    expect(fake.requests).toEqual([]);
  });

  test("refuses private, loopback, link-local and metadata IP literals", async () => {
    fake = fakeFetch({});
    const opts = { allowlist: [], resolve: resolveTo() };
    for (const url of ["https://127.0.0.1/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://[::ffff:10.0.0.1]/"]) {
      await expect(guardedFetch(url, {}, opts)).rejects.toThrow("private address");
    }
    expect(fake.requests).toEqual([]);
  });

  test("refuses plain http unless the host is allowlisted", async () => {
    fake = fakeFetch({ "GET http://ollama.lan:11434/api": ok });
    await expect(guardedFetch("http://api.example.com/", {}, { allowlist: [], resolve: resolveTo("160.79.104.10") })).rejects.toThrow("https");
    const res = await guardedFetch("http://ollama.lan:11434/api", {}, { allowlist: ["ollama.lan:11434"], resolve: resolveTo("192.168.1.9") });
    expect(res.status).toBe(200);
  });

  test("allowlist entries match host with port or hostname alone", async () => {
    fake = fakeFetch({ "GET http://192.168.1.20:8080/": ok, "GET http://192.168.1.21:9000/": ok });
    const resolve = resolveTo();
    await guardedFetch("http://192.168.1.20:8080/", {}, { allowlist: ["192.168.1.20:8080"], resolve });
    await guardedFetch("http://192.168.1.21:9000/", {}, { allowlist: ["192.168.1.21"], resolve });
    await expect(guardedFetch("http://192.168.1.20:9999/", {}, { allowlist: ["192.168.1.20:8080"], resolve })).rejects.toThrow();
  });

  test("re-checks every redirect hop: a public URL redirecting into a private range is refused", async () => {
    fake = fakeFetch({
      "GET https://public.example.com/start": { status: 302, body: "", headers: { location: "https://internal.example.com/admin" } },
    });
    const resolve = async (host: string) => (host === "public.example.com" ? ["160.79.104.10"] : ["10.0.0.9"]);
    await expect(guardedFetch("https://public.example.com/start", {}, { allowlist: [], resolve })).rejects.toThrow("private address");
    expect(fake.requests.map((r) => r.url)).toEqual(["https://public.example.com/start"]);
  });

  test("follows safe redirects and stops after too many", async () => {
    fake = fakeFetch({
      "GET https://a.example.com/": { status: 301, body: "", headers: { location: "/next" } },
      "GET https://a.example.com/next": ok,
      "GET https://loop.example.com/": { status: 302, body: "", headers: { location: "https://loop.example.com/" } },
    });
    const resolve = resolveTo("160.79.104.10");
    expect((await guardedFetch("https://a.example.com/", {}, { allowlist: [], resolve })).status).toBe(200);
    await expect(guardedFetch("https://loop.example.com/", {}, { allowlist: [], resolve })).rejects.toThrow("Too many redirects");
  });

  test("refuses when the host does not resolve", async () => {
    fake = fakeFetch({});
    const resolve = async () => { throw new Error("ENOTFOUND"); };
    await expect(guardedFetch("https://nope.example.com/", {}, { allowlist: [], resolve })).rejects.toThrow("Could not resolve");
  });
});
