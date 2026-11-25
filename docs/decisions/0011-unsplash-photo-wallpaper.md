# 0011: An Unsplash photo for the wallpaper

The desktop wallpaper is a photo of rolling hills from Unsplash, not a drawing, which amends the asset list in 0007.

- Status: accepted
- Date: 2026-11-24

## Context

[0007](0007-original-and-openly-licensed-assets-only.md) listed the wallpaper as art drawn for Pigeon, and M1 shipped an SVG of hills and clouds. The maintainer wants a real photo instead: wallpapers of the era were photographs, and a drawing reads as a placeholder. Bliss itself stays ruled out.

## Decision

- Use Unsplash photo `photo-1756074924706-48ca9f24410f` by [@bchen22](https://unsplash.com/@bchen22) (a canola field under a blue sky) under the [Unsplash License](https://unsplash.com/license), which allows free use, including commercial, without asking.
- Vendor it like every other asset ([vendor/VENDOR.md](../../vendor/VENDOR.md)): a 1024×768 crop, pinned by URL and sha512, copied to `apps/web/src/wallpapers/`. Nothing loads from Unsplash at runtime.
- Draw it one image pixel per stage pixel and scale it with the stage ([0008](0008-pixel-exact-1024x768-stage.md)).
- Credit the photographer and Unsplash in the About box and README: "photo by @bchen22 on Unsplash", linked to the profile.
- This is the only change to 0007: Pigeon's icons and logo stay its own, and no Microsoft asset is allowed.

## Consequences

The desktop looks like a real 2003 desktop. The Unsplash License isn't a free-content licence: it forbids selling the photo unchanged or building a competing photo service, neither of which Pigeon does. Pigeon's look now depends on one outside photo; replacing it is a lock-file change.
