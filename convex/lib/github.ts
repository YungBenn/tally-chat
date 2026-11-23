import { ConvexError } from "convex/values";
import { parseSkill, type ParsedSkill, type SkillFile } from "./skills";
import { guardedFetch, type GuardOptions } from "./urlGuard";

// Reads a skill folder from a public GitHub repo: one tree listing through the API (no token),
// then each file's raw text. Every request goes through the URL guard.

type Location = { repo: string; ref: string; path: string };

// github.com/<owner>/<repo>, .../tree/<ref>/<path> or .../blob/<ref>/<path>/SKILL.md.
// ponytail: a ref containing "/" is read as ref + path; the tree API can't tell them apart either.
function locate(input: string): Location | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const [owner, repo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  const name = `${owner}/${repo.replace(/\.git$/, "")}`;
  if (!kind) return { repo: name, ref: "HEAD", path: "" };
  if (!ref || (kind !== "tree" && kind !== "blob")) return null;
  if (kind === "blob" && rest.at(-1) !== "SKILL.md") return null;
  return { repo: name, ref, path: (kind === "blob" ? rest.slice(0, -1) : rest).map(decodeURIComponent).join("/") };
}

const normalized = ({ repo, ref, path }: Location) =>
  ref === "HEAD" && !path ? `https://github.com/${repo}` : `https://github.com/${repo}/tree/${ref}${path ? `/${path}` : ""}`;

async function get(url: string, guard: GuardOptions): Promise<Response> {
  const res = await guardedFetch(url, { headers: { "User-Agent": "tally-chat" } }, guard);
  if (res.ok) return res;
  const text = await res.text();
  let message = text.trim() || `HTTP ${res.status}`;
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? message;
  } catch {
    // not JSON: keep the text
  }
  throw new GithubError(message);
}

class GithubError extends Error {}

export type ResolvedGithub = { ok: true; source: string; files: SkillFile[] } | { ok: false; reason: string };

/** Fetches the skill folder a GitHub URL points at; `source` is the URL to store and refresh from. */
export async function resolveGithubSkill(input: string, guard: GuardOptions): Promise<ResolvedGithub> {
  const at = locate(input);
  if (!at) return { ok: false, reason: "Enter a GitHub URL to a repo, a folder or a SKILL.md file." };
  try {
    const api = `https://api.github.com/repos/${at.repo}/git/trees/${encodeURIComponent(at.ref)}?recursive=1`;
    // ponytail: a truncated listing (repos over 100k entries) may miss files; list per folder if that bites.
    const { tree } = (await (await get(api, guard)).json()) as { tree: { path: string; type: string }[] };
    const prefix = at.path ? `${at.path}/` : "";
    const blobs = tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix)).map((e) => e.path);

    if (!blobs.includes(`${prefix}SKILL.md`)) {
      const folders = blobs.filter((p) => p.endsWith("/SKILL.md")).map((p) => p.slice(0, -"/SKILL.md".length));
      return {
        ok: false,
        reason: folders.length
          ? `There is no SKILL.md here, but these folders have one: ${folders.sort().join(", ")}.`
          : `No SKILL.md found in ${at.path || "the repo"}.`,
      };
    }
    const raw = (p: string) =>
      `https://raw.githubusercontent.com/${at.repo}/${encodeURIComponent(at.ref)}/${p.split("/").map(encodeURIComponent).join("/")}`;
    const files = await Promise.all(
      blobs.map(async (p) => ({ path: p.slice(prefix.length), text: await (await get(raw(p), guard)).text() })),
    );
    return { ok: true, source: normalized(at), files };
  } catch (err) {
    if (err instanceof GithubError) return { ok: false, reason: `GitHub said: ${err.message}` };
    if (err instanceof ConvexError) return { ok: false, reason: String(err.data) };
    throw err;
  }
}

// Fetches and validates a GitHub skill; a bad URL, a GitHub error or a bad skill comes back as a reason.
export async function fetchGithubSkill(
  url: string,
  guard: GuardOptions,
): Promise<{ ok: true; skill: ParsedSkill; source: string } | { ok: false; reason: string }> {
  const fetched = await resolveGithubSkill(url, guard);
  if (!fetched.ok) return fetched;
  const parsed = parseSkill(fetched.files);
  return parsed.ok ? { ok: true, skill: parsed.skill, source: fetched.source } : parsed;
}
