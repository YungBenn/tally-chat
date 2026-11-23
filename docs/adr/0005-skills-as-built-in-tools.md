# Skills reach the model through built-in tools, with the catalog frozen in the tool set

A skill (Agent Skills format: `SKILL.md` plus optional text files) is never put in the system prompt. A thread whose tool set includes skills gets a built-in `read_skill(name, path?)` tool whose description holds the skill catalog, the names and descriptions of the thread's skills. The model reads a skill's body only when a task calls for it, and the body arrives as a tool result, kept verbatim (ADR 0003). Adding a skill through chat is a second built-in tool, `add_skill(source)`, that always needs approval. Skills are text only and never executed.

## Considered Options

- **Catalog in the system prompt**: the obvious place, but the system prompt is versioned and every thread keeps its version (design doc S5). Putting the catalog there means a second per-thread frozen field and a new prompt shape. The tool set is already frozen per thread, already measured in the Inspector, and already has an explicit "change tools" path that warns about the cache break.
- **Whole skill bodies in context**: no tool needed, but every skill's full text is paid on every request, and most threads use none of them.
- **Slash invocation only** (`/skill-name` attaches the body to the user message): works on models without tool calling, but the owner has to remember which skill fits. It can be added later next to the model-chosen path.

## Consequences

- Models that can't call tools can't use skills.
- A skill added mid-thread, including through `add_skill`, appears only in threads created afterwards, unless the owner explicitly changes the thread's tool set.
- Refreshing or deleting a skill never changes bytes already sent: earlier reads stay verbatim; later reads get the new body or a "this skill was removed" result.
