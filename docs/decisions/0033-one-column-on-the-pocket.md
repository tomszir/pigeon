# 0033: One Column on the Pocket

Explorer makes pages readable on a phone the way handheld browsers of 2003 did: it changes how a page is drawn, never what the page says.

- Status: accepted
- Date: 2026-11-25

## Context

PigeonHTML pages are laid out the 2003 way, with fixed-width tables near 800px, `<font size=2>` and sliced images. On the Kestrel Pocket ([0019](0019-the-kestrel-pocket-phone-layout.md)) Explorer drew them squeezed into the phone's width. The text was small and the pages scrolled sideways. Making pages responsive would mean changing the language or the pages, and the period never had that. Handhelds of the time solved it in the browser. Pocket Internet Explorer on Windows Mobile 2003 had a One Column view and a Text Size setting, and Opera's Small-Screen Rendering (2003) reflowed any page to the screen's width.

## Decision

- **View modes in Explorer.** View has **One Column** and **Desktop Layout**, plus **Text Larger** and **Text Smaller** (Ctrl+Plus and Ctrl+Minus) across five steps from Smallest to Largest. On the Pocket Explorer opens in One Column, and on the desktop in Desktop Layout. The status bar says "One Column" while it's on. Text Size carries to every Explorer window. A mode carries only within the layout you chose it on, since resizing Pigeon's window moves it between the desktop and the Pocket. `app/` keeps both for the rest of the visit, the way Display Properties are kept, until settings are stored.
- **One Column is Explorer's own stylesheet.** It's written after the base stylesheet, and every rule is `!important`. It turns tables and cells into blocks one under another, drops fixed and minimum widths, side margins, no-wrap, cell alignment (stacked cells side by side would make a staircase; a `<center>` inside one still centres), positioning and floats, counts padding and borders inside a box's width, shrinks images to the screen, and raises `<font size=1>` to a readable size. It keeps colours, fonts, marquees and centering. Preformatted text keeps its lines and scrolls sideways in its own box, so ASCII diagrams stay drawn.
- **Desktop Layout keeps a page as its author made it.** On the Pocket the page is laid out at least 800px wide and the frame scrolls. On the desktop nothing is added.
- **Text Size zooms the page.** It uses CSS `zoom` on the frame's root, from 0.7 to 1.45. `<font size>` names sizes that page CSS can't scale, so zooming is the only way to make every page's text bigger.
- **Pages and the sanitizer don't change.** A page reads the same to everyone who hosts or mirrors it, and only how one Explorer draws it differs.

## Consequences

Pages are readable on a phone and still look like 2003. A page built from pixel-exact tables (spacer GIFs, sliced images) comes apart in One Column, as it did on handhelds of the time, and Desktop Layout is there for it. Text Size makes the images bigger along with the text, as later browsers' zoom did, where 2003's Text Size changed only the text. Pinch-zooming inside the frame isn't offered. Changing the view draws the page again from the top. The choice is forgotten when Pigeon closes.
