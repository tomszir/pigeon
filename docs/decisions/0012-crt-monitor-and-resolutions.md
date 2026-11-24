# 0012: A CRT monitor, three resolutions and a CRT effect

The screen sits in a beige 2003 CRT monitor drawn in CSS, its resolution can be 800×600, 1024×768 or 1280×1024, and a CRT effect that never blurs a pixel is on by default. This supersedes part of 0008.

- Status: accepted; the CRT effect is superseded by [0013](0013-crt-effect-as-a-live-svg-filter.md), the stand by [0014](0014-shader-backdrop-no-stand.md)
- Date: 2026-11-24

## Context

[0008](0008-pixel-exact-1024x768-stage.md) fixed the screen at 1024×768, filled the rest of the page with a flat letterbox colour, and ruled out a CRT effect after a scanline filter on the canvas blurred the pixel art. The author wants something more fun around the desktop, a way to change its size, and a CRT look that doesn't get in the way. Whole-number scaling stays: it's what keeps 11px Tahoma and 1px bevels sharp.

## Decision

- **Monitor.** A beige CRT by a made-up maker, Kestrel (model KV-1710), drawn in CSS with no image assets, surrounds the screen. It carries no Pigeon branding: it's part of the world, not the product. It has 46px of plastic and glass at the sides, 44px on top, a 74px chin with the badge and controls, and a 34px stand. It scales by the same whole number as the screen. The power button turns the screen off and on.
- **Resolutions.** Display Properties offers 800×600, 1024×768 (the default) and 1280×1024. The desktop is laid out at that size. Windows are pulled back on screen when it shrinks, and the wallpaper has a crop for each size.
- **Fitting.** The monitor is shown at the largest whole scale the browser window allows. If even 1× doesn't fit, the bare screen is shown at 1×. If the screen doesn't fit either, the phone layout takes over.
- **CRT effect.** On by default; a checkbox in Display Properties turns it off. It lays layers over the picture that change colour but never move or blur a pixel: scanlines (one 1-device-pixel line per screen row from 2×, every other device row at 1×), a faint red-green-blue aperture grille, curved glass with darker rounded edges, a slow refresh band rolling down, a faint flicker, and a little more contrast and saturation. The rolling band and flicker stop when motion is reduced. There is no barrel distortion or bloom, since both resample the picture: that was 0008's objection to the canvas's filter.
- 0008 still governs whole-number scaling, `image-rendering: pixelated` and pixel mode. Its fixed 1024×768, the letterbox and "no CRT effect" are superseded here.

## Consequences

The page reads as a 2003 desk rather than a website, and the screen as a tube. The monitor costs screen space: a 1024×768 screen needs a browser window about 1116×920 to show it at 1×, and smaller windows get the bare screen. Layout code can no longer assume 1024×768; the shell derives the workspace from the chosen resolution.
