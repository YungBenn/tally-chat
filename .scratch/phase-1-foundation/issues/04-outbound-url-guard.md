# 04: Outbound URL guard and private-host allowlist

**What to build:** Every outbound provider request passes a guard that refuses private, loopback, link-local and cloud-metadata destinations, re-checks every redirect, and lets the owner allowlist specific private hosts so a LAN Ollama works on purpose. Spec: user stories 14 to 17; Testing Decisions seam 2.

**Blocked by:** 03 Add an Anthropic provider

**Status:** done (pending review)

- [x] DNS is resolved through an injectable resolver; tests use a fake resolver
- [x] Refused by default: private IPv4 ranges, loopback, link-local, 169.254.169.254, IPv6 private, loopback and link-local, IPv4-mapped IPv6
- [x] Plain http is refused unless the host is allowlisted
- [x] Redirects are followed manually and each hop is re-checked; a public URL redirecting into a private range is refused
- [x] Owner can add and remove allowlisted hosts in settings; allowlisted hosts bypass the range check
- [x] Key test and model listing go through the guard; chat requests are carried into ticket 05
- [x] DNS rebinding limit (if the runtime cannot pin the validated address) is noted for the self-hosting guide
