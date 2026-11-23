# Spec: Skills

Status: ready-for-agent · Respects [ADR 0001](../adr/0001-append-only-message-tree.md), [ADR 0002](../adr/0002-convex-backend.md), [ADR 0003](../adr/0003-tool-results-stay-verbatim.md) and [ADR 0005](../adr/0005-skills-as-built-in-tools.md) · Vocabulary from [GLOSSARY.md](../../GLOSSARY.md)

## Problem Statement

I keep finding good Agent Skills (a `SKILL.md` with instructions, sometimes with reference files) that would make tally.chat's replies better at specific tasks: writing in a house style, a review checklist, a domain playbook. Today the only way to give the model that knowledge is to paste it into my custom instructions, which every request pays for, in every thread, whether the task needs it or not, and which is capped at 4000 characters.

I want to add skills to tally.chat once, either by hand in Settings or just by telling it in a chat ("add this skill to tally chat: <url>"), and have the model read a skill only when a task calls for it, without breaking the prompt cache of the threads I already have.

## Solution

Settings gets a **Skills** section next to Tool servers. I add a skill by uploading a `SKILL.md` or a zip of a skill folder, or by entering a public GitHub URL to a skill folder. Each skill shows its name, description, size and source, with an "on for new threads" switch, a view of its body, a refresh button (GitHub skills) and delete.

A new thread freezes its **skill catalog**, the names and descriptions of its skills, into its tool set, as the description of a **built-in tool** `read_skill`. When a task matches a skill, the model calls `read_skill` (no approval: it is read-only and local) and gets the body, or one of the skill's files, as a tool result kept word for word.

A second built-in tool, `add_skill`, lets me add a skill from chat. It always asks for approval and the approval card shows what will be added. The new skill is available from the next thread, and the reply says so. Both built-in tools appear in the thread's tool picker alongside tool servers' tools and can be left out.

## User Stories

### Adding skills by hand

1. As the owner, I want a Skills section in Settings next to Tool servers, so that everything the model can use is managed in one place.
2. As the owner, I want to upload a `SKILL.md` file, so that a single-file skill takes one step to add.
3. As the owner, I want to upload a zip of a skill folder, so that skills with reference files keep them.
4. As the owner, I want a zip whose files sit inside one top-level folder to work the same as a flat zip, so that a folder zipped by my OS just works.
5. As the owner, I want to add a skill from a public GitHub URL to a folder containing `SKILL.md`, so that shared skills (anthropics/skills, skills.sh listings) are one paste away.
6. As the owner, I want a GitHub URL pointing at a `SKILL.md` file itself to work too, so that I can copy whichever link I have.
7. As the owner, I want a URL to a repo or folder holding several skills to fail with a list of the skill folders found, so that I can pick the one I meant.
8. As the owner, I want binary files in a skill skipped when it is added, so that images and archives don't waste space or tokens.
9. As the owner, I want a skill over 1 MB of text rejected with its size, so that one skill can't bloat a thread.
10. As the owner, I want a skill whose `name` isn't lowercase letters, digits and hyphens (at most 64 characters) rejected with the reason, so that every skill follows the Agent Skills spec.
11. As the owner, I want a skill without a `description`, or with one over 1024 characters, rejected with the reason, so that the model always knows when to use it.
12. As the owner, I want adding a skill whose name already exists to say "replaces existing skill X" before I confirm, so that I never overwrite one by accident.
13. As the owner, I want a GitHub fetch error (not found, rate limited, private repo) shown in GitHub's words, so that I know what to fix.

### Managing skills

14. As the owner, I want each skill listed with its name, description, size and source, so that I can see what I have at a glance.
15. As the owner, I want an "on for new threads" switch per skill, on by default, so that I control what new threads start with.
16. As the owner, I want to view a skill's body and its file list, so that I can check what the model will read.
17. As the owner, I want a refresh button on GitHub skills that pulls the latest version, so that I can pick up upstream fixes.
18. As the owner, I want a refresh that changes the name to be refused, so that the catalogs of existing threads keep pointing at the right skill.
19. As the owner, I want to delete a skill, so that I can clean up ones I no longer use.
20. As the owner, I want refreshing or deleting a skill never to change any thread's cached bytes, so that managing skills costs nothing.
21. As the owner, I want an "add_skill tool on for new threads" switch, on by default, so that I can stop new threads paying for a tool I don't use.
22. As the owner, I want the settings search to find the Skills section for "skill", "skills" and "SKILL.md", so that I can get to it quickly.

### The model using skills

