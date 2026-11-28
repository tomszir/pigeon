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

Bundled only: Wine's Tahoma clone for all interface text, with bold synthesised from the regular face, and Bitstream Vera Sans Mono for monospace. The canvas's Trebuchet MS and Lucida Console are not used.

## Rendering

- The screen is laid out at its resolution, 800×600, 1024×768 (default) or 1280×1024, chosen in Display Properties, and scaled by a whole number with `transform: scale(n)`.
- It sits in a beige CRT monitor by the made-up maker Kestrel, drawn in CSS (`shell/monitor/`): a slim, even 25px frame with nothing below the screen, scaled by the same number, floating with no stand in a black room lit by a WebGL backdrop shader (`shell/backdrop/`). The scale is the largest whole number at which the whole monitor fits. If the monitor won't fit at 1×, the bare screen is shown, square-cornered; if the screen won't fit (narrower than its width, or shorter than five sixths of its height), the phone layout is used.
- All bitmaps `image-rendering: pixelated`. Optional pixel mode samples one pixel per 2×2 block at scale 2 (SVG filter).
- CRT effect, on by default and switchable in Display Properties: a live SVG filter on the screen (a slight barrel bend, colour fringing, brightness-aware scanlines and bloom) under the glass's reflection, rounded edges, rolling refresh band and flicker (the last two stopped under `prefers-reduced-motion`). It softens the pixels and costs rendering time.
- Phone layout, the Kestrel Pocket: a matte black handheld whose screen fills the phone, soft keys (two raised rounded-square keys hollowed around a round home key, whose words show in a blue strip at the screen's bottom edge, the left one changing with the screen and the right one opening the menu, and a round home key for Today), a Today screen, one window at a time with a 44px close button, the Pigeon menu from the bottom right, and an LCD look instead of the CRT. Size tokens grow to touch sizes inside it; controls that rearrange for a finger read `ui/layout`. While a text field is focused on a touch screen the keys step aside and the screen fits above the keyboard. Settings there has only the LCD effect and the buzz; a buzz vibrates the phone where it can.
- The browser's Back, a phone's back gesture included, steps back inside Pigeon before it leaves. It closes an open menu first, then goes back a page in Explorer, then on the Pocket closes the window in front to Today. From Today, or on the desktop once no menu or Explorer page is left, it leaves the site. The desktop's windows stay open.
- Text that doesn't fit on one line (status bars, phone title bars) drifts slowly to its end and back (`ui/marquee`), and stays put when motion is reduced.
- `prefers-reduced-motion`: buzz flashes the title bar instead of shaking the window.
- Turning Pigeon off (Turn Off Pigeon, Turn off the Pocket), or leaving it untouched for the wait set in Display Properties (Screen Saver tab, 5 minutes unless changed; Settings on a phone), puts it to sleep, not away: windows stay as they were and a click, tap, key or incoming buzz wakes it. The desktop shows a screen saver on the monitor, CRT and all: Pigeons in flight (logos crossing a starry sky) or Maze (a walk through a new brick maze with tiled ceiling and floor, a hand on the left wall, drawn at 320×240 in big pixels; `shell/maze-saver/`). The Pocket dims to standby: its wallpaper with the backlight at a third, a big clock and date, and what's new. With reduced motion the savers hold still.
- Nothing selects by accident: the page is `user-select: none`, and only fields and elements marked `data-selectable` (the chat transcript, the text in Pigeon Reader) can be selected and copied.

## Menu and taskbar

The Pigeon menu and taskbar follow the era's proportions more closely than the canvas: a 54px header, 34px pinned items (bold, with a grey description) over the rest, All Programs at the bottom of the white column, 26px items in the blue column, a 36px footer, and 22px task buttons. The measurements were checked against [ShizukuIchi/winXP](https://github.com/ShizukuIchi/winXP) (MIT); only numbers and colours were taken, none of its images. In every menu, the highlight is keyboard focus: it follows the pointer, clears when the pointer leaves, and a menu opened with the mouse starts with nothing highlighted.

## Desktop and balloons

The desktop shows Pigeon Messenger, Network, Read Me.txt, Changelog.txt, Letters, Shared Files, Source Code and Trash, and on an iPhone or iPad in a Safari tab Add to Home Screen.txt, which says why and how to keep Pigeon there (also in the menu's tools, and offered once in a balloon). Read Me.txt says what works, how to start, what a Lighthouse sees and the known limits, and that Pigeon hasn't been independently audited, with where to report a problem. The text files open in Pigeon Reader (`apps/reader/`), a plain-text window with Word Wrap; What's New in the menu opens Changelog.txt too.

The Messenger's File menu has Always Go Through the Relay, a check item that reconnects everything through the TURN relay and says so in a balloon; Network shows the same setting, so it isn't only in the Messenger. With it on and no relay to be had, Pigeon doesn't connect directly; a balloon says the relay can't be reached and where to turn the setting off.

Balloons come from the tray, one at a time, and close themselves after 10 seconds.

- A balloon that does something ("Pigeon was updated to 0.4.0. See what's new?") does it when clicked anywhere but its close button. Its text is a button for the keyboard.
- On the Pocket a balloon also closes when a window comes to the front, so it never covers that window's buttons.

Updating an open tab (`apps/web/src/app/update-check.ts`, `update-reload.ts`, `unsaved-work.ts`):

- A tab keeps running the version it loaded, so it updates itself.
- It fetches `/version.json` (same version as `__PIGEON_VERSION__`) when it comes back into view (at most every 5 minutes) and every hour. A file that can't be fetched or read, or names the same or an older version, changes nothing.
- When it names a later one, the tab reloads only when nothing would be lost and nobody is looking.
- Something would be lost while:
  - an Add a Friend, Link a Device, Link to My Other Device, recovery key or Export/Import window is open
  - text is typed in any field and not sent or saved. The app's own fields mark this themselves (a rename or profile dialog counts unfocused, a field only the app filled doesn't). Explorer's address bar opts out. Other fields count when multi-line, or one-line and focused
  - a chat write to storage isn't finished
  - a letter is waiting its few seconds or being sealed and put
  - forgetting this Pigeon to link it elsewhere is under way
- Hidden or idle doesn't change that.
- Other work (the outbox, fetched mail, a removal still to act on, a pair secret being replaced) is kept as it goes and resumed on the next start, so it doesn't block the update.
- An open window does block it. The tab updates once the window is closed and the tab is left alone for 30 seconds.
- Nobody is looking when the tab is hidden or has had no click, key or touch for 30 seconds. Until both hold, it rechecks every 5 seconds and when hidden.
- Once per version: the tab keeps the version it reloaded for in session storage. If the same version is still out afterwards (old code served again, or a dev server started before the version changed) it doesn't reload again. If session storage can't be written, it doesn't reload.
- A tab whose browser keeps nothing between visits never reloads by itself, since that forgets the person. It shows a balloon once per version saying an update is out and that reloading forgets this Pigeon. Clicking opens a box with Reload and Not Now.
- The tab waiting behind "Pigeon is open in another tab" also updates, having nothing to lose.
- After the reload, the What's new balloon says "Pigeon was updated to 0.9.0. See what's new?".

First run and the Pocket:

- The first time Pigeon opens in a browser (no identity yet) it opens Read Me.txt and a "Welcome to Pigeon" balloon. After that it opens straight to the desktop.
- On the Pocket, a conversation's toolbar shows only what works (Buzz!), and Explorer's One Column keeps a marquee on one line.

## Devices

Add a Friend has three tabs (`apps/messenger/add-friend/`, `apps/messenger/invite-links/`): Invite Links, Quick Code and Have an Invite? (Have One? on the Pocket). On the desktop and the Pocket alike they share the width and are a finger tall.

Invite Links:

- Waiting for You lists first, with the count (also on the tab's label). Each request shows the asker's bird, name and fingerprint, and Add and Decline.
  - A reminder says anyone with the link can use any name.
  - A red note shows when the name matches a friend's or another request's.
- New Link:
  - Lasts: 1 hour, 1 day or 7 days (default 7 days).
  - For: 1 to 25 people (default 1).
  - Labels sit beside the controls on the desktop, above them on the Pocket.
  - Make Link copies the new link.
- Copying a link copies a line saying who it's from, then the link ("Toms invites you to Pigeon!"), ready to paste. Have an Invite? opens that whole message as well as the bare link.
- Your Links shows each open link:
  - short, as a link that copies itself when clicked ("localhost:5533/#b/2n22…c5zpde", the whole address in its tooltip)
  - how many places and how long are left
  - Copy Link, and Delete, which closes it for good (its card says so, and whoever is waiting is told)
- Links have no QR code. Quick Code is the one to scan.

Quick Code:

- The live code in big letters beside its QR code, with when it changes next, Copy Code and New Code.
- Made when the tab shows, and made again after each use and every 30 minutes.

Have an Invite?:

- Takes a code or either kind of link.
- A link shows whose it is with Ask to Be Friends, or why it can't be used (run out, closed, or lasting longer than any link can).
- Requests you sent are listed under it with what came back (waiting, declined, closed, busy), and Stop Waiting or OK.

The Messenger's File menu has My Devices..., Link a Device... and Link to My Other Device... (`apps/messenger/link-device/`, `join-device/`, `my-devices/`).

- Link a Device... is on the first device only, since only it changes the list.
- Link to My Other Device..., on a Pigeon that already has friends or devices, says so and offers Leave This Pigeon and Link...:
  - It forgets this Pigeon here after telling online friends, when nothing else has this Pigeon.
  - Add a Friend's progress shows how many have heard. Don't Wait goes on without the rest.
  - A recovered Pigeon waiting for its list doesn't offer it.
- Link a Device shows a QR code and the code in big letters, like an invite, then "Is this your device?":
  - the new device's fingerprint in larger letters, and a name for it (browser and system, "Firefox on Linux", until changed)
  - Link, Not This Device and Cancel
  - a red warning after a wrong code ("Someone typed a wrong code once"), or after five that the code was stopped
- The new device shows its own fingerprint and waits. Once linked it says so and starts again as you.
- My Devices lists each device by name and its own fingerprint, the first half of the device key's ("Firefox on Linux · 3f9a 21c0"):
  - the same on every one of your devices, never a browser fingerprint
  - "(this device)" and when it was linked, or that it's the first device
  - on the first device, each other one has Remove..., which asks once more
  - elsewhere, a line says devices are linked and removed on the device that manages your list (the first device, unless the recovery key moved that) and to keep it safe

Make a Recovery Key... (File menu, on the first device until it has one; it also opens right after a new Pigeon gets its name, with Later, and a balloon reminds you once on a later visit) explains what the key is for, then shows the code in groups of four, with Save as File... behind a passphrase and a warning that whoever has it can take over your Pigeon. The list commits to it only on I've Kept It. Recover My Pigeon... (on a Pigeon with nobody on it) and Use My Recovery Key... (on one that's already you and has its whole list, with Keep my other devices to untick after a theft) take the code or its file, say when a letter's wrong or the key was replaced, then show the next key to keep before anything is signed. A recovered device waits for an old friend to hand back its whole list: until then My Devices says so, Link a Device is greyed out, Link to My Other Device isn't offered, and Recover My Pigeon takes only the same code again. The windows say to keep the old code as well as the new one until a friend has paired again (`apps/messenger/recovery/`).

A device whose key is also open in another browser, as a copied profile's would be, says "This Pigeon is also open somewhere else" in a balloon that opens My Devices, which explains it and offers Make This a New Device...: after asking again, it forgets everything in this browser and opens Link to My Other Device.

Pigeon runs in one tab at a time: a second tab is covered, desktop and taskbar or the whole Pocket screen, by "Pigeon is open in another tab" in the blue of a locked computer (`shell/elsewhere/`), and nothing behind it works, the Pocket's keys included. Its one button, Use Pigeon Here, moves Pigeon there, and the first tab is covered the same way, saying Pigeon moved to another tab. The same screen, with the error icon, says when Pigeon couldn't start in this browser: it shows the error's own words for a bug report, Try Again reloads, and Start Over... asks once more, then forgets everything Pigeon keeps in this browser and starts it new.

A removed device says so in a balloon and in its buddy list. A chat with a friend whose Pigeon is from before devices ends with a line saying they need an update to get messages from this device.

## Your data

The Messenger's File menu has Export My Data... and Import My Data... (`apps/messenger/your-data/`). Export asks for a passphrase twice (at least 8 characters, with the problem said under the fields), says the file holds each friend's secret, so with the passphrase it would let someone find those friends online, and that nobody can open it without the passphrase, and saves `Pigeon data <date>.txt`, whose first lines say what it is and how to import it. Import has Choose File... and a passphrase. It says when the passphrase doesn't open the file, when this device couldn't work with the passphrase (stretching it takes tens of megabytes), when the file is someone else's Pigeon, or when it isn't an export, and once it's in, says so and starts Pigeon again.

Saved friends are read one at a time. A record that fails its check is kept aside, exactly as it was stored and never written over, under its own storage key, and a balloon says how many friends couldn't be loaded; every other friend loads and is saved as usual. Friends in the bundle a new device is linked with are read the same way, and one it can't take is kept aside and counted with them. Saved farewells (friends you removed who haven't been told yet) and the blocked list are read the same way, each with its own storage key and balloon, so one unreadable record never empties its list.
A conversation window's File menu has Save Conversation As..., which saves `Conversation with <name>.txt`: who it's with and their fingerprint, when it was saved, when you became friends, then each message on a line as `[November 24, 6:38 PM] Mika: text`, every message line kept within 76 columns, counting anything past ASCII as two (a message is cut into rows at spaces, and inside words too long for a row), every row a message runs on to indented four spaces and a left-to-right mark, control characters in a message written as `�`, and names cut to 32 columns, so a monospace viewer at least 76 columns wide shows no part of a message where a message of its own starts; a narrower one that wraps lines, or one drawing some characters wider still, can. A friend whose name, as drawn, starts with yours (as your lines show it) or holds a colon is written as `Rook (friend)`, and the last line, when they removed you, reads `You were removed as a friend by Rook on ...`. Buzzes and comings and goings are left out.

## Friends

A friend's menu opens on right-click, a long press on a touch screen, or the menu key (Shift+F10): Send a Message, Buzz!, View Profile, Rename..., Copy Fingerprint, Mute... (or Unmute), and Remove Friend.... It's the same `ui/menu` as the menu bars, placed at the pointer and kept inside the list. Each item opens a small window from `apps/messenger/friend-dialogs/`: the profile (name, status, message, fingerprint, friends since), a petname shown everywhere instead of their handle, muting for 1 hour, 8 hours, a day or until unmuted (no balloons, buzzes don't shake or vibrate, "(muted)" in the list), and removing with an optional block. Contacts, Blocked People... lists who's blocked, with Unblock. Someone who removed you shows "(removed you)", and their chat turns read-only with a last line saying when. The Messenger's Actions menu carries the selected friend's items too (without access keys, which the status items use), and a chat window's Actions menu adds that friend's profile, rename, mute and remove items after its own. The browser's own context menu is turned off everywhere except fields and selectable text, where Copy and Paste live.

## Pigeon Explorer

Explorer (`apps/explorer/`) follows the canvas's Pigeon Explorer page, with only what works: a menu bar of File (Open..., Close), Edit (Copy, Select All), View (Back, Forward, Home Page, Stop, Refresh, One Column, Desktop Layout, Text Larger, Text Smaller, Status Bar), Favorites (Pigeon Home) and Help (About Pigeon); a toolbar of Back, Forward, Stop, Refresh and Home, each a 22px Tango icon beside its word, wrapping onto a second row when the window is narrow; an Address field with Go; the page in a white well with a 1px blue-grey edge; and a status bar whose first field says what's happening ("Done", the address of the link under the pointer) and whose second says where the page came from, "On this computer" by the Pigeon logo for bundled pages, or "Pigeonweb" when nobody is hosting it. Search, Mirror and Letters from the canvas's toolbar are left out until pages are hosted by peers.

Explorer's own pages ("This page isn't being hosted right now", "This page is too big to open") are drawn like the canvas's error: a 32px Tango icon beside a column of text with an 18px dark blue heading, a rule, what to try, Retry and Home Page buttons, and a monospace line with the reason (`PGN_NO_PEERS`, `PGN_TOO_BIG`).

On the Pocket the toolbar and address bar are one command row, as handheld browsers had: Back and Forward, the address field (its label kept for screen readers; the keyboard's Go key opens it), then Refresh, which is Stop while a page loads, and Home, each a 22px icon alone on a 44px touch target. On the Pocket pages open in One Column, stacked to the screen's width as handheld browsers of the time drew them, with links that stand alone in a cell or list item drawn as 44px rows, and the status bar says so; Desktop Layout keeps a page 800px wide to scroll. The window title is always "Pigeon Explorer".

## Controls drawn in the page

Nothing opens outside the page: a native `<select>` draws its list in a browser popup that the stage's scale and the CRT effect can't reach, so `ui/select/` draws its own list (the select-only combobox pattern, with the arrows changing the choice even while closed, as the era's list boxes did).

## Assets and licences

| Asset                                                                                        | Source                            | Licence                |
| -------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------- |
| Control values (frames, gradients, buttons)                                                  | XP.css v0.2.6                     | MIT                    |
| Title-bar button bitmaps, and the checkmark the message ticks are recoloured from            | XP.css v0.2.6                     | MIT                    |
| Tahoma regular                                                                               | Wine project clone                | LGPL 2.1               |
| Monospace                                                                                    | Bitstream Vera Sans Mono 1.10     | Bitstream Vera licence |
| General icons                                                                                | Tango Desktop Project             | public domain          |
| Pigeon orb logo, Messenger icon, notifications bell, presence figures, buzz icon, the letter | drawn for Pigeon, `assets/brand/` | ours                   |
| Wallpaper                                                                                    | Unsplash photo of rolling hills   | Unsplash License       |

Third-party fonts, icons and the wallpaper are vendored from pinned sources by `mise run fonts:vendor`, `icons:vendor` and `wallpapers:vendor` into `apps/web/src/fonts/`, `icons/` and `wallpapers/`, licences included; see [vendor/VENDOR.md](../vendor/VENDOR.md). Pigeon's own art is mastered in `assets/brand/` and copied in by the same task. The Home Screen icons in `apps/web/public/` (named in `manifest.webmanifest`, for iPhone and Android) are the 128px orb centred on the desktop blue: `apple-touch-icon.png` (180×180), `icon-192.png`, and `icon-512.png` with the orb scaled 3× in whole pixels, also the maskable icon. The share card, `apps/web/public/share-card.png` (1200×630), is what chat apps and search engines show beside a link to Pigeon, invite links included: a Pigeon window on the hills wallpaper, through the CRT effect, with the orb, the tagline ("The internet of 2003, if peer-to-peer had won.") and a line each for Pigeon Messenger, Pigeon Explorer and your people. Its master is `assets/brand/share-card.html`, laid out at 600×315 and rendered at 2× by `mise run share-card` (`apps/web/share-card.ts`); the page's preview tags in `apps/web/index.html` name it.

Never: the Windows logo, Bliss, Microsoft icons, sounds, cursors or fonts (including rips such as the itch.io "Win XP asset pack"), the word "start", or product names like "My Computer" and "Internet Explorer". Credit XP.css, Wine, Bitstream Vera, Tango and Unsplash in the About box and README.

## Custom icons

Drawn the XP way: art 2px under size (46, 30, 22, 14), light from the upper left, outline in a darker shade of the object's colour, drop shadow black 75% at 135°, distance 2, size 2 (1 at 16px). Ship a PNG per size; hand-pixel the 16px. Masters live in `assets/brand/`.

The orb is Pigeon's own mark: About, the Pigeon menu, the taskbar's Pigeon button, Pigeon's messages and balloons, and Explorer's "On this computer". Pigeon Messenger has an icon of its own, a white speech balloon with a rock pigeon in it drawn like the avatars, its wing filling the balloon's tail, and a green balloon answering behind (`messenger-16`, `-22`, `-32`, `-48`; the 16px hand-pixelled, the others from their SVG masters). The tray's notifications are a gold bell, `bell-16`, hand-pixelled. The message ticks are XP.css's checkmark recoloured, so they carry its licence (`tick-mailed`, grey, 11px wide, and `tick-received`, two of them in blue, 16px wide; the pixel path is the same). The airmail letter (`letter-16`, `-22` and `-32`, and `letter-opening-32`, its five frames side by side; the 16px hand-pixelled) is drawn the same way as the other custom icons. The Messenger's icon is on the Messenger's launcher, desktop icon, Pocket tile and window, conversation windows, message balloons without a friend's bird, the buddy list's No Friends Yet and Today's Choose Your Name.

## Avatars

Everyone's picture is a pixel pigeon drawn from their id (`packages/core/src/avatar/`), the same on every Pigeon, and nothing about it is sent. The SHA-256 of `pigeon/avatar/v1` and the id picks the traits:

- The bird: plumage (12, all real pigeon colours), neck sheen (6), wing (4), head marking (6), eye (5), expression (4, bright on most birds) and beak (3).
- What it wears, each slot apart: headwear (9, on half of birds), neckwear (3), eyewear (3) and something held in the beak (a letter or an olive twig, on one in eight).
- Where it is: tile (12) and pattern (6), a scene behind it (a telephone wire, rooftops, a branch or hills) and something in the sky (a sun, which is a moon at night, a cloud, a paper plane or stars).

That is about 90 billion birds. They're drawn at 32×32 by the custom-icon rules (lit from the upper left, outlined in a darker shade, a soft shadow down and to the right), shown as an SVG with `crispEdges`, with a sentence for alt text ("A slate pigeon with a copper neck, wearing a flat cap and a scarf, on a wire").

Today, the Pocket's home:

- The date and greeting on the wallpaper, with your programs under them as 48px tiles, four to a row: Messenger, Explorer, Add Friend, Network, Read Me, Help, Settings and Letters.
- Messenger and Add Friend carry how many wait in them as an orange badge on the tile's corner.
- Under the wallpaper:
  - Choose Your Name, until you have one.
  - While You Were Away, newest first, with Clear All (takes rows off the list; messages stay unread in their chat):
    - a row per friend with unread messages (bird, name, last message, time with the count under it)
    - one for people waiting for you to add them (opens Invite Links)
    - one for each friend who added you in the last day ("Mika is your friend now")
  - Online Now: each online friend's bird with their name under it, opening your chat.
- With none of these, one light row: Invite Your First Friend (opens Add a Friend's Invite Links) while you have no friends, or a quiet "All caught up". The buddy list's No Friends Yet isn't repeated.
- On the Pocket the Messenger has no Add a Friend link under the list: the left soft key is Add Friend.

On the desktop the same list is behind a bell in the tray, which carries the count (`apps/messenger/notifications/`):

- It opens a flyout above the tray, Notifications with Clear All on a blue band.
- Escape, a click outside or opening a row closes it.

Message balloons:

- At most one every 10 seconds. What arrives meanwhile folds into one ("Mika and Ren: 3 new messages. Click to read.").
- None for a chat in front.
- None for a friend coming online: Today and the buddy list show it.

A chat's messages are panels (`ui/transcript/`), not lines of text. Yours sit on the right in Luna blue and theirs on the left in warm grey, each with the era's 1px frame, a white inner highlight and a hard 1px shadow and corners of 8px and 3px, never a pill, on a pale blue-grey chat area (the tokens `--pg-chat-area`, `--pg-grad-panel-own`, `--pg-grad-panel-friend`, `--pg-panel-own-border`, `--pg-panel-highlight` and `--pg-panel-shadow`, which the canvas doesn't have). A run is one sender's panels in a row; it ends at anything else in the chat, another sender, or ten quiet minutes. The friend's bird (32px) sits beside the last panel of their run, and a screen reader hears "Rook says:" once for the run. The time is small in the corner of the last panel of each minute, with the full date in its tooltip. A day line ("Today", "Yesterday", or the date) divides days, drawn as the etched rule of a group box with the words in it, and the lines for a buzz, a coming or going and the like are drawn the same way, centred. "Rook is writing a message..." is a faint italic panel of theirs.

A message of yours says how it's getting there with a mark in its panel's corner, bitmaps drawn whole and never scaled.

- Only the newest message of yours and any not yet received carry a mark, so a conversation settles into plain panels. A received one in the middle shows only its time.

| Mark             | Meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| two blue arrows  | sealing                                                                                |
| one grey tick    | Mailed: a Lighthouse took it (tooltip: "Left at Loft and Dovecote for when Jo's back") |
| two blue ticks   | Received                                                                               |
| warning triangle | no Lighthouse took it yet                                                              |

- The ticks are in `assets/brand/` as `tick-mailed` and `tick-received`.
- A screen reader hears the word after the message ("bring the sunset pic Mailed."). The mark itself is decoration.
- Two lines can sit under a panel, always shown:
  - "Waiting for Jo to be online", quiet, for a message with nowhere to be left.
  - In red, "Not mailed yet. Pigeon tries again at the next mail check." with a Try Again link.
- Try Again puts what's unsent to that friend at once:
  - "Trying to mail it..." while it runs, then the mark the message earned.
  - Or "Not mailed yet. No Lighthouse answered. Pigeon tries again at the next mail check." with Try Again again.
  - It tries only that friend's letters. The mail check still re-puts them by itself.
- Only "Not mailed yet" is red, and a failure always keeps its warning.

Received is said only when the friend has said so: a receipt for the letter that carried the message, or a sync of theirs that holds it (the `log-sync` each of their devices sends when it connects, whose summary says how far it has each author's entries; the chat keeps the highest it has been told, no higher than the chat held of that author when it was said, so a claim of more than there was never covers a message written after it). Staying connected for a few seconds, or being answered a sync, counts for what is mailed but not for this word. So a message that went straight to a friend who was online shows no mark, not even as the newest, until a later sync of theirs holds it. A message from one of your other devices can be received the same way.

Unread messages from a friend that came by letter are one panel when the chat opens: "Rook left 3 messages while you were away", with "By letter, through Loft", "Click to open", and a pixel-art airmail envelope (`letter-opening-32`, five 32px frames at 2x).

- Clicking plays the frames, stepped, about a second and a half in all (at once under reduced motion): the flap lifts and a sheet slides up.
- The panel folds away and the messages come in one after another as ordinary panels, under a small etched line with the 16px envelope: "3 messages by letter, through Loft" ("1 message" for one; every Lighthouse they came through is named).
- Accessibility:
  - The envelope is a button named "Open the letter from Rook, 3 messages by letter, through Loft", with `aria-expanded`.
  - The messages are in the page while it's shut, so a screen reader reads them in order without a click.
  - Opening moves focus to them.
- Once opened it stays open while that window is, even when an earlier message joins it. A letter arriving while the window is open shows opened, with no envelope.
- The next time the chat opens it has settled: ordinary panels, no envelope, no line.
- A run ends at anything that isn't a friend's message by letter: one of yours, one that came straight, a day line, a buzz, or a coming or going.
- Its row in While You Were Away says "By letter, through Loft".
- There's no Seal Letter. A message to an offline friend goes by letter by itself, and their chat's status bar says what you write waits at their Lighthouses.

The buddy list:

- Each friend's last message sits under their name (yours as "You: ..."), bold while unread, or "typing..." in green.
- A column at the row's end shows when the last message was ("21:03" today, "Mon" this week, "Nov 3" before), with the unread count as an orange badge under it, so a badge never moves the time.
- Friends with the latest chat come first in each group.
- Asked, Not Added Yet: people you asked through their invite link, with an empty dashed frame where their bird will be, until they add you. Opening one shows Add a Friend's Have an Invite? tab.
- When someone waits for you to add them, a strip above the list says so ("Sam asks to be friends", or how many) and opens Invite Links.
- With no friends and nobody asked, the list says No Friends Yet and why (there's no directory), with Make an Invite Link, Show a Quick Code and I Have an Invite, each opening Add a Friend on that tab. On the Pocket the two buttons share a row.

Checking for mail:

- Under Add a Friend: Check Now (a refresh icon, also on the Pocket), with a line saying when Pigeon last finished looking ("Looked for mail at 6:38 PM", or "Not looked for mail yet").
- Actions has Check for Mail Now.
- Check Now uses the same scheduler as a tab shown or a message sent, so it never runs beside another look or within 5 seconds of the last:
  - Pressed inside that gap, it waits out the rest, the bar says "Looking for mail in a moment...", and Check Now is greyed until done ("Looking for mail..." while it runs).
  - Pressed during a look, one more follows.

There's no sample conversation: everything in the Messenger is real.

Where it shows: `ui/avatar` draws a bird in a white display-picture frame, and the Messenger works out the traits (`avatarOf`, `apps/messenger/friend-avatar/`).

- Frames:
  - Every frame has the same rounded corners (`--pg-radius-avatar`, 4px).
  - The presence dot, 8px, sits on the frame's bottom-right corner, 2px past it: online (green), away (amber), busy (red) or offline (grey, with the bird greyed too).
- Buddy list: each friend's bird at 24px before their name, standing in for the presence figure, in line with your own in the band straight above it (no gap). Yours, with its own dot, takes the logo's place at the top.
- Rows take a light blue wash under the pointer, except on touch screens, where it would stick.
- Conversation: the friend's bird before its "To:" line, with how they're reached on the line below.
- Profile: 64px beside the facts, with its description as alt text and tooltip.
- Blocked People: each bird at 24px beside the name.
- Pigeon menu header: greets you by name beside your bird, as XP's did ("Pigeon" and the logo until you choose a name).
- Add a Friend:
  - The bird of whoever answered at 64px, centred on top (a message box's `picture`, at the top of the page on the Pocket), with the icon, name and fingerprint centred below it, never instead of it.
  - While waiting, both ends of the paper plane's path are framed alike (your bird and a placeholder for theirs), and the plane flies from yours to theirs.
- Pocket Today: a friend's bird on their While You Were Away row and at 64px in Online Now.
- Balloons: every balloon about a friend (online, a message, removed you) carries their bird. The icon sits on the left, with the title and the text under it beside the icon.
- Rendering: at 32px and its multiples a bird is drawn sharp, every pixel square. At other sizes (the list's 24px) it's drawn smoothly, so pixels blend instead of jumping unevenly.

The generated bird is the only avatar: nobody can wear someone else's face, and there is nothing to upload, store, sync or moderate. A bird is only about 32 bits, so anyone could grind keys until one matches, which is why it sits beside the fingerprint and never stands in for it.

Birds stay put:

- The traits an id gets are frozen per version: which digest byte each trait reads, how often it is worn, and every option list. New options make a version 2, with tables of their own; version 1 stays in the code. Tests pin the traits of twenty ids, so a change that would move somebody's bird fails.
- How a trait is drawn may improve at any time: a better flat cap is still a flat cap.
- `hello` carries the version a person's bird is drawn with (1 when left out), so a new version only reaches new people and those who ask for it. A version this Pigeon doesn't know yet is drawn as the newest one it does.

The art is drawn for Pigeon in code; it copies no one's, including Pigeon's own logo.

## Network

Network (`apps/network/`, a desktop icon and in the Pigeon menu's tools) is how this Pigeon connects, kept out of Display Properties, which is about the display alone.

On the desktop it has two tabs.

Lighthouses lists where friends leave mail for you:

- Each row: a 22px server icon (faded when not answering or off), the name in bold, an Official label on official ones, host and fingerprint.
- A status line in green or red ("Answering. Says it runs pigeon-lighthouse 0.7.1.", "Not answering. Mail is still left at the others."), checked when Network opens and every minute while open.
- One you added has Remove. An official one has Disable and Enable instead, since finding its address again would be hard, and stays listed while off ("Turned off: friends don't leave your mail here.").
- The last one on can't be removed or turned off.
- A line under the list says what each says it runs is its own word, and its key is what's checked.
- Add a Lighthouse takes an address (`pigeon://lighthouse/...`) beside an Add button, and adds it only once it answers as the key in it.
- What a Lighthouse sees says plainly what it can and can't learn.

Connection holds Always go through the relay, and Right now: relays reachable, friends connected, Lighthouses answering.

On the Pocket it's one page:

- the Lighthouses with a 32px icon, a short status, and a 44px remove key or Disable and Enable
- the address and a full-width Add Lighthouse
- the relay setting
- What a Lighthouse sees, opening in place
