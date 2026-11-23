import { expect, test } from "vitest";
import { carryRowKeys, isOptimistic, withSentTurn } from "./optimisticSend";
import type { Id } from "@/convex/_generated/dataModel";

const msg = (id: string, role: "user" | "assistant", text: string) => ({
  _id: id as Id<"messages">,
  pinned: false,
  pinLocked: false,
  siblingIds: [id as Id<"messages">],
  role,
  status: role === "assistant" ? "done" : undefined,
  text,
});

const thread = {
  title: "T",
  providerId: "p" as Id<"providers">,
  modelId: "m",
  importedFrom: null,
  messages: [msg("u1", "user", "hi"), msg("a1", "assistant", "hello")],
  checkpoint: null,
  cacheManaged: true,
  vision: true,
} as never;

test("sending adds my message and a streaming reply placeholder at the end of the branch", () => {
  const out = withSentTurn(thread, { content: "  next question \n" }, { images: [], documents: [] }, "1");
  const [user, reply] = out.messages.slice(2);
  expect(out.messages.slice(0, 2)).toEqual((thread as { messages: unknown[] }).messages);
  expect(user).toMatchObject({ role: "user", text: "next question", pinned: false });
  expect(reply).toMatchObject({ role: "assistant", status: "streaming", text: "" });
  expect(isOptimistic(user._id) && isOptimistic(reply._id)).toBe(true);
  expect(isOptimistic("k57abc")).toBe(false);
});

test("the placeholder shows the attached images, documents and a pending web search", () => {
  const out = withSentTurn(
    thread,
    {
      content: "look",
      images: [{ storageId: "s" as Id<"_storage">, width: 40, height: 30, mediaType: "image/png" }],
      search: true,
    },
    { images: ["blob:preview"], documents: [{ name: "a.pdf", tokens: 120, fromThreadId: undefined, fromSkillId: undefined }] },
    "2",
  );
  expect(out.messages[2]).toMatchObject({
    images: [{ url: "blob:preview", width: 40, height: 30 }],
    documents: [{ name: "a.pdf", tokens: 120 }],
    search: { status: "pending", results: [] },
  });
});

test("the real messages take over the placeholders' row keys, so their rows don't remount", () => {
  const before = [msg("u1", "user", "hi"), msg("optimistic:3-user", "user", "q"), msg("optimistic:3-reply", "assistant", "")];
  const after = [msg("u1", "user", "hi"), msg("u2", "user", "q"), msg("a2", "assistant", "")];
  const keys = carryRowKeys(new Map(), before, after);
  expect(after.map((m) => keys.get(m._id) ?? m._id)).toEqual(["u1", "optimistic:3-user", "optimistic:3-reply"]);
  // Keys persist across later updates and are dropped once their message leaves the branch.
  const later = carryRowKeys(keys, after, after);
  expect(later.get("a2")).toBe("optimistic:3-reply");
  expect(carryRowKeys(later, after, [msg("u1", "user", "hi")]).size).toBe(0);
});
