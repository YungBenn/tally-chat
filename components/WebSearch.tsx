"use client";

import { IconWorld, IconWorldOff } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { Tooltip } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import { usd } from "@/lib/format";
import { useStoredFlag } from "@/lib/storedFlag";

/**
 * Whether the next message searches the web first. Offered only once an Exa API key is saved;
 * the choice is remembered in this browser.
 */
export function useWebSearch() {
  const settings = useQuery(api.settings.get);
  const [on, setOn] = useStoredFlag("tally.webSearch", false);
  const available = !!settings?.searchKeySet;
  return { available, on: available && on, setOn };
}

export function SearchToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Tooltip content={on ? "Searching the web before each reply" : "Search the web before the reply"}>
      <button
        type="button"
        className="tc-picker"
        aria-pressed={on}
        onClick={() => onChange(!on)}
      >
        <IconWorld size={14} stroke={1.75} />
        Search
      </button>
    </Tooltip>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Under a searched message: what the reply was given to read. */
export function SearchSources({
  search,
}: {
  search: {
    status: "pending" | "done" | "failed";
    results: { title: string; url: string }[];
    error?: string;
    costMicroUsd?: number;
  };
}) {
  if (search.status === "pending")
    return (
      <div className="tc-sources" aria-live="polite">
        <IconWorld size={14} stroke={1.75} />
        Searching the web…
      </div>
    );
  if (search.status === "failed")
    return (
      <div className="tc-sources" data-failed="true">
        <IconWorldOff size={14} stroke={1.75} />
        Web search failed: {search.error}
      </div>
    );
  return (
    <div className="tc-sources">
      <IconWorld size={14} stroke={1.75} />
      {search.results.length === 0
        ? "No web results"
        : search.results.map((r, i) => (
            <Tooltip key={i} content={r.title}>
              <a className="tc-source" href={r.url} target="_blank" rel="noopener noreferrer">
                <span className="tc-source-n">{i + 1}</span>
                {host(r.url)}
              </a>
            </Tooltip>
          ))}
      {search.costMicroUsd !== undefined && <span>· {usd(search.costMicroUsd)}</span>}
    </div>
  );
}
