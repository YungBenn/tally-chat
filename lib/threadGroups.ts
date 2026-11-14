const DAY = 86_400_000;

// Sidebar sections by the thread's age in the viewer's local days, newest first.
export function groupThreads<T extends { _creationTime: number }>(
  threads: T[],
  now = Date.now(),
) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const label = (t: number) =>
    t >= today
      ? "Today"
      : t >= today - DAY
        ? "Yesterday"
        : t >= today - 7 * DAY
          ? "Previous 7 days"
          : t >= today - 30 * DAY
            ? "Previous 30 days"
            : "Older";
  const groups: { label: string; threads: T[] }[] = [];
  for (const t of threads) {
    const l = label(t._creationTime);
    if (groups.at(-1)?.label !== l) groups.push({ label: l, threads: [] });
    groups.at(-1)!.threads.push(t);
  }
  return groups;
}
