# 0008: A pixel-exact 1024×768 stage

Everything is laid out on a 1024×768 logical screen at 1× and scaled by whole numbers, with no CRT effect.

- Status: accepted; the fixed size, the letterbox and "no CRT effect" are superseded by [0012](0012-crt-monitor-and-resolutions.md)
- Date: 2026-11-24

## Context

The XP feel depends on crisp 11px Tahoma, 1px bevels and bitmap icons. Fluid layouts and fractional scaling blur all of it. A CRT filter was tried on the canvas and rejected as not what the era looked like on an LCD.

## Decision

Render a fixed 1024×768 stage, scale it by `max(1, floor(min(vw/1024, vh/768)))`, letterbox the rest, and use `image-rendering: pixelated`. An optional pixel mode samples one pixel per 2×2 block at scale 2. Small screens get a separate one-app layout instead of a squeezed desktop.

## Consequences

Pixel-perfect and predictable, and screenshots look right. Large monitors show letterboxing unless they reach the next whole scale. The phone layout is its own piece of work.
