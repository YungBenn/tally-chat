# tally.chat web app, production (phase 5). Built by docker compose from this checkout.
# Bun installs and builds; the Next.js standalone server runs on Bun.

FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Public URLs are baked into the client bundle at build time (Next.js NEXT_PUBLIC_*).
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CONVEX_SITE_URL
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_CONVEX_URL" || (echo "Set the NEXT_PUBLIC_CONVEX_URL build argument" && exit 1)
RUN bunx next build

FROM oven/bun:1.4.2-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=bun:bun /app/.next/standalone ./
COPY --from=build --chown=bun:bun /app/.next/static ./.next/static
COPY --from=build --chown=bun:bun /app/public ./public
USER bun
EXPOSE 3000
# The sign-in page answers 200 to a logged-out request; everything else redirects there.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/signin').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "server.js"]
