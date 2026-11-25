# 0028: One tab, and noticing a copied profile

Pigeon runs in one tab of a browser at a time, and a device that hears its own key from another run of Pigeon says it's open somewhere else and offers to become a new device.

- Status: accepted; the second tab's balloon is now a screen over the whole desktop with the same offer ([design.md](../design.md#devices))
- Date: 2026-11-25

## Context

A device's key is non-extractable, but copying a whole browser profile (a backup restored, a profile folder synced to another computer) copies it anyway. Two Pigeons then hold the same device key, in the same rooms. Friends can't tell them apart, and if the key is a first device's, both can sign the device log (0024 assumes one writer), so the copies could fork it. Nothing can stop the copy, but Pigeon can notice it. Two tabs of one browser look exactly the same from outside, though, and today nothing stops a second tab.

## Decision

- **One tab at a time.** A tab runs the Messenger only while it holds the Web Lock `pigeon-messenger`. A second tab says "Pigeon is open in another tab", with a balloon that offers to use it there instead. Choosing it asks the first tab over the BroadcastChannel `pigeon-tabs` to let go. That tab stops its Messenger, says Pigeon moved, and can take it back the same way. Where the browser has no Web Locks, every tab runs, as before.
- **Every run has an id.** Each start of the Messenger makes 10 random bytes, sent as `instance` (base32) in every `hello`. A hello signed by this device's own key with another `instance` means the key is open in another browser too. With one tab per browser, that is a copied profile and never a second tab.
- **Say so, and offer the fix.** The device says "This Pigeon is also open somewhere else" in a balloon, once per run, and in My Devices. My Devices offers Make This a New Device..., which asks again, then forgets everything in this browser (key, friends and chats alike) and opens Link to My Other Device, so the copy you keep links it as a device of its own. Pigeon can't know which copy is the original, so you choose.

## Consequences

A copied profile is noticed the first time both copies are in a room together, which is a pair room with any friend who's online, or the self room. Two copies that are never online together aren't noticed, and a first device's two copies can still fork its device log until one is made new. Making a copy new wipes its chats, so the warning says so. The copy you keep still holds everything. A tab opened while another has Pigeon shows nothing until you move Pigeon to it, and windows the old tab had open stay on screen without a Messenger behind them. Older Pigeons ignore `instance`, so they're never flagged as copies and never flag one.
