# 06: Images on OpenAI-compatible providers

**What to build:** On the Providers page I can mark which OpenAI-compatible models accept images (off by default). Those models then offer the attach control, and their requests carry the images as AI SDK image parts. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 25, 26; Implementation Decisions "Images (S4)".

**Blocked by:** 04 Images in Anthropic threads

**Status:** ready-for-agent

- [ ] Each OpenAI-compatible model has an "accepts images" toggle on the Providers page, off by default, saved on the model list
- [ ] Marked models offer the attach control; others refuse images server-side
- [ ] Requests carry the images as image parts before the message text; retries send identical content
- [ ] Tests cover the request body and the refusal for an unmarked model
