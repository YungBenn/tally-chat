import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { AppShell } from "@/components/ChatShell";

// A thread visited (or hovered in the sidebar) in the last 30 minutes opens with no wait: queries
// read through the cache stay subscribed this long after their component unmounts.
const CACHE_MS = 30 * 60_000;

// Every page with the sidebar shares this layout, so the sidebar stays mounted between them.
// Sign-in lives outside it.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexQueryCacheProvider expiration={CACHE_MS}>
      <AppShell>{children}</AppShell>
    </ConvexQueryCacheProvider>
  );
}
