"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { CacheBreakDialog } from "@/components/Messages";
import { keysOf, picksOf, ToolChecklist } from "@/components/ToolPicker";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { tokens } from "@/lib/format";

/**
 * Change an existing thread's tools (spec phase 10). Tool definitions open every request, so the
 * dialog first says what rewriting the whole cached prefix costs, with the picks as they stand.
 * Cancelling changes nothing.
 */
export function ChangeToolsDialog({ threadId, onClose }: { threadId: Id<"threads">; onClose: () => void }) {
  const servers = useQuery(api.toolServers.list);
  const skills = useQuery(api.skills.list);
  const current = useQuery(api.chat.threadTools, { threadId });
  // add_skill can be picked only while its setting is on (or the change would be refused).
  const settings = useQuery(api.settings.get);
  const addSkill = settings?.addSkillOnForNewThreads === true;
  const setTools = useMutation(api.chat.setThreadTools);
  const [now] = useState(() => Date.now());
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const start = keysOf(current?.picks ?? []);
  const chosen = picked ?? start;
  const picks = picksOf(servers ?? [], skills ?? [], addSkill, chosen);
  const cost = useQuery(api.inspector.toolChange, { threadId, now, tools: picks });
  const unchanged = chosen.size === start.size && [...chosen].every((k) => start.has(k));
  return (
    <CacheBreakDialog
      open
      extraMicroUsd={cost?.extraMicroUsd ?? null}
      action={{ verb: "Changing tools", confirm: busy ? "Changing…" : "Change tools" }}
      cancelLabel="Keep current tools"
      body={`Tool definitions come first in every request, so the next one writes the whole conversation to the cache again${cost ? ` (about ${tokens(cost.prefixTokens)} tokens)` : ""}. Messages already sent keep their tool calls and results.`}
      confirmDisabled={unchanged || busy || !servers || !skills || !settings}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true);
        setTools({ threadId, tools: picks })
          .then(() => {
            toast({ title: "Tools changed", body: "The next message uses the new tools." });
            onClose();
          })
          .catch((err) => {
            setBusy(false);
            toast({
              title: "Could not change the tools",
              body: err instanceof ConvexError ? String(err.data) : undefined,
              tone: "danger",
            });
          });
      }}
    >
      <div className="mt-4 max-h-[40vh] overflow-y-auto">
        <ToolChecklist servers={servers ?? []} skills={skills ?? []} addSkill={addSkill} chosen={chosen} onChange={setPicked} />
      </div>
    </CacheBreakDialog>
  );
}
