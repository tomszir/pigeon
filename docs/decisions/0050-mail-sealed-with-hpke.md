# 0050: Mail sealed with HPKE

Each device's wrap in a mail blob is sealed with RFC 9180 HPKE from `@hpke/core`, to the device's existing P-256 sealing key, with the kind of mail in HPKE's info; the older wrap stays for devices that haven't said they open HPKE, and no post-quantum KEM is added yet.

- Status: accepted
- Date: 2026-11-26

## Context

Mail is sealed once with a random content key, and the content key is wrapped for each recipient device. The wrap was Pigeon's own: ECDH P-256 from a fresh key, HKDF-SHA256 over the shared secret with both public keys in the info, and AES-256-GCM. That is HPKE's DHKEM and key schedule in all but name, without the review, the test vectors or the analysis HPKE has. Everything that goes to a device's sealing key goes through this one wrap: letters, receipts, farewells, self mail, invite requests and answers, `mail:rekey`, and a live code's answer (the pair secret, or a new device's link bundle).

What constrained it:

- A device's sealing key is a non-extractable WebCrypto ECDH P-256 key, and long-lived keys stay that way. The library has to open with that key without ever reading its private half.
- Pigeons from before the change are still running, and will be for a while. They open only the older blob, and they ignore fields they don't know.
- Mail lives at most 30 days at a Lighthouse.
- Any new dependency is asked for first. `@hpke/core` is a maintained HPKE implementation on WebCrypto with no dependencies beyond its own `@hpke/common`, checked against RFC 9180's test vectors, and the maintainer approved it.

## Decision

### The suite and the blob

- **One suite: base mode, DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM.** P-256 because a device's existing sealing key is the HPKE key, so nothing new is generated or announced. Base mode because a letter is signed inside; HPKE's auth mode would only repeat that, with a key that isn't the signing key.
- **HPKE seals the wraps, not the letter.** The letter is sealed once under a random content key, AES-256-GCM, as before, and each wrap is HPKE's single-shot seal of the content key and that device's drop value to one device's key. The blob is `{ v: 2, wraps: [{ e, w }], commit, content }`: `e` is HPKE's encapsulated key (an uncompressed 65-byte point), `w` its ciphertext.
- **The commitment stays.** AES-GCM doesn't commit to its key, so a sender could otherwise give different devices different content keys that open the same content to different letters. `commit` is HKDF of the content key, which every device checks before opening the letter.
- **HPKE's info is `pigeon/mail/v2/<kind>`**, so a wrap made for one kind of mail doesn't open as another: a link bundle can't be passed off as a letter, nor a receipt as a farewell. The opener tries each kind the mailbox it fetched from holds (at most four), and the letter inside must be of the kind its wrap opened as. The kind stays out of the blob, since a Lighthouse would learn it.
- **HPKE's aad is the blob's commitment**, so a wrap opens only beside the letter it was made for.

### Which form a device gets

- **A device says it opens HPKE with a second signature on its sealing key**: `hpke`, signed by the device over `{ v: "pigeon/sealing-key/hpke/v1", device, key }`. The first signature, over `{ v: "pigeon/sealing-key/v1", device, key }`, is unchanged, so a Pigeon from before still checks the key as it did, and ignores the field. A claim that doesn't hold makes the whole key refused, never quietly dropped.
- **A blob is `v: 2` only when every device it's sealed to makes the claim.** Otherwise it's the older `v: 1`, which every Pigeon opens. One blob holds one form, so it says nothing about which devices are newer.
- **The newer claim sticks.** A Pigeon from before passes on keys as it kept them, so a copy of the same key without the claim can arrive after one with it. It doesn't undo the claim, which the device signed about that very key; a new key is always taken as it comes.
- **Every device opens both forms.** The older wrap is still read until no supported Pigeon seals it; its removal is a change of its own, made once Pigeons from before HPKE are gone and 30 days have passed for their mail to expire.

Stripping the claim from a key in transit only makes a sender use the older form, which is no weaker than every blob was before this. Adding one takes the device's signature.

### Not now: a post-quantum KEM

A hybrid KEM (ML-KEM-768 with P-256, rather than X-Wing, so the P-256 keys carry over) is not added in this change. WebCrypto doesn't offer ML-KEM across the browsers Pigeon supports, so a device's ML-KEM private key would have to live in JavaScript or WebAssembly memory, which long-lived keys may not; and it would be another dependency. The format leaves room: a hybrid suite would be a new blob version and a new claim on the sealing key, sealed only to devices that make it, the same way `v: 2` is introduced here.

## Consequences

- The wrap is a standard construction with published test vectors, which a test opens with a non-extractable WebCrypto key.
- `SealCrypto` gains `hpkeSeal` and `Sealer` `hpkeOpen`; the platform implements them with `@hpke/core`, handing it the key pair so it never asks for the private half.
- Opening a `v: 2` blob not meant for this device costs up to one HPKE decapsulation per wrap and kind, at most 64 wraps times four kinds, where the older form cost one ECDH per wrap.
- Until every Pigeon is updated, much mail is still sealed in the older form, and it stays readable by every device.
- Mail has no forward secrecy and isn't post-quantum, as before: whoever keeps a blob and later holds a device's key, or a quantum computer, can open it.
- Invite cards are unchanged: they're sealed under the link's secret, not to a device's key, so there is no KEM to replace.
