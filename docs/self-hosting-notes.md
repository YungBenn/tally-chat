# Self-hosting notes

Collected while building phase 1, for the phase 5 setup guide.

- **Master key.** Deploys fail until `TALLY_MASTER_KEY` is set: `npx convex env set TALLY_MASTER_KEY "$(openssl rand -base64 32)"`. Losing it makes every stored provider key unreadable; back it up outside the database.
- **Node actions.** Provider calls run in Convex's Node runtime (for DNS lookups in the URL guard). The Docker backend must be able to run Node actions.
- **DNS rebinding.** The URL guard resolves a host and checks every address, then `fetch` resolves it again. A DNS server that answers differently the second time could slip a private address through. Allowlisting private hosts is an explicit owner choice, so the practical risk is a malicious public hostname; pinning the connection to the checked address would close it and needs a custom HTTP agent.
- **Images.** Pin the backend and dashboard image revisions instead of `:latest` (spike, `docs/spike-convex-self-host.md`).
- **Ports.** Defaults 3210 and 3211 clash with `npx convex dev` local deployments; change them with `PORT` and `SITE_PROXY_PORT`.
