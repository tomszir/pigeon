# 0029: Your data in a file, for your own devices

Export My Data seals your friends, chats and settings with a passphrase, and Import My Data merges such a file into a device of the same identity, keeping what that device already has.

- Status: accepted; superseded in part by [0052](0052-file-passphrases-through-argon2id.md): files are sealed with Argon2id, not PBKDF2
- Date: 2026-11-25

## Context

M13 lets a new device take your friends when it's linked, but only while both devices are in the room together, and only what fits one envelope. Devices that are never online together, a recovered device ([0027](0027-a-recovery-key-that-outranks-devices.md)), and anyone who wants a copy of their chats need a file. A file holds pair secrets, which let whoever has them into your pair rooms, so it has to be sealed, and it must not hand your friends to someone who isn't you.

## Decision

- **What's in it.** Friends with their pair secrets, petnames and mutes; blocked people; each chat's signed log; friends' device logs; your profile and settings. It holds no keys, since a device's key never leaves its browser, and nothing else about your own devices: no device log, no self secret.
- **Sealed with a passphrase.** At least 8 characters, typed twice. It's stretched with PBKDF2-SHA256 at 600,000 rounds into an AES-256-GCM key, the same as the recovery key's file, using WebCrypto with no new dependency. The file is a `.txt` with a few lines saying what it is, then one sealed line.
- **Only your own devices import it.** A file names the identity it came from. A device of any other identity refuses it, so a stranger's Pigeon can't take your friends list under its own key.
- **Import merges.** Chats merge entry by entry, checked as a catch-up checks them. Friends and blocked people this device lacks are added, and where both have one, this device's copy stays. A friend blocked here isn't brought back. The profile and settings come in only when this device has no name yet, as on a recovered device. The Messenger then starts again with what came in.

## Consequences

A recovered device can get everything back at once, without pairing with each friend again, and a device can catch up on chats from another it never meets. The file is as sensitive as your pair secrets: with the passphrase, it lets someone into your pair rooms and read the history it holds. Their messages still aren't yours, since they'd need a device key. Forget the passphrase and the file is useless. The file isn't kept in step: it's what you had when you saved it. Import never removes anything, so a friend removed after the export comes back if this device still had them. Merging a big file happens all at once, with the Messenger paused until it starts again.
