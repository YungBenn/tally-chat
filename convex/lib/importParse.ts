// Parsing a ChatGPT or Claude data export's conversations.json into conversations ready to
// write as threads (spec phase 7, import). Pure: no database, no clock beyond the fallback.

export type ImportSource = "chatgpt" | "claude";
export type ImportedMessage = {
  key: string; // unique within the conversation
  parentKey?: string;
  role: "user" | "assistant";
  content: string;
  model?: string; // the original model slug, when the export has it
};
export type ImportedConversation = {
  externalId: string;
  title: string;
  startedAt: number; // ms
  messages: ImportedMessage[]; // root first: every parent before its children
  activeKey?: string; // the message the thread opens on
};

export const NOT_AN_EXPORT =
  "This isn't a ChatGPT or Claude conversations.json export";
export const IMAGE_PLACEHOLDER = "[image]";
const filePlaceholder = (name?: string) =>
  name ? `[file: ${name}]` : "[file]";
const TITLE_CHARS = 60;

type Json = Record<string, unknown>;
const isObject = (x: unknown): x is Json =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

export function parseExport(data: unknown): {
  source: ImportSource;
  conversations: ImportedConversation[];
} {
  if (!Array.isArray(data)) throw new Error(NOT_AN_EXPORT);
  const objects = data.filter(isObject);
  if (data.length > 0 && objects.length === data.length) {
    if (objects.every((c) => isObject(c.mapping)))
      return {
        source: "chatgpt",
        conversations: nonEmpty(objects.map(chatgptConversation)),
      };
  }
  throw new Error(NOT_AN_EXPORT);
}

// A conversation with nothing left to show (all system or tool messages) isn't imported.
const nonEmpty = (cs: ImportedConversation[]) =>
  cs.filter((c) => c.messages.length > 0);

const titleFrom = (title: string | undefined, messages: ImportedMessage[]) =>
  title?.trim() ||
  messages[0]?.content.replace(/\s+/g, " ").slice(0, TITLE_CHARS) ||
  "Imported conversation";

// ChatGPT: a node map with parent and children links and a current node. User and assistant
// text is kept; image and file parts become placeholders; system, tool, hidden and empty nodes
// are dropped, their children attaching to the nearest kept ancestor; consecutive same-role
// messages on a path merge into one.
function chatgptConversation(c: Json): ImportedConversation {
  const mapping = c.mapping as Record<string, Json>;
  type Node = {
    id: string;
    parent?: string;
    children: string[];
    message?: Json;
  };
  const nodes = new Map<string, Node>();
  for (const [id, raw] of Object.entries(mapping)) {
    if (!isObject(raw)) continue;
    nodes.set(id, {
      id,
      parent: str(raw.parent) ?? undefined,
      children: Array.isArray(raw.children)
        ? raw.children.filter((x): x is string => typeof x === "string")
        : [],
      message: isObject(raw.message) ? raw.message : undefined,
    });
  }

  const kept = new Map<
    string,
    { role: "user" | "assistant"; content: string; model?: string }
  >();
  for (const node of nodes.values()) {
    const m = node.message;
    if (!m) continue;
    const role = isObject(m.author) ? m.author.role : undefined;
    if (role !== "user" && role !== "assistant") continue;
    const meta = isObject(m.metadata) ? m.metadata : {};
    if (meta.is_visually_hidden_from_conversation === true) continue;
    if (str(m.recipient) && m.recipient !== "all") continue; // a tool call
    const content = chatgptText(m.content, meta);
    if (!content) continue;
    kept.set(node.id, {
      role,
      content,
      model: role === "assistant" ? str(meta.model_slug) : undefined,
    });
  }

  // Kept tree: each kept node under its nearest kept ancestor.
  const keptParent = (id: string | undefined): string | undefined => {
    const seen = new Set<string>();
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      if (kept.has(id)) return id;
      id = nodes.get(id)?.parent;
    }
    return undefined;
  };
  const children = new Map<string | undefined, string[]>();
  for (const id of kept.keys()) {
    const parent = keptParent(nodes.get(id)?.parent);
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const current = str(c.current_node);
  const activeKept = current !== undefined ? keptParent(current) : undefined;

  // Emit root first. A node whose kept children all share its role is folded into them (its
  // text leads theirs); otherwise it's written, and same-role children still fold it in as
  // siblings, so every path reads as alternating turns.
  const messages: ImportedMessage[] = [];
  const keyOf = new Map<string, string>(); // kept node -> the written message holding its text
  const emit = (
    id: string,
    parentKey: string | undefined,
    prefix: string | undefined,
    prefixModel?: string,
  ) => {
    const node = kept.get(id)!;
    const content = prefix ? `${prefix}\n\n${node.content}` : node.content;
    const model = node.model ?? prefixModel;
    const kids = children.get(id) ?? [];
    const same = kids.filter((k) => kept.get(k)!.role === node.role);
    const other = kids.filter((k) => kept.get(k)!.role !== node.role);
    if (other.length > 0 || same.length === 0 || id === activeKept) {
      messages.push({
        key: id,
        parentKey,
        role: node.role,
        content,
        ...(model ? { model } : {}),
      });
      keyOf.set(id, id);
      for (const k of other) emit(k, id, undefined);
    }
    for (const k of same) emit(k, parentKey, content, model);
  };
  for (const root of children.get(undefined) ?? [])
    emit(root, undefined, undefined);

  // The thread opens on the current node's nearest kept ancestor; without one, the newest leaf.
  const activeKey =
    (activeKept && keyOf.get(activeKept)) ?? messages.at(-1)?.key;
  const created =
    typeof c.create_time === "number" ? c.create_time * 1000 : Date.now();
  return {
    externalId: str(c.conversation_id) ?? str(c.id) ?? `${created}`,
    title: titleFrom(str(c.title), messages),
    startedAt: created,
    messages,
    activeKey,
  };
}

// Text parts joined; image parts and attachments as placeholders. Code, tool output and other
// content types carry no conversation text and come back empty.
function chatgptText(content: unknown, meta: Json) {
  if (!isObject(content)) return "";
  const type = content.content_type;
  if (type !== "text" && type !== "multimodal_text") return "";
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const pieces = parts.flatMap((p) => {
    if (typeof p === "string") return p.trim() ? [p] : [];
    if (!isObject(p)) return [];
    if (p.content_type === "image_asset_pointer") return [IMAGE_PLACEHOLDER];
    return [filePlaceholder()];
  });
  const attachments = Array.isArray(meta.attachments)
    ? meta.attachments.filter(isObject)
    : [];
  for (const a of attachments) {
    if (str(a.mime_type)?.startsWith("image/")) continue; // already an image part
    pieces.push(filePlaceholder(str(a.name)));
  }
  return pieces.join("\n\n").trim();
}
