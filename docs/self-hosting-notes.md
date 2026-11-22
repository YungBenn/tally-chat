# Self-hosting notes

Collected while building phase 1, for the phase 5 setup guide.

- **Master key.** Deploys fail until `TALLY_MASTER_KEY` is set: `npx convex env set TALLY_MASTER_KEY "$(openssl rand -base64 32)"`. Losing it makes every stored provider key unreadable; back it up outside the database.
- **Node actions.** Provider calls run in Convex's Node runtime (for DNS lookups in the URL guard). The Docker backend must be able to run Node actions.
- **DNS rebinding.** The URL guard resolves a host and checks every address, then `fetch` resolves it again. A DNS server that answers differently the second time could slip a private address through. Allowlisting private hosts is an explicit owner choice, so the practical risk is a malicious public hostname; pinning the connection to the checked address would close it and needs a custom HTTP agent.
- **Images.** Pin the backend and dashboard image revisions instead of `:latest` (spike, `docs/spike-convex-self-host.md`).
- **Ports.** Defaults 3210 and 3211 clash with `npx convex dev` local deployments; change them with `PORT` and `SITE_PROXY_PORT`.

## Moving the owner's instance off Convex cloud (phase 12 ticket 14, 2026-11-22)

- **What moved.** A Convex export of the cloud deployment (file storage included) was restored into the Docker backend with `selfhost/restore.sh`'s path, together with the cloud deployment's `TALLY_MASTER_KEY`, `JWT_PRIVATE_KEY` and `JWKS`. Without the cloud master key, every stored provider key would stop decrypting. Row counts matched on all 25 tables.
- **Stale setup image.** `docker compose run setup` reuses an old `tally-setup` image and deploys whatever code it was built from. Run `docker compose build setup` first.
- **Reached over the tailnet.** Serve publishes the backend on `:8443` (API) and `:8444` (site), tailnet only; the app stays on the existing Funnel. The backend reaches its own `.ts.net` URLs from inside Docker, so sign-in tokens verify.
- **Query latency from the Mac.** Cloud (Sydney): HTTP query median 133 ms, new connection plus first query 809 ms. Self-hosted over the tailnet: 2 ms and 28 ms.
- **Private host allowlist.** Inside Docker the machine's `.ts.net` name resolves to its tailnet address, which the URL guard treats as private, so providers, search and tools on that name failed ("is a private address") until the name was added to the allowlist in Settings. Convex cloud had resolved it to the public Funnel address.
- **Reply timing, 9router, 4 replies each.** Cloud (ticket 01): queue 70-110 ms, input 37-233 ms, provider first event 0.9-3.9 s. Self-hosted: queue 45-78 ms, input 27-40 ms, first event 0.67-0.78 s, first saved text 31-38 ms after it.
- **Cloud fallback.** The cloud deployment is left untouched until **2026-12-22**, then deleted. Don't run `npm run dev` with the old `.env.local` before then: it pushes code to that deployment.

