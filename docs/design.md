# Design

The XP-era design system: where the source of truth lives, the rendering rules, and what assets may be used.

## Source of truth

The design canvas: https://claude.ai/artifact/FDEoYa39CvZD78dRffPYTB

- **Desktop** page: the interactive fake desktop (1024×768 at 2×), Add a Friend, phone layout.
- **Design system** page: Foundations (colour tokens, gradients, type, metrics, frames), Components (every control and its states), Icons & assets.
- **Pigeon Explorer** page: Pigeon Search portal, a homepage, the "page not hosted" error.
- **Implementation** page: architecture diagram and the original spec. Where it differs from docs/, docs/ wins.

Component names on the canvas match the Solid components in `apps/web/src/ui/` (one folder each, styled by a CSS Module beside it). Token names match `apps/web/src/ui/tokens.css`: a name on the Foundations board becomes a CSS custom property with a `--pg-` prefix and its dots turned into dashes, so `frame.blue.dark` is `--pg-frame-blue-dark` and `grad.title.active` is `--pg-grad-title-active`. Frames are box-shadow stacks (`--pg-frame-window-active`), type tokens are `font` shorthands (`--pg-type-body`), metrics are lengths (`--pg-titlebar-height`). Change a value on the canvas and in tokens.css together.

## Fonts

Bundled only ([0009](decisions/0009-bundled-fonts-only.md)): Wine's Tahoma clone for all interface text, with bold synthesised from the regular face, and Bitstream Vera Sans Mono for monospace. The canvas's Trebuchet MS and Lucida Console are not used.

## Rendering

- The screen is laid out at its resolution, 800×600, 1024×768 (default) or 1280×1024, chosen in Display Properties, and scaled by a whole number with `transform: scale(n)` ([0012](decisions/0012-crt-monitor-and-resolutions.md)).
- It sits in a beige CRT monitor by the made-up maker Kestrel, drawn in CSS (`shell/monitor/`): a slim, even 25px frame with nothing below the screen ([0020](decisions/0020-a-slim-monitor-with-nothing-below.md)), scaled by the same number, floating with no stand in a black room lit by a WebGL backdrop shader (`shell/backdrop/`, [0014](decisions/0014-shader-backdrop-no-stand.md)). The scale is the largest whole number at which the whole monitor fits. If the monitor won't fit at 1×, the bare screen is shown, square-cornered; if the screen won't fit (narrower than its width, or shorter than five sixths of its height), the phone layout is used.
- All bitmaps `image-rendering: pixelated`. Optional pixel mode samples one pixel per 2×2 block at scale 2 (SVG filter).
- CRT effect, on by default and switchable in Display Properties: a live SVG filter on the screen (a slight barrel bend, colour fringing, brightness-aware scanlines and bloom) under the glass's reflection, rounded edges, rolling refresh band and flicker (the last two stopped under `prefers-reduced-motion`). It softens the pixels and costs rendering time ([0013](decisions/0013-crt-effect-as-a-live-svg-filter.md)).
- Phone layout, the Kestrel Pocket ([0019](decisions/0019-the-kestrel-pocket-phone-layout.md)): a matte black handheld whose screen fills the phone, soft keys (two raised rounded-square keys hollowed around a round home key, whose words show in a blue strip at the screen's bottom edge, the left one changing with the screen and the right one opening the menu, and a round home key for Today), a Today screen, one window at a time with a 44px close button, the Pigeon menu from the bottom right, and an LCD look instead of the CRT. Size tokens grow to touch sizes inside it; controls that rearrange for a finger read `ui/layout`. While a text field is focused on a touch screen the keys step aside and the screen fits above the keyboard. Settings there has only the LCD effect and the buzz; a buzz vibrates the phone where it can.
- Text that doesn't fit on one line (status bars, phone title bars, Today's rows) drifts slowly to its end and back (`ui/marquee`), and stays put when motion is reduced.
- `prefers-reduced-motion`: buzz flashes the title bar instead of shaking the window.
- Turning Pigeon off (Turn Off Pigeon, Turn off the Pocket), or leaving it untouched for the wait set in Display Properties (Screen Saver tab, 5 minutes unless changed; Settings on a phone), puts it to sleep, not away: windows stay as they were and a click, tap, key or incoming buzz wakes it. The desktop shows a screen saver on the monitor, CRT and all: Pigeons in flight (logos crossing a starry sky) or Maze (a walk through a new brick maze with tiled ceiling and floor, a hand on the left wall, drawn at 320×240 in big pixels; `shell/maze-saver/`). The Pocket dims to standby: its wallpaper with the backlight at a third, a big clock and date, and what's new. With reduced motion the savers hold still.
- Nothing selects by accident: the page is `user-select: none`, and only fields and elements marked `data-selectable` (the chat transcript, the text in Pigeon Reader) can be selected and copied.

## Menu and taskbar

The Pigeon menu and taskbar follow the era's proportions more closely than the canvas: a 54px header, 34px pinned items (bold, with a grey description) over the rest, All Programs at the bottom of the white column, 26px items in the blue column, a 36px footer, and 22px task buttons. The measurements were checked against [ShizukuIchi/winXP](https://github.com/ShizukuIchi/winXP) (MIT); only numbers and colours were taken, none of its images. In every menu, the highlight is keyboard focus: it follows the pointer, clears when the pointer leaves, and a menu opened with the mouse starts with nothing highlighted.

## Desktop and balloons

