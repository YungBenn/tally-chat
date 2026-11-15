# ContextBar

The context window as one stacked bar with a ruler above it.

- Segments by layer, in order: system, checkpoint, turns, next message. `cached` solid, `to-be-written` hatched, `fresh` outlined, so they differ by texture as well as color.
- The ruler shows ticks every 5% and labels at quarters in mono. Zoom the scale when usage is small.
- The selected layer gets a vivid holo edge. Segments resize with `layout` animation.
