# 0036: Your name on all your devices

Your devices keep your name and personal message in step through the self room, and the newest change wins.

- Status: accepted
- Date: 2026-11-25

## Context

[0024](0024-a-signed-list-of-devices.md) copies your profile to a device when it's linked and leaves keeping it in step to M8's self space. M8 is many milestones away, and in the meantime changing your name on one device leaves the others saying the old one. Friends see whichever name the device they last heard from has, so your name changes back and forth for them too. Your devices already meet in the self room, where only your own devices are let in.

## Decision

- **A `profile` message in the self room.** It holds your name, your personal message and `changedAt`, the time either was last changed on the device that changed it. It's sent after `hello` and again on each change, and only in the self room, never to friends.
- **The newest change wins.** A device takes a `profile` whose `changedAt` is later than its own, tells its friends the new name, and keeps the time with it. A change made on a device is stamped later than any it has seen, even if its clock is behind. A `changedAt` more than a day ahead of the receiving device's clock is ignored, so one device can't stamp a time that outranks every later change. A device that's linked forgets its own old time and takes the first profile it hears.
- **Status stays each device's own.** Online, away and busy describe the device you're at, so they aren't synced; presence already shows friends the newest one sent.
- **Only the name and message.** Settings, petnames, blocks and mutes still wait for M8.

## Consequences

Changing your name or personal message on any device reaches the others the next time they're in the self room together, and friends hear it from each. Two changes made apart are settled by the devices' clocks, so a device whose clock runs fast wins a close race; that's harmless for a name. A device that's never online with the one that changed it keeps the old name until it is. Devices on a Pigeon from before this ignore `profile`, as they ignore any message they don't know, and neither send nor take it. A name set before this has no time, so nothing is sent until one of your devices changes it.
