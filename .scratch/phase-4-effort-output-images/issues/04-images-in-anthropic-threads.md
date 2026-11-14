# 04: Images in Anthropic threads

**What to build:** On Anthropic models that accept images, I can attach images to a message by picking, pasting or dropping them. They're resized in the browser to at most 2,576 px on the long edge, uploaded, shown in the composer with a remove control and in the sent message, and sent inline as base64 image blocks before the text. Retries and keepalives send identical blocks, and deleting a thread deletes its images. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 21 to 25, 28, 30, 31; Implementation Decisions "Images (S4)".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Anthropic model lists record image support from the Models API's capabilities when a provider is added or its models refreshed
- [ ] The attach control appears only for models that accept images; JPEG, PNG, GIF and WebP are accepted
- [ ] Images are downscaled in the browser to at most 2,576 px on the long edge and re-encoded before upload through an owner-only upload URL
- [ ] The user message stores each image's storage id, media type, width and height, fixed at creation
- [ ] The generation action sends base64 image blocks before the message text; retries and keepalives send identical bytes
- [ ] Sending images to a model without image support is refused server-side
- [ ] Thread delete removes the thread's stored images
- [ ] Tests cover the request body, byte-identical retry and keepalive, the refusal, and the purge
- [ ] Checked in the browser: attach, paste, drop, preview, remove, and a reply about the image
