import { AppShell } from "@/components/ChatShell";

// Every page with the sidebar shares this layout, so the sidebar stays mounted between them.
// Sign-in lives outside it.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
