# UserMessage

The user's turn: a right-aligned bubble on `surface-raised`, max 85% wide, `radius-card` with a tighter bottom-right corner.

- Actions under it: branch switcher (when edited), Edit (forks), Copy.
- Attachments sit above the bubble as AttachmentChips.
- Enters with `variants.messageEnter` (y 8 → 0, `spring.smooth`).
