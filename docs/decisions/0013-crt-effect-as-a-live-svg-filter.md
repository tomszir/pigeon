# 0013: The CRT effect is a live SVG filter

The CRT effect runs the screen through an SVG filter chain (curvature, colour fringing, scanlines, bloom) instead of laying static patterns over it. This supersedes the CRT-effect part of 0012.

- Status: accepted
- Date: 2026-11-24

## Context

[0012](0012-crt-monitor-and-resolutions.md) built the CRT effect from layers drawn on top of the screen: scanlines, an RGB grille and glass. On screen it read as a grid of dots over everything rather than a tube. A CRT shader changes the picture itself: it bends it, splits colours, thins scanlines where the beam is bright, and lets highlights glow. Browsers can't hand a live page to WebGL, but CSS `filter: url(#…)` runs an SVG filter on the rendered page every frame, which is the closest thing to a fragment shader that HTML has.

## Decision

- `shell/stage/crt-filter.tsx` filters the screen in this order:
  1. a barrel bend from `feDisplacementMap`, drawn from a 256×256 map made on a canvas, at most 2 screen pixels at the corners;
  2. red and blue split off with `feColorMatrix` and nudged a fifth of a pixel apart;
  3. scanlines: each screen row multiplied by a band at about 70% brightness, one row per band from 2×, every other device row at 1×; light enough that 1px details and small text stay readable;
  4. bloom: the parts above about 60% brightness blurred and added back, so bright areas glow and fill their scanlines.
- A 3px black border runs round the inside of the tube, like the black border round a CRT picture. It hides the corners the bend pulls in and the coloured seams the fringing leaves at the edges, so the picture ends in one clean curve. The tube's rounded shape belongs to the monitor, so it's the same with the effect off or the power off.
- On top, the only layers are the ones that sit on real glass: a curved reflection, darker rounded edges, a slow refresh band, and a faint flicker. The band and flicker stop when motion is reduced.
- It stays on by default, as in 0012, and turns off in Display Properties. Pixel mode only works with it off.
- The bend stays small because hit-testing ignores filters: what you see moves by up to 2 screen pixels at the corners, but what you click doesn't.

## Consequences

It looks like a tube: soft, glowing, slightly bent. The pixels are no longer exact while it's on, which was the trade 0008 avoided; the toggle keeps the sharp view one click away. It costs real rendering work, because the filter reruns whenever the screen changes. Measured while dragging a window, in headless Chromium with software rendering: about 7 frames a second at 1× and 2 at 2×, against 60 with the effect off. A GPU-composited browser should do far better, but this hasn't been measured on one. If it proves too slow, the first things to cut are the bloom blur and the bend.
