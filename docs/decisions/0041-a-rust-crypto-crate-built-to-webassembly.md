# 0041: A Rust crypto crate, built to WebAssembly, for protocols with no maintained JavaScript implementation

Pigeon adds one narrow Rust crate, `packages/crypto-wasm`, built to WebAssembly with wasm-pack, for cryptographic protocols that have maintained, widely used Rust implementations and nothing comparable in JavaScript. Its first protocol is SPAKE2 from RustCrypto's `spake2` crate.

- Status: accepted
- Date: 2026-11-26

## Context

Pigeon's crypto so far is WebCrypto: Ed25519 or ECDSA signatures, ECDH, HKDF, HMAC and AES-GCM, with long-lived keys kept as non-extractable `CryptoKey`s. WebCrypto has no password-authenticated key exchange (PAKE), no double ratchet and no MLS. A PAKE lets two people who share a password, even a short one, agree on a strong key, with each guess costing an attacker a live exchange; forward secrecy and groups would want a ratchet (vodozemac) or MLS (OpenMLS).

For a PAKE, JavaScript offers small single-author packages with little review. Rust has RustCrypto's `spake2`, a maintained implementation of the SPAKE2 the Magic Wormhole protocol uses, interoperable with python-spake2 and the one magic-wormhole.rs uses. Writing Pigeon's own PAKE over a JavaScript curve library would be a new construction, which the project avoids when a standard, reviewed one exists.

Running Rust in the browser means WebAssembly: a second toolchain beside Node, TypeScript and pnpm, and a module the site's Content Security Policy has to allow.

## Decision

- One crate, `packages/crypto-wasm/crate` (`pigeon-crypto`), holds only protocols taken from maintained, reviewed Rust libraries, each behind a small interface `@pigeon/core` declares, as it declares `Crypto` for WebCrypto. The crate never grows Pigeon's own protocol logic, and nothing else in Pigeon moves to Rust: core stays TypeScript, the Lighthouses stay Node and Workers.
- The crate holds short-lived or session secrets only, such as a PAKE password and the session built from it. Identity, device and sealing keys stay non-extractable in WebCrypto and never enter WebAssembly memory. The crate's global allocator wipes every block as it is freed, which covers the buffers wasm-bindgen copies secrets into and the state the `spake2` crate keeps without wiping. A session is freed as soon as it finishes or is abandoned, and after every call that handled a secret the TypeScript side has the module overwrite the stack its frames used (`scrubStack`), where the compiler leaves copies the allocator never sees. On the web, getrandom stages random bytes in a JavaScript array it keeps for the page; after a session draws its secret scalar, the crate draws a full array of throwaway bytes so the seed doesn't stay there.
- SPAKE2 is the asymmetric form on the Ed25519 group (`Spake2::start_a` and `start_b`): the two parties take sides A and B, and both identities are in the key. A peer's point is accepted in any encoding the library decodes (a non-canonical one, or a point of small order, included): the key hashes the raw message bytes, so an odd encoding only gives a key the other side doesn't share, which confirming the key shows. Core sees it as `Pake`: `start(role, password, idA, idB)` gives a message, a one-use `finish(peer)` that returns the 32-byte key, or undefined for a malformed message, and `abandon()` for an exchange that won't finish.
- The toolchain comes from mise, pinned: Rust with the `wasm32-unknown-unknown` target, rustfmt and Clippy; wasm-pack; and the wasm-bindgen CLI at the crate's wasm-bindgen version. wasm-pack runs with `--mode no-install` and `--no-opt`, so a build downloads nothing beyond Cargo's locked crates. `mise run check` runs `cargo fmt --check`, Clippy with warnings as errors (for the host and for WebAssembly), `cargo test` and the wrapper's Vitest tests.
- The built module isn't committed. `pnpm build` and `pnpm dev` in `apps/web` build it first, and Vite emits it and its glue as separate files that load the first time an exchange starts.
- The site's policy adds `'wasm-unsafe-eval'` to `script-src`, which lets the page compile WebAssembly and still allows no JavaScript `eval`. Only the site's own module can be fetched (`connect-src 'self'`), and no script runs in Explorer's frame to compile anything.

## Consequences

Pigeon can take a protocol from a maintained, widely used Rust library instead of writing it, and the next ones (a ratchet, MLS) fit the same crate. The `spake2` crate's own known-answer vectors run in `cargo test`, so the bytes on the wire match other SPAKE2 implementations. That crate says it has had no independent audit, like Pigeon itself; it is the implementation magic-wormhole.rs relies on, which is more review than any JavaScript alternative has.

Contributors need Rust, which `mise install` provides; a first build compiles the crate's dependencies, later ones take seconds. Cloudflare's build of the site needs the same tools, so its build command installs them through mise. The page carries about 110 KB more, fetched only for an exchange.

`'wasm-unsafe-eval'` widens `script-src` by WebAssembly compilation alone. Wiping reaches only the module's memory and getrandom's staging array: the copies JavaScript holds, of the password and of the key it is handed, live as long as their owners keep them, and values the engine keeps in registers or on its own stack are out of reach. A trap inside the module (the browser refusing randomness, say) ends it before anything is wiped.

Ruled out: a JavaScript PAKE library (too little review), Pigeon's own SPAKE2 over a JavaScript curve library (a new construction), committing the built `.wasm` (a binary nobody can review in a diff), and letting long-lived keys into the crate.
