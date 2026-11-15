# Button

Buttons trigger an action. Five variants, three sizes, plus icon-only.

- **primary**: the one thing the view is for (Send, Save, Sign in). Amber fill with a holo edge and a light sweep on hover. At most one per view.
- **secondary**: the default for everything else. `surface-raised` with a hairline.
- **outline**: secondary actions on busy surfaces (Condense now, Continue). `border-strong` outline.
- **ghost**: toolbars and message actions. No border until hover.
- **danger**: destructive confirmation only (Delete thread, Remove provider). Never holo.

Props: `variant`, `size` (`sm` 28px, `md` 34px, `lg` 40px), `icon`, `iconRight`, `iconOnly`, `loading`, `disabled`, `holo` (override). Consumer provides the label (verb first, sentence case: "Add provider").

States: hover tints, press scales to 0.97 (`whileTap`), `focus-visible` draws a solid 2px `ring`, `loading` swaps the icon for a holo spinner and sets `aria-busy`, `disabled` drops to 45% opacity.

Don't: use primary twice in a view, put holo on secondary or danger, or write labels in Title Case.
