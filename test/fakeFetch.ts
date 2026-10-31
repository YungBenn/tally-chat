// Fake provider at the HTTP boundary (spec seam 1): replays recorded
// responses by "METHOD url" and captures every request body sent.
export type Recorded = { status?: number; body: unknown; headers?: Record<string, string> };

export function fakeFetch(fixtures: Record<string, Recorded>) {
  const requests: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = init?.body;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    requests.push({ method, url, headers, body: typeof raw === "string" ? JSON.parse(raw) : raw });
    const fixture = fixtures[`${method} ${url}`];
    if (!fixture) throw new Error(`fakeFetch: no fixture for ${method} ${url}`);
    const body = typeof fixture.body === "string" ? fixture.body : JSON.stringify(fixture.body);
    return new Response(body, { status: fixture.status ?? 200, headers: fixture.headers });
  };

  return { requests, restore: () => void (globalThis.fetch = original) };
}