23. As the owner, I want a new thread's skill catalog to hold the names and descriptions of my skills that are on for new threads, so that the model knows what is available.
24. As the owner, I want the catalog frozen with the thread's tool set, so that adding, editing or removing skills never breaks an existing thread's cache.
25. As the owner, I want the model to read a skill's body only when a task matches it, so that skills cost tokens only when used.
26. As the owner, I want reading a skill to run without asking, so that using a skill never interrupts the reply.
27. As the owner, I want the model able to read a skill's other files by path, so that skills with reference files work as their authors intended.
28. As the owner, I want a skill read kept word for word in the reply, like any tool result, so that later requests keep hitting the cache.
29. As the owner, I want reading a skill that was since deleted to return "this skill was removed", so that the model can carry on without it.
30. As the owner, I want reading a skill name not in the thread's catalog to return an error listing the catalog, so that a misspelled call recovers.
31. As the owner, I want reading a missing file path to return an error listing the skill's files, so that the model can retry with the right path.
32. As the owner, I want a skill read capped like any tool result, so that one large file doesn't become a permanent per-turn tax.
33. As the owner, I want "use the X skill" in my message to make the model read it, so that I can steer it without a special command.
34. As the owner, I want threads on models that can't call tools to have no skill catalog, so that nothing is sent that the model can't use.
35. As the owner, I want a thread with no skills not to carry `read_skill` at all, so that it pays nothing for skills.
36. As the owner, I want to leave out individual skills, `read_skill` or `add_skill` in the tool picker before the first send, so that a thread carries only what I want.
37. As the owner, I want changing an existing thread's skills to go through the same "change tools" path and cache-break warning as tool servers, so that it is an explicit, priced choice.
38. As the owner, I want the catalog's tokens counted in the Inspector as part of the tool set, so that I see what skills cost each request.
39. As the owner, I want at most 100 skills in a catalog, the first 100 by name when more are on, so that the tool set stays bounded.
40. As the owner, I want a cheaper reply, retry or keepalive to send the same frozen catalog, so that they never break the cache.

### Adding skills through chat

41. As the owner, I want to say "add this skill to tally chat: <GitHub URL>" and have the model call `add_skill`, so that I can add skills without leaving the conversation.
42. As the owner, I want to paste a whole `SKILL.md` in chat and have the model add it, so that single-file skills I find as text work too.
43. As the owner, I want `add_skill` always to ask for approval, and never be settable to always allowed, so that nothing changes my setup or fetches from the web without me.
44. As the owner, I want the approval card to show the skill's name, description, size and source, and whether it replaces an existing skill, so that I know exactly what I'm approving.
45. As the owner, I want an `add_skill` call whose skill can't be fetched or validated to finish with that error, shown on the call and sent to the model, without asking me for approval, so that I never approve something that will fail.
46. As the owner, I want declining `add_skill` to tell the model it was declined, so that the reply can carry on.
47. As the owner, I want the `add_skill` result to say the skill is available from the next thread, so that I'm not surprised it isn't usable right away.
48. As the owner, I want a skill added through chat to appear in Settings like any other, so that there is one list of skills.

## Implementation Decisions

