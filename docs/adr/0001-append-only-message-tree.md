# Append-only message tree, checkpoints outside the chain

Each thread stores its messages as a tree (every message points at its parent) rather than a flat array, and no message is ever mutated after write. Retry, fork and edit all become a new child, so the active branch is a walk from the leaf to the root, and every prefix stays byte-stable for prompt caching. Summaries live in a separate checkpoints table that points at the last message they cover, so condensing never rewrites the chain and a fork made before a checkpoint never sees it.

## Considered Options

- **Flat array per thread**: simplest, but retry and edit must overwrite or splice history, which breaks cache prefixes and loses the discarded answers.
- **Summary as a message in the chain**: would require re-parenting later messages onto the summary, which violates append-only and leaks the summary into sibling branches.

## Consequences

- Walking `parentId` would cost one read per ancestor, so every message stores its `ancestorIds` and a branch is built in one read.
- Single messages are never deleted or dropped from context; a fork makes them unreachable. Only a whole thread can be deleted, and that is a hard delete. Cost rollups keep the deleted thread's spend.

## Amendment (phase 6): pins

A message's `pinned` flag is the one change a message can get after it's written, besides the move out of "streaming". Pinning is safe for the cache because the flag changes no request bytes while the message is still sent verbatim; it matters only once a checkpoint covers the message, when pinned messages are sent verbatim after the summary instead of being folded into it. So a pin can change only until a checkpoint covers the message, and is fixed from then on: changing it later would change the checkpoint layer of every request without a new summary to match. See the [phase 6 spec](../specs/phase-6-background-condenser.md).

## Amendment (phase 12): ancestors in their own table

Storing `ancestorIds` on each message made a branch one read, but every read of the branch then carried each message's whole path: bytes read grew with the square of the branch length, and a thread of about 650 messages hit Convex's 16 MiB per-function read limit. Each message's ancestors now live in its own `messageAncestors` row, written with the message and never changed. Building a branch reads the leaf's row once and then the messages, so reads grow linearly. `migrations:moveMessageAncestors` moves the field off older messages.
