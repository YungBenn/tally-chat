# A streaming reply's text lives in its own row

While a reply's step streams, its text so far is kept in a `streams` row of its own (message id and text, indexed by message), not in the message and not in the persistent-text-streaming component. The thread query returns only stored message content and never reads that row, so a flush no longer re-runs it. A separate owner-only query returns a message's streaming text, or null once the step has ended, and the thread page subscribes to it only for the branch's last message while it streams. The row is created with the step (send, retry, edit, each tool-loop step) and deleted by the finalizing mutation in the same transaction that writes the text onto the message, so no moment shows the text twice or not at all. Each flush is one internal mutation that appends to the row and returns whether Stop was requested. This supersedes ADR 0002's choice of `persistent-text-streaming`.

## Considered Options

- **Keep the component**: the thread query read each streaming message's text from it, so every 100 ms flush re-ran the thread query and re-sent the whole active branch (about 4 KB per turn: 425 KB per flush at 100 turns, 850 KB at 200). Driving it from a scheduled action also relied on its undocumented `lib.addChunk`, pinned to an exact version, and a flush needed a second round trip to check for Stop.
- **Read the stream inside the thread query**: the same cost under another name. Any read of the changing text inside the thread query makes each flush invalidate it.
- **Stream over an HTTP action to the sending tab**: the fastest path for the tab that sent, but a second tab or a reload would see nothing until the reply finished, and the provider call would have to live outside the scheduled action that already handles Stop, retries and the stuck-reply sweep.

## Consequences

- A flush costs the same at 10 turns as at 600: the client receives only the text so far of the one streaming step (2 KB for a 2,000-character step), never the branch.
- The streaming query re-sends the step's whole text so far on each flush, so its cost grows with the length of the step, not the thread.
- A reply in a tool loop has a row only while a step streams: the text of each finished step is in its parts, and the next step starts a fresh, empty row.
- The stuck-reply sweep closes a reply with its row's text, and thread deletion removes any row left, so streamed text never outlives its reply.
- The messages table keeps its old `streamId` field as optional legacy, never written, so existing documents still validate.
