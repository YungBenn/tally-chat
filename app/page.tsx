import AppHeader from "@/components/AppHeader";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="font-serif text-xl text-muted">No threads yet.</p>
      </main>
    </div>
  );
}
