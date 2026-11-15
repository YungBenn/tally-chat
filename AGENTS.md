<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Commit messages

Based on [GitKraken's commit message best practices](https://www.gitkraken.com/learn/git/best-practices/git-commit-message).

- **Type prefix:** start with a conventional commit type in lowercase: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`. An optional scope goes in parentheses: `fix(inspector): ...`.
- **Summary line:** 50 characters or fewer, never more than 72.
- **Imperative mood:** write "add", not "added" or "adds". It should complete the sentence "If applied, this commit will ...".
- **No unnecessary capitals** and **no trailing punctuation** on the summary.
- **Body (optional):** add one only when the summary can't explain the what and why. Leave a blank line after the summary and wrap lines at 72 characters.
- **Ticket reference:** when the change comes from a ticket, reference it in the body (for example `Phase 8 ticket 06`). This adds to a good message, it doesn't replace one.
- **Spelling:** check it before committing. A pushed message is hard to fix.
- **No co-author lines.**
- **One change per commit:** if the diff mixes unrelated changes, split them. Stage files by name, never secrets (`.env*`, keys, credentials).

Example: `feat(composer): roll the cost estimate digit by digit`

History before this section used plain sentences ("Import Claude exports (phase 7 ticket 08)"); leave it as is.
