# 0052: File passphrases stretched with Argon2id

A passphrase that seals a file (Your Data, the recovery key's file) is stretched with Argon2id from RustCrypto's `argon2` crate, built into the Rust crate; PBKDF2 stays only to open files made before.

- Status: accepted
- Date: 2026-11-26

## Context

A sealed file is attacked offline: whoever finds a copy can try passphrases at their leisure, on hardware of their choosing. The file's key came from PBKDF2-SHA256 at 600,000 rounds, which uses almost no memory, so a GPU or ASIC runs thousands of guesses side by side. Argon2id (RFC 9106) fills a large block of memory and reads it back in a data-dependent order, so each guess needs memory as well as time, and the parallelism an attacker has is bounded by their memory, not their cores. It is the construction RFC 9106 and OWASP recommend for passwords and passphrases.

WebCrypto has no Argon2. JavaScript libraries for it are small and little reviewed. RustCrypto's `argon2` is maintained, widely used, and the crate that already builds to WebAssembly here (0041) takes protocols from libraries like it. Pigeon's own stretching would be a new construction.

A key derived from a passphrase lives for one seal or one open: it goes into a non-extractable WebCrypto key and is wiped, so deriving it in WebAssembly doesn't move a long-lived key out of WebCrypto.

## Decision

- **The `argon2` crate, version 0.6.0 (August 2026), with only `alloc` on.** It adds `blake2` and `base64ct` and a few crates under them, and no randomness or threads. The crate's allocator wipes the memory Argon2 fills when it is freed, and `scrubStack` wipes the stack after the call, as for SPAKE2. Core declares `Argon2id` (`derive(passphrase, salt, params)` gives 32 bytes) and the crate stays a thin wrapper: no format, no limits, no choice of parameters in Rust.
- **New files are `pigeon-sealed:v2`.** The line carries memory (KiB), passes and lanes in the clear, then the 16-byte salt, the 12-byte iv and the AES-256-GCM ciphertext. The exact encoding, with one spelling for every number and byte string, is in protocol.md.
- **Parameters: 64 MiB, 3 passes, 4 lanes**, RFC 9106's second recommended option (its first, 2 GiB, is beyond a phone's tab). It was measured in the WebAssembly build: about 0.4 s on a desktop (the first call, which includes loading the module), and about 1.3 s with Chromium's CPU throttled six-fold, which stands in for a phone. OWASP's smaller options (19 MiB with 2 passes, 46 MiB with 1) would be quicker but weigh less per guess; the work is the same however many lanes there are, since they run one after another, so the RFC's lanes cost nothing here. The module's memory doesn't shrink once grown, so the page holds about 65 MiB until the tab is reloaded or closed. Opening a file written at the largest parameters a reader accepts (128 MiB, 6 passes) after sealing one at Pigeon's own can leave about 193 MiB resident for the same time: the allocator can't reuse a freed 64 MiB block for a 128 MiB one, so the module grows again. It was measured and judged tolerable, since only a file made on purpose asks for it.
- **A file's parameters are bounded when it is read**, before anything is derived: at most 128 MiB, 6 passes and 4 lanes (about twice the memory and four times the work Pigeon writes; 4 s with the same throttle), at least 8 KiB per lane, no zero, nothing but plain decimal digits, and the field counts and byte lengths exact. A hostile file can ask for no more than that, and a line that can't be a sealed file (a ciphertext shorter than its tag) is refused before it costs the memory.
- **Files from before still open.** A `pigeon-sealed:v1` line is stretched with PBKDF2 in WebCrypto as before, with the same limit on its rounds, and without loading the module. Nothing writes version 1 any more. A version 1 file stays as strong as it was, no stronger; saving a new copy moves it onto Argon2id.
- **The key's wiping in JavaScript is best effort.** The 32 bytes come back as a `Uint8Array`, are imported into a non-extractable key, and are overwritten; the engine may have copied them meanwhile. The passphrase's bytes are overwritten the same way. A passphrase is short-lived and a person's own, unlike an identity or device key, which never leave WebCrypto.
- **Argon2id runs on the main thread**, as SPAKE2 does, so a seal or an open holds the page for about the time above. A worker would stop that and is left for later.

## Consequences

A stolen export or recovery file costs a GPU far more per guess than before, which matters most for the recovery file: it holds the key that outranks every device. Weak passphrases are still weak (the minimum stays 8 characters); this raises the price of each guess, not the quality of what people choose.

Sealing or opening takes about a second on a phone and needs about 65 MiB; on a device with no room, Pigeon says it couldn't work with the passphrase there and leaves the file alone, which is not mistaken for a wrong passphrase. An older Pigeon can't open a version 2 file; the file says which version it is, and a newer Pigeon opens both. Exporting again after updating moves a file onto Argon2id.

This supersedes the PBKDF2 parts of [0027](0027-a-recovery-key-that-outranks-devices.md) and [0029](0029-your-data-in-a-file-for-your-own-devices.md): the recovery key's file and the data file are stretched with Argon2id, as above, and neither is "all WebCrypto, no new dependency" any more.

Ruled out:
- **A JavaScript Argon2 library**: less reviewed than RustCrypto's, and a new construction of its own would be worse.
- **scrypt**: also memory-hard, but RFC 9106 and OWASP put Argon2id first, and WebCrypto doesn't have scrypt either, so it would need a library all the same.
- **Raising PBKDF2's rounds**: no memory cost, so GPUs keep their advantage.
- **Binding the header into AES-GCM's associated data**: the salt and every parameter already go into the key, and the iv and ciphertext are authenticated by GCM, so a changed header opens nothing.
