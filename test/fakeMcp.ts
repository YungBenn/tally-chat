// A fake MCP server at the HTTP boundary (Streamable HTTP, JSON responses): answers initialize,
// tools/list and tools/call for fakeFetch. `call` decides a tools/call result.
export type FakeTool = { name: string; description?: string; inputSchema?: object };
export type FakeMcpOptions = {
  tools: FakeTool[] | (() => FakeTool[]);
  call?: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
  status?: number; // answer every POST with this HTTP status
};

export function fakeMcp(url: string, opts: FakeMcpOptions) {
  return {
    [`POST ${url}`]: {
      respond: (init: RequestInit | undefined) => {
        if (opts.status) return new Response("nope", { status: opts.status });
        const msg = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } };
        if (msg.id === undefined) return new Response(null, { status: 202 }); // notification
        const result = async () => {
          if (msg.method === "initialize")
            return {
              protocolVersion: msg.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fake", version: "1" },
            };
          if (msg.method === "tools/list") {
            const tools = typeof opts.tools === "function" ? opts.tools() : opts.tools;
            return { tools: tools.map((t) => ({ inputSchema: { type: "object" }, ...t })) };
          }
          if (msg.method === "tools/call")
            return opts.call
              ? await opts.call(msg.params?.name ?? "", msg.params?.arguments ?? {})
              : { content: [{ type: "text", text: "ok" }] };
          return {};
        };
        return new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: await result() })));
              c.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
    [`GET ${url}`]: { respond: () => new Response("", { status: 405 }) },
    [`DELETE ${url}`]: { respond: () => new Response("", { status: 405 }) },
  } as const;
}
