//! The SPAKE2 session against itself, against malformed messages, and against the known-answer
//! vectors the spake2 crate checks itself with (shared with python-spake2, so the bytes on the
//! wire interoperate).

use pigeon_crypto::pake::{KEY_BYTES, MESSAGE_BYTES, Side, Spake2Session};
use rand_core::{CryptoRng, RngCore};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
        .collect()
}

fn start(side: Side, password: &[u8]) -> Spake2Session {
    Spake2Session::start(side, password.to_vec(), b"idA", b"idB")
}

#[test]
fn both_sides_agree_on_a_32_byte_key() {
    let mut a = start(Side::A, b"password");
    let mut b = start(Side::B, b"password");
    assert_eq!(a.message().len(), MESSAGE_BYTES);
    assert_eq!(b.message().len(), MESSAGE_BYTES);
    let key_a = a.finish(&b.message()).unwrap();
    let key_b = b.finish(&a.message()).unwrap();
    assert_eq!(key_a.len(), KEY_BYTES);
    assert_eq!(key_a, key_b);
}

#[test]
fn a_wrong_password_gives_different_keys() {
    let mut a = start(Side::A, b"password");
    let mut b = start(Side::B, b"passwore");
    let key_a = a.finish(&b.message()).unwrap();
    let key_b = b.finish(&a.message()).unwrap();
    assert_ne!(key_a, key_b);
}

#[test]
fn different_identities_give_different_keys() {
    let mut a = Spake2Session::start(Side::A, b"password".to_vec(), b"idA", b"idB");
    let mut b = Spake2Session::start(Side::B, b"password".to_vec(), b"idA", b"idC");
    assert_ne!(a.finish(&b.message()), b.finish(&a.message()));
}

#[test]
fn refuses_malformed_messages() {
    let b = start(Side::B, b"password");
    let good = b.message();
    let mut too_long = good.clone();
    too_long.push(0);
    // y = 2 has no x on the curve: (y² - 1) / (d·y² + 1) isn't a square modulo 2²⁵⁵ - 19.
    let mut not_a_point = vec![0u8; MESSAGE_BYTES];
    not_a_point[0] = b'B';
    not_a_point[1] = 2;
    let cases: [&[u8]; 5] = [
        &[],
        &good[..32],
        &too_long,
        &not_a_point,
        &start(Side::A, b"x").message(),
    ];
    for message in cases {
        assert_eq!(
            start(Side::A, b"password").finish(message),
            None,
            "{}",
            hex(message)
        );
    }
}

#[test]
fn refuses_its_own_message_reflected_back() {
    let mut a = start(Side::A, b"password");
    let own = a.message();
    assert_eq!(a.finish(&own), None);
}

#[test]
fn finishes_only_once() {
    let mut a = start(Side::A, b"password");
    let b = start(Side::B, b"password");
    assert!(a.finish(&b.message()).is_some());
    assert_eq!(a.finish(&b.message()), None);
}

/// Hands out one fixed scalar. `Scalar::random` reduces 64 bytes modulo the group order, so 32
/// little-endian bytes followed by 32 zeros is that scalar exactly.
struct FixedScalar([u8; 64]);

impl FixedScalar {
    fn new(little_endian: &str) -> FixedScalar {
        let mut bytes = [0u8; 64];
        bytes[..32].copy_from_slice(&unhex(little_endian));
        FixedScalar(bytes)
    }
}

impl RngCore for FixedScalar {
    fn next_u32(&mut self) -> u32 {
        unimplemented!()
    }
    fn next_u64(&mut self) -> u64 {
        unimplemented!()
    }
    fn fill_bytes(&mut self, dest: &mut [u8]) {
        dest.copy_from_slice(&self.0[..dest.len()]);
    }
    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core::Error> {
        self.fill_bytes(dest);
        Ok(())
    }
}

impl CryptoRng for FixedScalar {}

#[test]
fn matches_the_spake2_crates_known_answer_vectors() {
    // spake2 0.4.0's test_asymmetric: the scalars 2611694063...26693 and 7002393159...84383.
    let scalar_a =
        FixedScalar::new("25184061a70b1142f1a9f043a52cf7033dc308b5a0a32e42b003ecd59c2ac605");
    let scalar_b =
        FixedScalar::new("9fb5e845084e0cbe27ac8b4d3af139b33f3f8a047d4234e2d45d33c5cd367b0f");
    let mut a =
        Spake2Session::start_with_rng(Side::A, b"password".to_vec(), b"idA", b"idB", scalar_a);
    let mut b =
        Spake2Session::start_with_rng(Side::B, b"password".to_vec(), b"idA", b"idB", scalar_b);
    assert_eq!(
        hex(&a.message()),
        "416fc960df73c9cf8ed7198b0c9534e2e96a5984bfc5edc023fd24dacf371f2af9"
    );
    assert_eq!(
        hex(&b.message()),
        "42354e97b88406922b1df4bea1d7870f17aed3dba7c720b313edae315b00959309"
    );
    let key = "712295de7219c675ddd31942184aa26e0a957cf216bc230d165b215047b520c1";
    assert_eq!(hex(&a.finish(&b.message()).unwrap()), key);
    assert_eq!(hex(&b.finish(&a.message()).unwrap()), key);
}
