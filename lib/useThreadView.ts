"use client";

import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useThreadCache } from "@/lib/useCacheState";

// What the thread page needs to paint, through the query cache (kept 30 minutes, see the (app)
// layout). The sidebar's hover prefetch calls this same hook, so the two lists can't drift. The
// inspector, the heaviest query, isn't here: it loads when the thread opens.
export function useThreadView(threadId: Id<"threads">) {
  return {
    stored: useQuery(api.chat.getThread, { threadId }),
    providers: useQuery(api.providers.list),
    threadCache: useThreadCache(threadId),
  };
}
