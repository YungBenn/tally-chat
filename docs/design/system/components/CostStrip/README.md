# CostStrip

One mono line under the composer that updates while you type: `~$0.004 next · cache warm · 87% hit`.

- The estimate rolls digit by digit (`spring.snappy`) with tabular figures so nothing jitters.
- Cache state uses CacheStatus in compact form. Hit rate in `cached`; drops to plain when cold.
- Right side: key hints, or a warning in `warning` ("Edit breaks cache").
