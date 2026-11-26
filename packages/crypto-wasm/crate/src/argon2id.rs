//! Argon2id (RFC 9106, version 0x13) from RustCrypto's `argon2` crate, exposed to JavaScript as
//! one function that stretches a passphrase into a 32-byte key.
//!
//! The key is short-lived: the caller imports it into a non-extractable WebCrypto key and wipes
//! it. The passphrase is taken by value, so this module owns its copy and wipes it as soon as
//! the key is made; the memory Argon2 fills is wiped when it is freed (see [`crate::alloc`]).
//! The function runs exactly the parameters it is given, so the caller decides what is too much;
//! a request the module has no memory for gives nothing, as does any the crate refuses.

use argon2::{Algorithm, Argon2, Params, Version};
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

/// Bytes in the key.
pub const KEY_BYTES: usize = 32;

/// Argon2id of `password` and `salt` with `memory_kib` KiB of memory, `passes` passes over it and
/// `lanes` lanes, as 32 bytes; or `None` when the crate refuses the parameters (a salt under 8
/// bytes, memory under 8 KiB per lane, a zero count) or the module can't allocate the memory.
pub fn derive(
    password: &[u8],
    salt: &[u8],
    memory_kib: u32,
    passes: u32,
    lanes: u32,
) -> Option<[u8; KEY_BYTES]> {
    let params = Params::new(memory_kib, passes, lanes, Some(KEY_BYTES)).ok()?;
    let mut key = [0u8; KEY_BYTES];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password, salt, &mut key)
        .ok()?;
    Some(key)
}

/// Stretches `password` with Argon2id; see [`derive`]. The key is returned as bytes for
/// JavaScript to import and wipe.
#[wasm_bindgen(js_name = argon2id)]
pub fn argon2id(
    mut password: Vec<u8>,
    salt: &[u8],
    memory_kib: u32,
    passes: u32,
    lanes: u32,
) -> Option<Vec<u8>> {
    let key = derive(&password, salt, memory_kib, passes, lanes);
    password.zeroize();
    let mut key = key?;
    let out = key.to_vec();
    key.zeroize();
    Some(out)
}
