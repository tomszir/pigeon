//! Library-backed protocols for Pigeon, built to WebAssembly and called from TypeScript.
//!
//! This crate only ever holds short-lived secrets: a PAKE password and the session state built
//! from it. Long-lived keys (identity, device, sealing) stay in WebCrypto as non-extractable keys
//! and never come here. Every heap allocation is wiped when it is freed (see [`alloc`]), the
//! TypeScript side calls [`scrub_stack`] after each call that touched a secret, and a session
//! overwrites the randomness getrandom staged for it in JavaScript (see `pake.rs`), so a
//! password, scalar or key the crate has finished with doesn't stay in the module's memory.
//! What the engine itself keeps in registers or on its native stack is out of any module's
//! reach.

use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

pub mod alloc;
pub mod pake;

/// Bytes of stack [`scrub_stack`] overwrites: many times what a SPAKE2 start or finish uses
/// (about 6 KB).
pub const SCRUB_BYTES: usize = 64 * 1024;

/// Overwrites the stack below the caller with zeros.
///
/// The compiler leaves copies of scalars, keys and password bytes in stack frames it has
/// returned from, out of the allocator's reach. Called from JavaScript, when no Rust frame is
/// live, this covers every frame the previous call into the module kept in its memory.
#[wasm_bindgen(js_name = scrubStack)]
#[inline(never)]
pub fn scrub_stack() {
    let mut stack = [0u8; SCRUB_BYTES];
    stack.zeroize();
    std::hint::black_box(&stack);
}

#[global_allocator]
static ALLOCATOR: alloc::ZeroizingAlloc<std::alloc::System> =
    alloc::ZeroizingAlloc(std::alloc::System);
