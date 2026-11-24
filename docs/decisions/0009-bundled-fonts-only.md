# 0009: Bundled fonts only

Every piece of UI text uses a font Pigeon ships: Wine Tahoma for the interface, Bitstream Vera Sans Mono for monospace.

- Status: accepted
- Date: 2026-11-24

## Context

The design canvas sets title bars and the menu button in Trebuchet MS, monospace text in Lucida Console, and peer-page headings in Comic Sans MS, all with Tahoma as the fallback. Those are Microsoft fonts. Pigeon can't ship them ([0007](0007-original-and-openly-licensed-assets-only.md)), and relying on whatever the visitor has installed means the stage renders differently on every machine, which breaks the pixel-exact rule ([0008](0008-pixel-exact-1024x768-stage.md)). Most Linux and phone visitors have none of them.

## Decision

- Interface text, title bars and the menu button: Wine's Tahoma clone. Bold is synthesised by the browser from the regular face, because Wine's `tahomabd.ttf` draws at regular weight with loose spacing when rendered from its outlines.
- Monospace (Read Me, addresses, code): Bitstream Vera Sans Mono, released in 2003 and freely licensed.
- No `font-family` in the shell or UI kit names a font Pigeon doesn't ship, apart from a final generic `sans-serif` or `monospace`.
- Peer pages are a separate question for M5, since PigeonHTML lets page authors name fonts.

Both are vendored from pinned upstream sources ([vendor/VENDOR.md](../../vendor/VENDOR.md)).

## Consequences

The stage looks the same everywhere. Title bars lose Trebuchet's rounder shapes, which the canvas showed. Tokens name the font stacks once, so a different choice later is a one-line change.