The desktop shows Pigeon Messenger, Read Me.txt, Changelog.txt, Letters, Shared Files, Source Code and Trash. Read Me.txt and Changelog.txt open in Pigeon Reader (`apps/reader/`), a plain-text window with Word Wrap; What's New in the menu opens Changelog.txt too. Balloons come from the tray, one at a time, and close themselves after 10 seconds. A balloon that does something, such as "Pigeon was updated to 0.4.0. See what's new?", does it when clicked anywhere but its close button, and its text is a button for the keyboard ([0025](decisions/0025-release-notes-for-people.md)).

## Friends

A friend's menu opens on right-click, a long press on a touch screen, or the menu key (Shift+F10): Send a Message, Buzz!, View Profile, Rename..., Copy Fingerprint, Mute... (or Unmute), and Remove Friend.... It's the same `ui/menu` as the menu bars, placed at the pointer and kept inside the list. Each item opens a small window from `apps/messenger/friend-dialogs/`: the profile (name, status, message, fingerprint, friends since), a petname shown everywhere instead of their handle, muting for 1 hour, 8 hours, a day or until unmuted (no balloons, buzzes don't shake or vibrate, "(muted)" in the list), and removing with an optional block. Contacts, Blocked People... lists who's blocked, with Unblock. Someone who removed you shows "(removed you)", and their chat turns read-only with a last line saying when. The Messenger's Actions menu carries the selected friend's items too (without access keys, which the status items use), and a chat window's Actions menu adds that friend's profile, rename, mute and remove items after its own. The browser's own context menu is turned off everywhere except fields and selectable text, where Copy and Paste live.

## Controls drawn in the page

Nothing opens outside the page: a native `<select>` draws its list in a browser popup that the stage's scale and the CRT effect can't reach, so `ui/select/` draws its own list (the select-only combobox pattern, with the arrows changing the choice even while closed, as the era's list boxes did).

## Assets and licences

| Asset                                        | Source                                                                               | Licence                |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| Control values (frames, gradients, buttons)  | XP.css v0.2.6                                                                        | MIT                    |
| Title-bar button bitmaps                     | XP.css v0.2.6                                                                        | MIT                    |
| Tahoma regular                               | Wine project clone                                                                   | LGPL 2.1               |
| Monospace                                    | Bitstream Vera Sans Mono 1.10                                                        | Bitstream Vera licence |
| General icons                                | Tango Desktop Project                                                                | public domain          |
| Pigeon orb logo, presence figures, buzz icon | drawn for Pigeon, `assets/brand/`                                                    | ours                   |
| Wallpaper                                    | Unsplash photo of rolling hills ([0011](decisions/0011-unsplash-photo-wallpaper.md)) | Unsplash License       |

Third-party fonts, icons and the wallpaper are vendored from pinned sources by `mise run fonts:vendor`, `icons:vendor` and `wallpapers:vendor` into `apps/web/src/fonts/`, `icons/` and `wallpapers/`, licences included; see [vendor/VENDOR.md](../vendor/VENDOR.md). Pigeon's own art is mastered in `assets/brand/` and copied in by the same task.

Never: the Windows logo, Bliss, Microsoft icons, sounds, cursors or fonts (including rips such as the itch.io "Win XP asset pack"), the word "start", or product names like "My Computer" and "Internet Explorer". Credit XP.css, Wine, Bitstream Vera, Tango and Unsplash in the About box and README.

## Custom icons

Drawn the XP way: art 2px under size (46, 30, 22, 14), light from the upper left, outline in a darker shade of the object's colour, drop shadow black 75% at 135°, distance 2, size 2 (1 at 16px). Ship a PNG per size; hand-pixel the 16px. Masters live in `assets/brand/`.

## Avatars

Everyone's picture is a pixel pigeon drawn from their id (`packages/core/src/avatar/`), the same on every Pigeon, and nothing about it is sent. The SHA-256 of `pigeon/avatar/v1` and the id picks the traits:

- The bird: plumage (12, all real pigeon colours), neck sheen (6), wing (4), head marking (6), eye (5), expression (4, bright on most birds) and beak (3).
- What it wears, each slot apart: headwear (9, on half of birds), neckwear (3), eyewear (3) and something held in the beak (a letter or an olive twig, on one in eight).
- Where it is: tile (12) and pattern (6), a scene behind it (a telephone wire, rooftops, a branch or hills) and something in the sky (a sun, which is a moon at night, a cloud, a paper plane or stars).

That is about 90 billion birds. They're drawn at 32×32 by the custom-icon rules (lit from the upper left, outlined in a darker shade, a soft shadow down and to the right), shown as an SVG with `crispEdges`, with a sentence for alt text ("A slate pigeon with a copper neck, wearing a flat cap and a scarf, on a wire").

Where it shows: `ui/avatar` draws a bird in a white display-picture frame, and the Messenger works out the traits (`avatarOf`, `apps/messenger/friend-avatar/`). A conversation shows the friend's bird at 32px before its "To:" line, and their profile at 64px above the facts, its description as the alt text and tooltip. The buddy list and the pairing screen come next.

The generated bird is the only avatar: nobody can wear someone else's face, and there is nothing to upload, store, sync or moderate. A bird is only about 32 bits, so anyone could grind keys until one matches, which is why it sits beside the fingerprint and never stands in for it.

Birds stay put:

- The traits an id gets are frozen per version: which digest byte each trait reads, how often it is worn, and every option list. New options make a version 2, with tables of their own; version 1 stays in the code. Tests pin the traits of twenty ids, so a change that would move somebody's bird fails.
- How a trait is drawn may improve at any time: a better flat cap is still a flat cap.
- `hello` carries the version a person's bird is drawn with (1 when left out), so a new version only reaches new people and those who ask for it. A version this Pigeon doesn't know yet is drawn as the newest one it does.

The art is drawn for Pigeon in code; it copies no one's, including Pigeon's own logo.
