//! A global allocator that wipes memory as it is freed.
//!
//! Secrets cross into WebAssembly through buffers wasm-bindgen allocates, and the spake2 crate
//! keeps its password and scalars in structs and vectors it doesn't wipe. Wiping every block on
//! free covers all of them in one place, whoever allocated it. Copies the compiler leaves on the
//! stack are out of its reach; `scrub_stack` is for those.

use std::alloc::{GlobalAlloc, Layout};

use zeroize::Zeroize;

/// Another allocator, zeroizing each block before handing it back to it.
pub struct ZeroizingAlloc<A>(pub A);

// SAFETY: every call forwards to the inner allocator with the same pointer and layout; the only
// addition is writing zeros over a block it handed out and the caller is giving back.
unsafe impl<A: GlobalAlloc> GlobalAlloc for ZeroizingAlloc<A> {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { self.0.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        unsafe { self.0.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` came from `alloc` with this layout, so its `layout.size()` bytes are ours
        // until the inner allocator takes them back below.
        unsafe { std::slice::from_raw_parts_mut(ptr, layout.size()) }.zeroize();
        unsafe { self.0.dealloc(ptr, layout) }
    }

    // `realloc` keeps the trait's default, which allocates, copies and calls `dealloc` on the old
    // block, so a vector that grows doesn't leave its old contents behind.
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::System;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Checks, as each block comes back, that every byte of it is zero.
    struct CheckZeroed(AtomicBool);

    unsafe impl GlobalAlloc for CheckZeroed {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            unsafe { System.alloc(layout) }
        }

        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            let block = unsafe { std::slice::from_raw_parts(ptr, layout.size()) };
            if block.iter().any(|&byte| byte != 0) {
                self.0.store(true, Ordering::SeqCst);
            }
            unsafe { System.dealloc(ptr, layout) }
        }
    }

    #[test]
    fn wipes_blocks_before_freeing_them() {
        let alloc = ZeroizingAlloc(CheckZeroed(AtomicBool::new(false)));
        let layout = Layout::from_size_align(64, 8).unwrap();
        unsafe {
            let ptr = alloc.alloc(layout);
            assert!(!ptr.is_null());
            ptr.write_bytes(0xa5, 64);
            // Grow it too: the old block goes back through `dealloc`.
            let grown = alloc.realloc(ptr, layout, 256);
            assert!(!grown.is_null());
            assert_eq!(*grown.add(63), 0xa5);
            grown.write_bytes(0x5a, 256);
            alloc.dealloc(grown, Layout::from_size_align(256, 8).unwrap());
        }
        assert!(
            !alloc.0.0.load(Ordering::SeqCst),
            "a block came back holding data"
        );
    }
}
