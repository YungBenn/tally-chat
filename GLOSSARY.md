# tally.chat

A multi-provider chat app that shows the user what enters the context window and what each request costs.

## Conversation

**Thread**:
One conversation, holding a tree of messages and pointing at one active leaf.
_Avoid_: Chat, conversation, session

**Message**:
One immutable node in a thread's tree, written by the user, the assistant, or the system.
_Avoid_: Node, entry, turn

**Turn**:
One user message plus the assistant reply it received. The unit for counting conversation length and for condensing.
_Avoid_: Round, exchange, message

**Branch**:
The chain of messages from the root to one leaf. The active branch is what gets sent to the model.
_Avoid_: Path, history

**Fork**:
Starting a new branch by writing a message under an older parent. Editing a past user message is a fork.
_Avoid_: Edit, rewrite

**Retry**:
A new assistant message under the same user message, alongside the earlier reply.
_Avoid_: Regenerate, redo

**Cheaper reply**:
A reply sent once to a model other than the thread's. The thread keeps its model and its cache.
_Avoid_: Routing, model switch, override

**Imported thread**:
A thread brought in from another app's data export. Its messages carry no usage and never count as spend.
_Avoid_: Migrated chat, archive

**Holo line**:
The thin spectral edge (cyan to violet to pink to amber) that marks what is live, focused or important: the focused composer, a streaming reply, a warm cache, the active thread. At most three per view.
_Avoid_: Glow, gradient border, rainbow

**Pinned message**:
A message that the condenser never folds into a summary.
_Avoid_: Starred, saved

## Tools

**Tool server**:
A remote MCP server the owner has added, offering tools the model can call.
_Avoid_: Plugin, integration, connector, MCP

**Tool set**:
The tools a thread was created with. Fixed for the life of the thread unless the owner explicitly changes it, which breaks the cache like editing an old message.
_Avoid_: Toolbox, enabled tools

**Tool call**:
The model asking to run one tool with given arguments, as part of a reply.
_Avoid_: Function call, invocation, action

**Tool result**:
What a tool returned for one tool call, kept word for word in the reply that asked for it.
_Avoid_: Tool output, observation

**Approval**:
The owner allowing one tool call to run. A tool can be set to always allowed, which skips the ask.
_Avoid_: Confirmation, consent, permission

**Step**:
One model request inside a reply. A step may make several tool calls at once, approved together. A reply has at most ten steps before it offers Continue.
_Avoid_: Iteration, round, hop

**Tool loop**:
A reply that alternates between the model's text, tool calls and tool results until the model answers or hits the limit. The whole loop is one reply, so a turn is still one user message plus one reply.
_Avoid_: Agent, agent loop, chain

## Context

**Checkpoint**:
A summary that stands in for every message up to a given point on a branch.
_Avoid_: Compaction, snapshot, summary node

**Condense**:
Writing a new checkpoint for a thread, whether the summary comes from the provider or from a side job.
_Avoid_: Compact, truncate, prune

**Side job**:
Model work the user did not directly ask for, such as titles and condensing, run on the user's chosen cheap model.
_Avoid_: Background task, auxiliary call

## Cost

**Cache hit rate**:
The share of a request's input tokens that were read from the provider's prompt cache.
_Avoid_: Cache ratio, hit ratio

**Inspector**:
The panel that shows what is in a thread's context window and what each part costs.
_Avoid_: Context viewer, debug panel

**Cost strip**:
The one-line summary under the composer showing the next send's estimated cost, cache status and hit rate.
_Avoid_: Status bar, footer

**Cache status**:
Whether a thread's prompt cache is warm, kept alive, or cold.
_Avoid_: Cache state, warmth

**Keepalive**:
A no-output request that refreshes a thread's prompt cache while the user is still active in it.
_Avoid_: Pre-warm, ping, heartbeat
