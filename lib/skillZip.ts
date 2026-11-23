import { unzipSync } from "fflate";
import type { SkillFile } from "@/convex/lib/skills";

/** Unzips a skill folder in the browser into the `{ path, text }` list a single-file upload sends. */
export function unzipSkill(zip: Uint8Array): SkillFile[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: SkillFile[] = [];
  for (const [path, data] of Object.entries(unzipSync(zip))) {
    if (path.endsWith("/")) continue; // directory entry
    try {
      const text = decoder.decode(data);
      // NULs mark binary files that happen to be valid UTF-8, like the __MACOSX resource forks.
      if (!text.includes("\u0000")) files.push({ path, text });
    } catch {} // not UTF-8: a binary file
  }
  return files;
}
