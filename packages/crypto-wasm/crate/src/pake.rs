//! SPAKE2 (asymmetric, on the Ed25519 group) from RustCrypto's `spake2` crate, the
//! implementation magic-wormhole.rs uses, exposed to JavaScript as a one-use session.
//!
//! Side A sends a message starting with `A`, side B one starting with `B`; each is 33 bytes. Both
//! sides must agree on which of them is A, on the password and on both identities, or their keys
//! differ. A session finishes at most once.

use rand_core::{CryptoRng, OsRng, RngCore};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

/// Which side of the exchange this is. The two parties must take different sides.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    A = 0,
    B = 1,
}

/// Bytes in each side's message: a side byte and a compressed Ed25519 point.
pub const MESSAGE_BYTES: usize = 33;
/// Bytes in the agreed key.
pub const KEY_BYTES: usize = 32;

/// One side of one SPAKE2 exchange.
#[wasm_bindgen]
pub struct Spake2Session {
    state: Option<Spake2<Ed25519Group>>,
    message: Vec<u8>,
}

impl Spake2Session {
    /// Starts a session with randomness from `rng`. Only tests pass their own.
    pub fn start_with_rng(
        side: Side,
        mut password: Vec<u8>,
        id_a: &[u8],
        id_b: &[u8],
        rng: impl CryptoRng + RngCore,
    ) -> Spake2Session {
        let secret = Password::new(&password);
        password.zeroize();
        let (id_a, id_b) = (Identity::new(id_a), Identity::new(id_b));
        let (state, message) = match side {
            Side::A => Spake2::start_a_with_rng(&secret, &id_a, &id_b, rng),
            Side::B => Spake2::start_b_with_rng(&secret, &id_a, &id_b, rng),
        };
        Spake2Session {
            state: Some(state),
            message,
        }
    }
}

#[wasm_bindgen]
impl Spake2Session {
    /// Starts a session. `password` is taken by value, so this module owns its copy and wipes it
    /// as soon as spake2 has made its own.
    #[wasm_bindgen(constructor)]
    pub fn start(side: Side, password: Vec<u8>, id_a: &[u8], id_b: &[u8]) -> Spake2Session {
        let session = Self::start_with_rng(side, password, id_a, id_b, OsRng);
        overwrite_staged_randomness();
        session
    }

    /// The message to send to the other side.
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> Vec<u8> {
        self.message.clone()
    }

    /// Finishes with the other side's message and returns the 32-byte key, or nothing when the
    /// message is malformed (wrong length, wrong side, not a point) or the session already
    /// finished. A wrong password is not detected here: it gives a different key, which the
    /// caller finds out by confirming the key with the other side.
    pub fn finish(&mut self, peer: &[u8]) -> Option<Vec<u8>> {
        self.state.take()?.finish(peer).ok()
    }
}

/// Bytes getrandom stages in JavaScript on the web before copying them into this module.
const STAGED_RANDOM_BYTES: usize = 256;

/// On the web, getrandom fills a 256-byte JavaScript array with `crypto.getRandomValues` and
/// copies it into this module's memory, and keeps that array for the life of the page, out of
/// reach of the allocator and of `scrub_stack`. After a session draws its secret scalar, the
/// array still holds the bytes it came from. Drawing a full array of throwaway bytes overwrites
/// them; the copy that lands here is wiped at once.
fn overwrite_staged_randomness() {
    let mut spare = [0u8; STAGED_RANDOM_BYTES];
    OsRng.fill_bytes(&mut spare);
    spare.zeroize();
}
