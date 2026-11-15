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
    if (objects.every((c) => Array.isArray(c.chat_messages)))
      return {
        source: "claude",
        conversations: nonEmpty(objects.map(claudeConversation)),
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

type Kept = { role: "user" | "assistant"; content: string; model?: string };
type RawNode = { parent?: string; kept?: Kept }; // no `kept`: dropped, its children move up

// Turns an export's message tree into messages to write, root first. Dropped nodes' children
// attach to their nearest kept ancestor. A kept node whose kept children all share its role is
// folded into them (its text leads theirs); otherwise it's written, and same-role children
// still fold it in as siblings, so every path reads as alternating turns. The thread opens on
// `current`'s nearest kept ancestor, or the newest message.
function assembleTree(
  nodes: Map<string, RawNode>,
  current: string | undefined,
) {
  const keptParent = (id: string | undefined): string | undefined => {
    const seen = new Set<string>();
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      if (nodes.get(id)?.kept) return id;
      id = nodes.get(id)?.parent;
    }
    return undefined;
  };
  const kept = new Map(
    [...nodes].flatMap(([id, n]) => (n.kept ? [[id, n.kept] as const] : [])),
  );
  const children = new Map<string | undefined, string[]>();
  for (const id of kept.keys()) {
    const parent = keptParent(nodes.get(id)?.parent);
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const activeKept = current !== undefined ? keptParent(current) : undefined;

  const messages: ImportedMessage[] = [];
  const written = new Set<string>();
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
      written.add(id);
      for (const k of other) emit(k, id, undefined);
    }
    for (const k of same) emit(k, parentKey, content, model);
  };
  for (const root of children.get(undefined) ?? [])
    emit(root, undefined, undefined);
  const activeKey =
    activeKept && written.has(activeKept) ? activeKept : messages.at(-1)?.key;
  return { messages, activeKey };
}

// ChatGPT: a node map with parent links and a current node. User and assistant text is kept;
// image and file parts become placeholders; system, tool, hidden and empty nodes are dropped.
function chatgptConversation(c: Json): ImportedConversation {
  const nodes = new Map<string, RawNode>();
  for (const [id, raw] of Object.entries(
    c.mapping as Record<string, unknown>,
  )) {
    if (!isObject(raw)) continue;
    nodes.set(id, {
      parent: str(raw.parent),
      kept: chatgptMessage(raw.message),
    });
  }
  const { messages, activeKey } = assembleTree(nodes, str(c.current_node));
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

function chatgptMessage(m: unknown): Kept | undefined {
  if (!isObject(m)) return undefined;
  const role = isObject(m.author) ? m.author.role : undefined;
  if (role !== "user" && role !== "assistant") return undefined;
  const meta = isObject(m.metadata) ? m.metadata : {};
  if (meta.is_visually_hidden_from_conversation === true) return undefined;
  if (str(m.recipient) && m.recipient !== "all") return undefined; // a tool call
  const content = chatgptText(m.content, meta);
  if (!content) return undefined;
  const model = role === "assistant" ? str(meta.model_slug) : undefined;
  return { role, content, ...(model ? { model } : {}) };
}

// Claude: a list of human and assistant messages. Text blocks are joined; attachments and files
// become placeholders; tool use and results are left out. Messages with a parent reference form
// a tree, others follow the one before. The latest message is active.
const CLAUDE_ROOT = "00000000-0000-4000-8000-000000000000";
function claudeConversation(c: Json): ImportedConversation {
  const list = (c.chat_messages as unknown[]).filter(isObject);
  const ids = new Set(list.map((m) => str(m.uuid)).filter(Boolean));
  const nodes = new Map<string, RawNode>();
  let previous: string | undefined;
  let latest: { id: string; at: number } | undefined;
  list.forEach((m, i) => {
    const id = str(m.uuid) ?? `message-${i}`;
    const ref = str(m.parent_message_uuid);
    const parent =
      ref === undefined
        ? previous
        : ref !== CLAUDE_ROOT && ids.has(ref)
          ? ref
          : undefined;
    nodes.set(id, { parent, kept: claudeMessage(m) });
    previous = id;
    const at = Date.parse(str(m.created_at) ?? "") || i;
    if (!latest || at >= latest.at) latest = { id, at };
  });
  const { messages, activeKey } = assembleTree(nodes, latest?.id);
  const created = Date.parse(str(c.created_at) ?? "") || Date.now();
  return {
    externalId: str(c.uuid) ?? `${created}`,
    title: titleFrom(str(c.name), messages),
    startedAt: created,
    messages,
    activeKey,
  };
}

function claudeMessage(m: Json): Kept | undefined {
  const role =
    m.sender === "human"
      ? "user"
      : m.sender === "assistant"
        ? "assistant"
        : undefined;
  if (!role) return undefined;
  const blocks = Array.isArray(m.content) ? m.content.filter(isObject) : null;
  const pieces = blocks
    ? blocks.flatMap((b) =>
        b.type === "text" && str(b.text)?.trim() ? [str(b.text)!] : [],
      )
    : str(m.text)?.trim()
      ? [str(m.text)!]
      : [];
  for (const a of Array.isArray(m.attachments)
    ? m.attachments.filter(isObject)
    : [])
    pieces.push(filePlaceholder(str(a.file_name)));
  for (const f of Array.isArray(m.files) ? m.files.filter(isObject) : [])
    pieces.push(
      f.file_kind === "image" ||
        /\.(png|jpe?g|gif|webp)$/i.test(str(f.file_name) ?? "")
        ? IMAGE_PLACEHOLDER
        : filePlaceholder(str(f.file_name)),
    );
  const content = pieces.join("\n\n").trim();
  return content ? { role, content } : undefined;
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
