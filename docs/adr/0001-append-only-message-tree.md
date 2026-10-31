# Append-only message tree, checkpoints outside the chain

Each thread stores its messages as a tree (every message points at its parent) rather than a flat array, and no message is ever mutated after write. Retry, fork and edit all become a new child, so the active branch is a walk from the leaf to the root, and every prefix stays byte-stable for prompt caching. Summaries live in a separate checkpoints table that points at the last message they cover, so condensing never rewrites the chain and a fork made before a checkpoint never sees it.

## Considered Options

- **Flat array per thread**: simplest, but retry and edit must overwrite or splice history, which breaks cache prefixes and loses the discarded answers.
- **Summary as a message in the chain**: would require re-parenting later messages onto the summary, which violates append-only and leaks the summary into sibling branches.

## Consequences

- Walking `parentId` would cost one read per ancestor, so every message stores its `ancestorIds` and a branch is built in one read.
- Single messages are never deleted or dropped from context; a fork makes them unreachable. Only a whole thread can be deleted, and that is a hard delete. Cost rollups keep the deleted thread's spend.
