# 0020: A slim monitor with nothing below the screen

The Kestrel monitor is an even, slim frame of beige plastic and dark glass round the screen, with no chin, badge or power button, and the bare screen is square.

- Status: accepted
- Date: 2026-11-24

## Context

[0012](0012-crt-monitor-and-resolutions.md) gave the monitor 46px of plastic and glass at the sides, 44px on top and a 74px chin carrying the Kestrel badge, the model name, three knobs, a light and a power button. Next to the Pocket on phones ([0019](0019-the-kestrel-pocket-phone-layout.md)), whose frame is a slim 6px edge, the monitor read as heavy: the chin took room from the screen at every scale, and the power button duplicated Turn Off Pigeon, which now puts Pigeon to sleep behind a screen saver.

## Decision

- The monitor is 25px of frame on every side: 14px of plastic, a 3px moulded slope and 8px of dark glass. The tube's corners are rounded 10px. Nothing sits below the screen: no badge, model name, knobs, light or power button. Kestrel stays the made-up maker in the world and in the docs.
- When the monitor doesn't fit and the bare screen is shown, its corners are square: the CRT glass follows the tube's radius, and with no tube there is none.

This supersedes 0012's chin, controls and frame sizes, and the sizes 0014 repeats; everything else in 0012 (resolutions, fitting, the CRT effect and its toggle) stands.

## Consequences

The screen takes more of the window at every scale (1074×818 at 1× for 1024×768, from 1116×886), so the monitor reaches 2× on smaller screens. The monitor can no longer be switched off on its own; Turn Off Pigeon and its screen saver are the way to blank it.