- **Skill storage.** A new `skills` table, owned per owner: `name` (unique per owner, enforced in the add mutation), `description`, `body` (the `SKILL.md` text after frontmatter), `files` (path and text for every other text file), `size` in bytes, `source` (`upload`, or `github` with the normalized URL), `onForNewThreads`. Indexed by owner and by owner and name. Total text per skill at most 1 MB, which fits a Convex document; if it ever doesn't, files move to file storage.
- **Owner setting.** `settings` gains `addSkillOnForNewThreads`, absent meaning on.
- **Skill parsing** is a pure module: takes a list of `{ path, text }`, finds `SKILL.md` (flattening one shared top-level folder), parses YAML frontmatter, validates `name` and `description` against the Agent Skills spec, drops binary files, enforces the 1 MB cap, and returns a skill or a reason. Both the Settings path and `add_skill` go through it, so validation is the same everywhere.
- **Zip upload** is unzipped in the browser and sent as the same `{ path, text }` list; the server never handles zips. This needs a small unzip dependency (`fflate`), since the platform has no native zip reader.
- **GitHub fetching** is a server action. It accepts `github.com/<owner>/<repo>/tree/<ref>/<path>` and `.../blob/<ref>/<path>/SKILL.md` (and the repo root), lists the folder through GitHub's public API without a token, and downloads text files through the existing URL guard. When the path holds no `SKILL.md` but subfolders do, it fails with those folder paths listed.
- **Public functions**, mirroring tool servers: list skills, get one skill's body and file list, add from files (with an explicit replace flag), add from GitHub, refresh, set on for new threads, remove, and set the `add_skill` setting. Add and refresh return a validation reason instead of throwing for bad skills, so the UI shows it inline.
- **Frozen tool set gains built-in tools.** A frozen tool is either a tool server tool (as today) or a built-in tool, `read_skill` or `add_skill`, which carries no server id. Built-in tools are listed first in the tool set. Tool server tool names always contain `__`, so they can't collide with the built-in names.
- **The catalog lives in `read_skill`'s description**, frozen at the first send with the rest of the tool set: a fixed preamble telling the model to read a matching skill before doing the task, followed by each skill's name and description, sorted by name, at most 100. The input schema is `{ name: string, path?: string }`. The thread's skill names are recoverable from the frozen description; the frozen tool also records them as a list, so execution doesn't parse text.
- **`read_skill` runs inside the existing tool loop** without an approval step. It looks up the named skill by owner and name at run time: missing from the catalog gives an error listing the catalog, deleted gives "this skill was removed", a missing path gives an error listing the skill's files. With no path it returns the body. The result goes through the existing tool result cap and is stored verbatim like any tool result.
- **`add_skill`** takes `{ source: string }`, either a GitHub URL or the full `SKILL.md` text. When the tool call arrives it is resolved (fetched and validated) before the approval is shown, and the preview (name, description, size, source, replaces or not, or the error) is stored on the tool call so the approval card renders it. It always requires approval, and the "always allowed" control is not offered for it. On approval the resolved skill is saved and the result says it is available from the next thread; on decline the result says so; on a resolve error the call finishes with the error and no approval is asked.
- **Tool picker.** A thread's picks include built-in tools as well as server tools. `read_skill` is picked when at least one skill is on for new threads, with the individual skills shown under it so any can be left out. `add_skill` is picked when the owner setting is on. Both are dropped when the model can't call tools. Changing an existing thread's picks goes through the existing set-thread-tools path and its cache-break confirmation.
- **Inspector** needs no new category: built-in tools are part of the tool set and are measured with it.
- **Glossary terms** used: Skill, Skill catalog, Built-in tool, Tool set, Tool call, Tool result, Approval, Tool loop.

## Testing Decisions

- One seam: Convex public functions under `convex-test`, with `fakeFetch` standing in for Anthropic (scripted `read_skill` and `add_skill` calls) and for GitHub (the folder listing and raw file responses). Tests set up state only through real mutations and actions and assert only on the bytes of the model requests and on what public queries return, never on table internals.
- Prior art: the tool loop and tool server tests (scripted steps, the fake MCP server, approvals) and the tool set freeze tests.
- Covered at that seam:
  - Adding from files and from GitHub: success, each validation failure, binary files dropped, size cap, one top-level folder flattened, multi-skill folder listing, replace confirmation, GitHub errors passed through.
  - Freezing: a new thread's first request carries `read_skill` with the exact catalog bytes; adding, refreshing, toggling or deleting a skill afterwards leaves that thread's later requests byte-identical; a thread with no skills, or on a model without tools, carries no `read_skill`; the 100-skill cap.
  - Reading: body, file by path, missing path, unknown name, deleted skill, cap applied, no approval asked, result verbatim on the next request.
  - Adding through chat: a preview on the pending call, always asks even if always-allowed is attempted, approval saves the skill and it shows in the next thread's catalog but not the current one, decline, resolve error finishes without asking.
  - Changing an existing thread's skills through the set-thread-tools path.
- The skill parsing module is exercised through the public functions above, not separately, unless a case is awkward to reach that way.
- The Settings Skills section and the approval card are checked once by hand in the browser (light and dark), with no new UI test harness.

## Out of Scope

- Executing anything in a skill (scripts, binaries); there is no sandbox.
- Plugins or bundles combining skills and tool servers; tool servers stay as they are.
- Slash invocation of a skill from the composer, and skills on models without tool calling.
- Private GitHub repos, tokens, and sources other than GitHub and upload.
- Version history, pinning a skill to a commit, automatic refresh.
- Sharing skills between owners or any marketplace.
- Making a skill added through chat usable in the thread that added it.

## Further Notes

- Skills from the web are untrusted text the model will follow. The approval on `add_skill` and the body view in Settings are the owner's chance to read one before it is used; the spec deliberately adds no automated scanning.
- GitHub's unauthenticated API allows 60 requests an hour per IP, which a self-hosted instance adding a few skills won't hit; the error is passed through if it does.
