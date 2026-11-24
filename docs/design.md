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
- Nothing selects by accident: the page is `user-select: none`, and only fields and elements marked `data-selectable` (the chat transcript, Read Me's text) can be selected and copied.

## Menu and taskbar

The Pigeon menu and taskbar follow the era's proportions more closely than the canvas: a 54px header, 34px pinned items (bold, with a grey description) over the rest, All Programs at the bottom of the white column, 26px items in the blue column, a 36px footer, and 22px task buttons. The measurements were checked against [ShizukuIchi/winXP](https://github.com/ShizukuIchi/winXP) (MIT); only numbers and colours were taken, none of its images. In every menu, the highlight is keyboard focus: it follows the pointer, clears when the pointer leaves, and a menu opened with the mouse starts with nothing highlighted.

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
