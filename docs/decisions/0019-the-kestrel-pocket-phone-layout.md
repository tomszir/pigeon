# 0019: The Kestrel Pocket phone layout

On a phone Pigeon runs on a made-up 2003 handheld, the Kestrel Pocket, whose screen fills the phone, instead of a bare program switcher.

- Status: accepted
- Date: 2026-11-24

## Context

The desktop needs at least 1024×640 ([0012](0012-crt-monitor-and-resolutions.md)); below that the phone layout showed one program with a plain bar of program buttons, with no desktop, wallpaper, windows or CRT, and none of the world's charm. Shrinking the desktop onto a phone would leave 11px text and 21px buttons too small to read or tap, and a phone's on-screen keyboard covers half the screen.

## Decision

- The phone shows a matte black handheld with a slim 6px frame and a 4px bezel; the screen fills the rest. It is sized in CSS pixels to whatever the phone has, not at a whole-number scale of a fixed resolution: the phone layout is the one place that gives up [0008](0008-pixel-exact-1024x768-stage.md)'s exact pixels, for the sake of using the whole screen.
- Soft keys, as on a 2003 smartphone, replace the switcher: a strip in the taskbar's blue along the screen's bottom edge names what two raised hardware keys below it do (rounded squares running to the screen's edges under their words, drawn to their real width and hollowed around the home key with a 7px gap, a moulded dash, a lip they sink onto when pressed), and a round key between them with a moulded house goes home to Today. The left soft key changes with the screen (Messenger on Today, Add Friend in the buddy list, Friends in a conversation or Add a Friend); the right one opens the Pigeon menu and reads Close while it's open. The words on screen can be tapped too. A row of labelled tabs was tried first and read as a modern website. The Pigeon menu rises from the bottom right, over the right soft key; Letters lives there.
- The screen starts on Today: a greeting over the wallpaper, then rows for your name, friends online, new messages and your live invite code.
- One program fills the screen under a blue title bar with a 44px close button. Whatever comes to the front closes the windows behind it, and Today closes them all; chats and friends live in the Messenger, not in its windows.
- An LCD look stands in for the CRT: a faint pixel grid and a backlight falloff, no filter, so nothing is softened. Settings on the phone offers only what applies there: the LCD effect and the buzz, no resolution, monitor or pixel mode.
- A buzz vibrates the phone where the browser allows it (`navigator.vibrate`, not on iPhones); otherwise the screen shakes, or its title bar flashes when motion is reduced or vibrating is turned off.
- Touch: the screen raises the size tokens (body text 13px, messages 14px, buttons, fields, menu and list rows 44px, and `--pg-touch-target` for anything else tapped). Controls that arrange themselves differently for a finger read `ui/layout`'s context: message boxes become a page with the text centred and full-width buttons along the bottom, Add a Friend stacks into one column, the buddy list's tasks and group headings become full-width rows, check boxes grow to a 20px box in a 44px row whose label and description toggle it, and one tap opens a contact.
- Keyboard: on a touch screen a focused text field means the keyboard is up. The keys step aside, the screen is sized to the visual viewport so the field and its buttons stay above the keyboard, notices wait, and tapping a button keeps the field focused so sending doesn't close the keyboard. Keys, menu and screens move focus as the eye does: a new screen takes focus, the menu opens on its first item, arrows move through it, and Escape returns to the right soft key.

## Consequences

Pigeon looks like itself on a phone and stays usable one-handed. The phone layout is a second shell to keep working: a new kind of window must look right full-screen at touch sizes, and controls that only grew through tokens may need a phone arrangement. Exact pixels on phones are given up. The keyboard heuristic needs a touch screen; a phone with a hardware keyboard keeps its keys.
