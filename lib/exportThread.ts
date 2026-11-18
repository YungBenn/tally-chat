import { metaLine, usd } from "./format";

// The active branch of a thread as the thread page already holds it (api.chat.getThread).
type Usage = Parameters<typeof metaLine>[2];
export type ExportThread = {
  title: string;
  messages: {
    role: "user" | "assistant";
    status: "streaming" | "waiting" | "done" | "stopped" | "error";
    text: string;
    model?: string;
    modelName?: string;
    effort?: string;
    usage?: Usage;
    costMicroUsd?: number;
    truncated?: boolean;
    images?: unknown[];
    error?: string;
  }[];
};

// Failed and still-streaming replies have no text worth keeping.
const kept = (t: ExportThread) =>
  t.messages.filter((m) => m.status === "done" || m.status === "stopped");

const repliesCost = (t: ExportThread) => {
  const costs = kept(t).flatMap((m) =>
    m.costMicroUsd === undefined ? [] : [m.costMicroUsd],
  );
  return costs.length ? costs.reduce((a, b) => a + b, 0) : undefined;
};

export function toMarkdown(t: ExportThread, at: Date) {
  const total = repliesCost(t);
  const lines = [
    `# ${t.title}`,
    "",
    `_Exported from tally.chat on ${at.toISOString().slice(0, 10)}.${total === undefined ? "" : ` Replies cost: ${usd(total)}.`}_`,
    "",
  ];
  for (const m of kept(t)) {
    lines.push(`## ${m.role === "user" ? "User" : "Assistant"}`, "");
    if (m.role === "assistant") {
      const name = m.modelName ?? m.model;
      const meta = [
        ...(name
          ? [m.usage ? metaLine(name, m.costMicroUsd, m.usage, m.effort) : name]
          : []),
        ...(m.status === "stopped" ? ["stopped"] : []),
        ...(m.truncated ? ["cut off at the length limit"] : []),
      ];
      if (meta.length) lines.push(`_${meta.join(" · ")}_`, "");
    }
    lines.push(m.text, "");
    const n = m.images?.length ?? 0;
    if (n) lines.push(`_[${n} image${n === 1 ? "" : "s"}]_`, "");
  }
  return lines.join("\n");
}

export function toJson(t: ExportThread, at: Date) {
  return JSON.stringify(
    {
      format: "tally.chat/thread",
      version: 1,
      title: t.title,
      exportedAt: at.toISOString(),
      repliesCostMicroUsd: repliesCost(t),
      messages: kept(t).map((m) => ({
        role: m.role,
        text: m.text,
        model: m.model,
        effort: m.effort,
        usage: m.usage,
        costMicroUsd: m.costMicroUsd,
        stopped: m.status === "stopped" || undefined,
        truncated: m.truncated,
        imageCount: m.images?.length || undefined,
      })),
    },
    null,
    2,
  );
}

export const exportFileName = (title: string, ext: "md" | "json") =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "thread"
  }.${ext}`;
