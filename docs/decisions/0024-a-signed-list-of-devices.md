# 0024: A signed list of devices

One person can use Pigeon on several devices: each device keeps its own key, and a signed log of devices ties them to one identity.

- Status: proposed; accepted when M13 starts
- Date: 2026-11-24

## Context

People want the same Pigeon on a phone, a laptop and a desktop. Today a `PeerId` is one browser's signing key, made non-extractable so not even the page can read it, and clearing site data is a new identity. Copying the key isn't possible, and wouldn't work anyway: chat logs number each author's entries 1, 2, 3..., the first entry seen for a sequence wins, so two devices writing as the same author would lose messages. M7 will seal invites and letters to "your" key and M8 builds spaces on authors, so the answer has to be settled before either assumes one key is one person.

## Decision

- Every device makes its own non-extractable signing and sealing keys, as a browser does now.
- An identity is a signed append-only log of devices, kept like the other logs ([0003](0003-signed-append-only-logs-not-yjs.md)): `device-add` and `device-remove` entries, each signed by a device already on it. The first device's key starts the log and stays the identity's `PeerId`, so nothing a friend knows you by changes, and the identity outlives that device.
- Envelopes and log entries are signed by a device. A friend accepts them from any device on your current list, and log authors are devices, so sequence numbers never collide. Friends see one friend; presence shows one status.
- Friends fetch your device log in your pair room and keep it with you. A removed device is refused from the moment they have the removal.
- Linking is done in person, like pairing: an existing device shows a QR code, the new one scans it, both show the same short code, and you confirm on the existing device. When you already have two or more devices, adding another also needs a confirmation on a second one, so a stolen device can't add more by itself. Any device can remove another.
- Sealed things (M7 invites, letters) are sealed to every device on the list, so whichever comes online first can open them.
- Your own data (friends, petnames, blocks, mutes, settings) syncs in a self space only your devices are in, once M8 adds spaces. Until then a new device gets the friends list while it's being linked and catches chats up from its pair rooms. Devices that are never online together pass sealed sync bundles through the M7 mailbox.

## Consequences

The same Pigeon on every device without a server holding keys, and the identity survives losing its first device. Friends learn how many devices you have and which one is connected, since connections are per device. A removed or stolen device keeps the history it already had; nothing can erase that remotely. Losing every device is still a new identity: an encrypted recovery file is ruled out here and would need its own decision. Envelopes, logs and sealing all grow a device layer, which is why this lands as M13, before M7.
