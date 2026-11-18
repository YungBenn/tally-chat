import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexError } from "convex/values";
import { resultText } from "./toolResult";
import { guardedFetch, type GuardOptions } from "./urlGuard";

// Remote MCP over Streamable HTTP only (spec phase 10). Every request goes through the URL
// guard, so a tool server can't reach a private address unless the owner allowlisted it.

export type McpTool = { name: string; description?: string; inputSchema: string };

const CONNECT_TIMEOUT_MS = 20_000;
const MAX_TOOLS = 200;

async function withClient<T>(
  url: string,
  headers: Record<string, string>,
  guard: GuardOptions,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
    fetch: (input, init) =>
      guardedFetch(input instanceof Request ? input.url : String(input), init ?? {}, guard),
  });
  const client = new Client({ name: "tally-chat", version: "0.1.0" });
  try {
    await client.connect(transport, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) }).catch((err) => {
      throw toConvexError(err);
    });
    return await run(client);
  } finally {
    await client.close().catch(() => {});
  }
}

// What the owner sees when a server can't be reached. Header values never appear in these.
export function toConvexError(err: unknown): ConvexError<string> {
  if (err instanceof ConvexError) return err;
  const message = err instanceof Error ? err.message : "";
  const status = err instanceof StreamableHTTPError ? err.code : undefined;
  if (status === 401 || status === 403) return new ConvexError("The server rejected these headers");
  if (status === 404) return new ConvexError("No MCP server at that URL (404)");
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
    return new ConvexError("The server took too long to answer");
  return new ConvexError(`Could not connect to the server${message ? `: ${message.slice(0, 200)}` : ""}`);
}

export const listMcpTools = (url: string, headers: Record<string, string>, guard: GuardOptions) =>
  withClient(url, headers, guard, async (client) => {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor }, { timeout: CONNECT_TIMEOUT_MS }).catch((err) => {
        throw toConvexError(err);
      });
      for (const t of page.tools)
        tools.push({ name: t.name, description: t.description, inputSchema: JSON.stringify(t.inputSchema) });
      cursor = page.nextCursor;
    } while (cursor && tools.length < MAX_TOOLS);
    return tools.slice(0, MAX_TOOLS);
  });

export const TOOL_CALL_TIMEOUT_MS = 60_000;

// One tool call on its own connection. `stopped` aborts it (the reply was stopped). A call over
// 60 seconds comes back as timedOut, a protocol or transport error as error: never a throw, so
// a failing tool can't fail the reply (spec phase 10).
export async function callMcpTool(
  url: string,
  headers: Record<string, string>,
  guard: GuardOptions,
  name: string,
  args: Record<string, unknown>,
  stopped: AbortSignal,
): Promise<{ status: "ok" | "error" | "timedOut"; text: string }> {
  const timeout = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS);
  try {
    return await withClient(url, headers, guard, async (client) => {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal: AbortSignal.any([timeout, stopped]),
        timeout: TOOL_CALL_TIMEOUT_MS,
      });
      return {
        status: result.isError ? ("error" as const) : ("ok" as const),
        text: resultText(result.content as { type: string; text?: string }[] | undefined),
      };
    });
  } catch (err) {
    if (timeout.aborted) return { status: "timedOut", text: "" };
    const reason = err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : "";
    return { status: "error", text: reason.slice(0, 300) };
  }
}
