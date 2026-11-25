# Vendored fonts, icons and wallpapers

Third-party fonts, icons and wallpapers copied into the web app from pinned upstream sources, so an upstream change reaches this repository only as a reviewed diff.

Each lock names its sources (an npm package at a version, a URL, or a folder in this repository) and the files to take from them. Every download's sha512 must match the lock's `integrity`. `scripts/vendor.mjs` does the work and replaces the output folder, licences included.

## Fonts

`fonts.lock.json`, written to `apps/web/src/fonts/` by `mise run fonts:vendor`.

| File                 | Source                                                         | Licence                |
| -------------------- | -------------------------------------------------------------- | ---------------------- |
| `wine-tahoma.ttf`    | Wine `fonts/tahoma.ttf` at tag `wine-10.0` (gitlab.winehq.org) | LGPL 2.1 or later      |
| `vera-sans-mono.ttf` | Bitstream Vera 1.10 release tarball (download.gnome.org), 2003 | Bitstream Vera licence |

Wine's fonts are its own clones, drawn for Wine, not Microsoft's Tahoma. Wine's `tahomabd.ttf` isn't taken: its outlines draw at regular weight, so the browser synthesises bold from the regular face. The licence texts are in `apps/web/src/fonts/LICENSES/`.

## Icons

`icons.lock.json`, written to `apps/web/src/icons/` by `mise run icons:vendor`.

| Folder   | Source                                                                                  | Licence       |
| -------- | --------------------------------------------------------------------------------------- | ------------- |
| `xp/`    | `themes/XP/icon/*.svg` from the `xp.css` npm package, 0.2.6                             | MIT           |
| `tango/` | Tango Icon Theme 0.8.90 source tarball, from snapshot.debian.org; 16, 22 and 32 px PNGs | public domain |
| `brand/` | `assets/brand/` in this repository: Pigeon's own art                                    | ours          |

The licence texts are in `apps/web/src/icons/LICENSES/`. XP.css's own MS Sans Serif fonts are never taken.

## Wallpapers

`wallpapers.lock.json`, written to `apps/web/src/wallpapers/` by `mise run wallpapers:vendor`.

| File        | Source                                                                                                                                   | Licence                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `hills.jpg` | Unsplash `photo-1756074924706-48ca9f24410f` by [@bchen22](https://unsplash.com/@bchen22), cropped to 1024×768 by Unsplash's image server | [Unsplash License](https://unsplash.com/license) |

The crop is part of the URL, so the bytes are stable and pinned like any download.

## Rules

- Don't edit a vendored file in place; it is overwritten on the next run.
- To add an icon or a size: add it to the lock, run the task, review the diff.
- To update a source: change its version or URL and its `integrity` (`sha512-` plus the base64 SHA-512 of the download), run the task, review the diff.
- To change Pigeon's own art: edit the master in `assets/brand/`, then run `mise run icons:vendor`.
