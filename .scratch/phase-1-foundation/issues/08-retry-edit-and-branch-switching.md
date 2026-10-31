# 08: Retry, edit and branch switching

**What to build:** The owner can retry a reply (a new assistant message beside the old one), edit a past user message (a new user message beside the old one), and switch which branch is active. Nothing is overwritten, and abandoned branches never reach the provider. Minimal buttons only; the designed branch switcher comes in phase 4. Spec: user stories 24 to 28; ADR 0001.

**Blocked by:** 05 First chat turn, streamed

**Status:** done (pending review)

- [x] Retry creates a new assistant message under the same user message and makes it the active leaf
- [x] Edit creates a new user message under the edited message's parent, then a reply to it, and makes that the active leaf
- [x] The original messages remain stored and reachable
- [x] Owner can switch the active leaf between sibling versions
- [x] Captured provider requests never contain messages from an abandoned branch (test)
- [x] No message is ever updated or deleted by these actions (test)
