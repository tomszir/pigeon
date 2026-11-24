# 0014: A shader backdrop, and a monitor without a stand

The monitor floats with no stand in a black room lit by a WebGL backdrop shader. This replaces the stand and the desk from 0012.

- Status: accepted; the monitor's sizes are superseded by [0020](0020-a-slim-monitor-with-nothing-below.md)
- Date: 2026-11-24

## Context

[0012](0012-crt-monitor-and-resolutions.md) stood the monitor on a stand, and a later change put it on a CSS desk in front of a gradient wall. Built from gradients, the room read as a flat shadow plane rather than a place. A believable lived-in room would need drawn art. The author preferred a black room with something alive in it. Of the directions tried (a drifting haze, a peer mesh, dust in the light) the quietest won: just the screen's own faint light on the room.

## Decision

- The monitor has no stand; its plastic and glass are as in 0012 (46px sides, 44px top, 74px chin).
- The room is black, lit only by the screen. Behind the monitor, `shell/backdrop/` runs a WebGL fragment shader:
  - the screen's cool white light falling faintly on a room you can't see: brightest at the monitor's edge, fading into the dark, slightly uneven as if bounced off unseen surfaces, and breathing very gently. It stays dim: there, but easy on the eyes;
  - a still dither against banding.
- The backdrop isn't page content, so unlike the screen ([0013](0013-crt-effect-as-a-live-svg-filter.md)) it can be a real shader.
- It renders at half the window's size at a steady 30 frames a second, in high precision where the GPU has it, with a still dither against banding. It pauses with the tab (`requestAnimationFrame`) and draws one still frame under `prefers-reduced-motion`. Where WebGL isn't available it leaves plain black.
- The same backdrop sits behind the bare screen when the monitor doesn't fit.

## Consequences

The page has depth and motion without pretending to be a photograph of a room. The monitor is 34px shorter, so it fits smaller windows. The backdrop's GPU cost is small, a half-size render of one shader at 30 frames a second, but it adds to the CRT filter's. A drawn room remains possible later as a separate piece of art.
