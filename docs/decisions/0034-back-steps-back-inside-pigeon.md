# 0034: Back steps back inside Pigeon

The browser's own Back, a phone's back gesture or key included, steps back through Pigeon while there's something to step back from, and leaves the site once there isn't.

- Status: accepted
- Date: 2026-11-25

## Context

Pigeon is one page with no router (stack.md), so the browser's history held a single entry. Back, which phones put under a thumb, left Pigeon at once, from the middle of a page in Explorer or a window on the Kestrel Pocket ([0019](0019-the-kestrel-pocket-phone-layout.md)). Phone apps go back a screen, and Explorer, a browser itself, has a history of its own that Back ignored. Changing the address for each step would have been a router, and it would have clashed with invite links, which arrive in the address (`#i/`, `#l/`) and are taken out of it.

## Decision

- **A back stack.** Anything you can step back from adds an entry while it's open, and each entry adds one entry to the browser's history, at the same address, marked with its depth in `history.state`. The browser's Back takes the newest entry off and runs it. With none left, Back leaves Pigeon as it always did. Pigeon never traps you.
- **What adds an entry.** Every page Explorer opens, beyond the first; going to the page already showing adds none. An open menu: the Pigeon menu and a window's menu bar. On the Pocket, the window in front, whose step closes it to Today. On the desktop, windows add none, since with several open, Back closing one would be a surprise. Asleep (the screen saver, or the Pocket's standby), Back wakes Pigeon, so nothing is closed behind the screen.
- **Closing something another way takes its step with it.** Tapping ×, choosing a menu item, Explorer's own Back button or the Pocket's Home key marks the entry done. Done entries at the top leave the browser's history again (`history.go`), and one left below a newer entry is passed over in the same press of Back. Explorer's Back and the browser's are one and the same, and Forward in Explorer's toolbar adds the step again.
- **History moves are asynchronous.** While a move of Pigeon's own is on its way, new entries wait and are added when it lands. That way one window replacing another on the Pocket is still one step.
- **Forward isn't mirrored.** The browser's Forward is taken back at once. What Back closed stays closed, since a closed window can't be opened again exactly as it was.
- **Entries Pigeon didn't mark** stand in the stack like done entries and are passed on the way down, out of Pigeon if nothing is under them. These come from opening an invite link in a tab where Pigeon is already open, and from entries left from before a reload. Taking an invite out of the address keeps the entry's state.
- **The logic is pure** (`packages/core/src/back/`), with the browser's history behind a small port (`platform/back/`), and reached through a Solid context (`ui/back/`).

## Consequences

Back works the way a phone app's does, and Explorer behaves like a browser. Pigeon's addresses don't change, so a reload still opens the desktop and invite links work as before. Explorer's pages aren't in the address, so a reload or a shared link doesn't reopen one; that would be its own decision, and it would have to live beside the invite links. A press of Back while one of Pigeon's own moves is landing counts as that move, and two presses of Forward in quick succession can leave the browser a step ahead, which the next Back answers correctly. Dialogs that are windows (message boxes, Add a Friend) step back only on the Pocket, as windows.
