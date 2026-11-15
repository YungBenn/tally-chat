// A stand-in OpenAI-compatible model server for the smoke check: lists one priced model and
// answers every chat completion with a fixed reply and usage.
const usage = { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46 };
const REPLY = "Smoke test reply";
const chunk = (o: object) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "gpt-5-mini", ...o })}\n\n`;

// Bun serves a default export that has `fetch`.
const server = {
  port: 8080,
  async fetch(req: Request) {
    const { pathname } = new URL(req.url);
    if (pathname === "/v1/models") return Response.json({ data: [{ id: "gpt-5-mini" }] });
    if (pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
    const body = (await req.json()) as { stream?: boolean };
    if (!body.stream)
      return Response.json({
        id: "c", object: "chat.completion", created: 0, model: "gpt-5-mini", usage,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Smoke title" } }],
      });
    return new Response(
      chunk({ choices: [{ index: 0, delta: { role: "assistant", content: REPLY } }] }) +
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
        chunk({ choices: [], usage }) +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  },
};
export default server;
