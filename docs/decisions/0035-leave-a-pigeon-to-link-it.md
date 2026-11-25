# 0035: Leave a Pigeon to link it to another

A Pigeon that already has friends or devices of its own can be linked to another one by leaving it first: its friends are told, everything in the browser is forgotten, and the link goes ahead.

- Status: accepted
- Date: 2026-11-25

## Context

Linking only takes a Pigeon with nobody on it ([0024](0024-a-signed-list-of-devices.md)), since it becomes the other identity. Someone who started Pigeon on a phone and on a computer separately, and made friends on both, has two first devices and no way to link them. Clearing site data by hand works but leaves their friends with a contact who has silently gone. Merging the two, so the friends move across without pairing again, would need a new signed message from the old key and its own review; it isn't done here.

## Decision

- **Offered where linking refuses.** The Messenger's File menu has Link to My Other Device... on every running Pigeon now, not only an empty one. When it, or a link or QR code opened in the address bar, finds friends or devices here, it says so and offers Leave This Pigeon and Link..., which asks again. A recovered Pigeon still waiting for its list ([0030](0030-the-recovery-key-beside-the-chain.md)) is never offered it, since leaving would lose the recovery.
- **Friends are told, when this is the only device.** Every friend is removed as removing them one by one does ([0023](0023-removing-a-friend-tells-them.md)), and Pigeon waits up to 10 seconds for the ones online to hear it. The rest aren't told: their farewells are forgotten with everything else. When the identity is on other devices too, or a copy of this one has been heard in another browser ([0028](0028-one-tab-and-copied-profiles.md)), those keep it and its friends, so nobody is told.
- **Only the tab running Pigeon forgets it.** If Pigeon moves to another tab while leaving, it stops telling friends and nothing is cleared, since the store is now that tab's; once clearing has begun, the other tab waits for it to finish.
- **Never for this Pigeon's own code.** A code or link that is this Pigeon's own (the one it's showing, or its fingerprint in the link) is refused before leaving is offered.
- **Then everything goes.** As Make This a New Device does ([0028](0028-one-tab-and-copied-profiles.md)), the browser's store is cleared, key included, and Pigeon starts again with a new device key. It keeps the code it was given across the restart and links to it straight away.

## Consequences

The code is tried only after this Pigeon is forgotten, since a link code takes one request and checking it first would use it up: a mistyped or lapsed code, or a link from someone else, leaves you with an empty Pigeon to link again with a new code, and the confirmation says to check it. Two Pigeons become one in a minute, at the cost of the one you leave: its chats are gone, and friends only it had are added again from the one you keep. An export of it can't be imported into the other ([0029](0029-your-data-in-a-file-for-your-own-devices.md)), since files go only to their own identity. Friends who were offline see the left Pigeon go quiet and stay on their list until they remove it. Leaving a first device that has other devices leaves those with nobody to change their list, unless its recovery key moves that job; the confirmation doesn't say so. A linked device that leaves stays on its identity's list until the first device removes it. A copied profile that never met its copy online can't tell it's one, so leaving it tells the friends the identity left while the other copy goes on using it: Make This a New Device is the way out for a copy. Where the browser won't let Pigeon store anything, the code is lost in the restart and has to be typed again.
