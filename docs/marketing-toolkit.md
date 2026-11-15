# Marketing toolkit: tally.chat

**Date**: 2026-11-15 · **Context**: open-source README and launch positioning · **Source**: [design doc](./tallychat-design-doc.md) sections 1, 2, 11, 12

## Audience

Technical power users who already hold API keys and can run a dev server or Docker: developers, researchers, heavy LLM users paying their own provider bills. They know tokens exist; they don't know why a long thread costs what it does.

**Job to be done:** "When I chat with models on my own keys, I want to see and control what each turn costs, so a long conversation doesn't quietly cost 30 to 60 times what it should."

## Positioning options

| # | Positioning | Against | Strength | Risk |
|---|---|---|---|---|
| 1 | The chat app that builds history around the prompt cache and shows you why each turn costs what it does | Every chat UI | Unique, true, technical | Needs a sentence of explanation for people who don't know caching |
| 2 | Bring your own keys, see your own bill | Hosted chat subscriptions | Clear BYOK benefit | Many BYOK apps exist |
| 3 | A context window you can see | LibreChat, Open WebUI, LobeHub (token counts only) | Visual, demoable | Undersells the savings |
| 4 | Stop paying for the same history twice | Any app without cache-aware history | Concrete pain | Sounds like a gimmick without numbers |
| 5 | pi.dev's "you control the context" for chat | Agent tools | Resonates with agent builders | Niche reference |

**Recommended:** 1 as the headline, 4 as the hook, 3 as the proof (the inspector is the screenshot).

## Value prop copy

- **Tagline:** Chat with any model. See what every turn costs.
- **Elevator pitch:** LLM APIs resend your whole conversation every turn, so a long chat costs far more than it looks. tally.chat builds each request around the provider's prompt cache, keeps that cache warm while you're reading, and shows you what's in the context window and what every reply cost. Open source, self-hosted, your own keys.
- **Hero:** "Your chat history is the bill." / "tally.chat caches it, keeps it warm, and shows you every cent."
- **One-liner:** The open-source chat app that makes long conversations cheap, and proves it.

## Messaging matrix

| Audience | Key message | Proof point | CTA |
|---|---|---|---|
| Heavy API users | Long threads stop getting expensive | Turn 2 through 9router read 4,161 tokens from cache, wrote 57 | Run it locally |
| Self-hosters | Your keys and data stay on your server | Keys encrypted at rest, SSRF guard, single-user | Clone and run |
| Cost-conscious tinkerers | See every cent before you send | Cost strip estimate vs actual: $0.001039 vs $0.001057 | Try the cost strip |
| Contributors | A small, readable codebase with real tests | 190 tests through one seam, append-only message tree | Read the specs |
