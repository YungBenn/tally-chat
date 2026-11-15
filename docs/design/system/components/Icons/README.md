# Icons

Tabler Icons (`@tabler/icons-react`) at stroke 1.5, in three sizes: 14 (inline in dense rows and chips), 16 (default, buttons and menus), 20 (headers, empty states).

- Icons inherit `currentColor`; color them with text tokens (`foreground-muted` at rest, `foreground` on hover).
- Pair an icon with a word for any status (cache, budget, errors). Icon-only buttons need an `aria-label` and a tooltip.
- Use the outline set. The only filled icon is `player-stop-filled` for Stop.
- Don't add sparkle or magic icons for AI. Don't put holo on icons; holo belongs to lines around things.
- In code: `<Icon name="..." size={16} />` here, `<IconCopy size={16} stroke={1.5} />` in the app.
