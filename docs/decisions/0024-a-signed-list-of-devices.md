# 0024: A signed list of devices

One person can use Pigeon on several devices: each device keeps its own key, and a signed log of devices ties them to one identity.

- Status: accepted
- Date: 2026-11-24

## Context

People want the same Pigeon on a phone, a laptop and a desktop. Today a `PeerId` is one browser's signing key, made non-extractable so not even the page can read it, and clearing site data is a new identity. Copying the key isn't possible, and wouldn't work anyway: chat logs number each author's entries 1, 2, 3..., the first entry seen for a sequence wins, so two devices writing as the same author would lose messages. M7 will seal invites and letters to "your" key and M8 builds spaces on authors, so the answer has to be settled before either assumes one key is one person.

## Decision

- Every device makes its own non-extractable signing and sealing keys, as a browser does now.
- An identity is a signed append-only log of devices: `add`, `remove` and `name` entries, each naming the signature of the one before. The first device's key starts the log and stays the identity's `PeerId`, so nothing a friend knows you by changes.
- Only the first device writes the log. It links new devices and removes lost ones; no other device can change the list, stolen or not. With one writer the log is a single chain: there are no forks to settle, a copy further along the same chain replaces a shorter one, and a removal is final.
- Envelopes and log entries are signed by a device. A friend accepts them from any device on your current list, and log authors are devices, so sequence numbers never collide. Friends see one friend; presence shows one status.
- Friends fetch your device log in your pair room and keep it with you. A removed device is refused from the moment they have the removal. Your own devices also meet in a self room, named and locked like a pair room ([0026](0026-pair-rooms-from-a-shared-secret.md)) from a self secret every device gets when it's linked, so a removal reaches them even with no friend online; it carries device logs only, until M8's self space.
- Linking is done in person, like pairing: the first device shows a QR code, the new one scans it, both show the same short code, and you confirm on the first device.
- Sealed things (M7 invites, letters) are sealed to every device on the list, so whichever comes online first can open them.
- Your own data (friends, petnames, blocks, mutes, settings) syncs in a self space only your devices are in, once M8 adds spaces. Until then a new device gets the friends list while it's being linked and catches chats up from its pair rooms. Devices that are never online together pass sealed sync bundles through the M7 mailbox.

This was first written letting any device add, approve and remove, with a second device's approval for a third. Three reviews of M13 each broke a version of that: with no server to say which came first, a stolen device could always find an order of changes in which it kept the identity, or lock a removal out. One writer leaves nothing to race. Letting other devices manage the list, and handing the first device's role to another, are on the roadmap for later decisions.

## Consequences

The same Pigeon on every device without a server holding keys, and a stolen second device can't touch the list: the first device removes it, and that's final. The first device is the one to keep safe. If it's lost, your other devices go on working but the list can't change, so no device can be added or removed; if it's stolen, whoever has it manages your devices. Friends learn how many devices you have and which one is connected, since connections are per device. A removed or stolen device keeps the history it already had; nothing can erase that remotely. Losing every device is still a new identity: an encrypted recovery file is ruled out here and would need its own decision. A removed device keeps the pair secrets it was given (they aren't changed after a removal), so it can still join pair rooms and be greeted, though nobody takes anything from it. Its messages from before the removal still count, by their own time, which it could backdate. One you've removed can still make new friends who've only seen its old list. Presence trusts the sender's clock. Anyone who sees a link code can take its one request, though the 6-digit check stops them getting in. Everything a new device is handed must fit one 64 KB envelope, a few hundred friends and blocks; more is refused before anything changes. Envelopes, logs and sealing all grow a device layer, which is why this lands as M13, before M7.
