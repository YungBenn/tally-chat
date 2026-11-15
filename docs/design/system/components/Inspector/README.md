# Inspector

Side panel that explains the money: cache status, context bar, layers, thread totals, hit rate, upkeep, savings and Condense now.

- `layout-inspector` wide on `surface` with a hairline left edge. Dense: compact rows, overline section labels, mono numbers.
- Opens and closes with a `layout` width animation (`spring.smooth`); a bottom sheet under 1200px.
- Only one holo element at a time inside it: the selected layer (and the warm cache pill).
