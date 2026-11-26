//! Argon2id against known answers from an independent implementation (OpenSSL, through Node's
//! `crypto.argon2Sync`, which also reproduces RFC 9106's own test vector), and against
//! parameters the crate or the module's memory can't take.

use pigeon_crypto::argon2id::{KEY_BYTES, argon2id, derive};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

const SALT: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

#[test]
fn matches_known_answers() {
    let cases: [(&str, u32, u32, u32, &str); 4] = [
        (
            "password",
            64,
            1,
            1,
            "9c493022877348e034719bce110c99301e5d4d16acacc6a829000ff2044b1b0c",
        ),
        (
            "correct horse battery staple",
            1024,
            3,
            2,
            "c6acf874997f47dbbde84359fde02b8a99d29d7ed745e9a5e99a9fdce46e0724",
        ),
        (
            "p\u{e4}ssword",
            19456,
            2,
            1,
            "e7f5bcedca960c494fda0b674c8abfa8348fd73a2900dc592e89e4a1b4b65d6c",
        ),
        (
            "password",
            65536,
            3,
            1,
            "def6fd068289b9a0cf1114f8e978a2c4dab6faef377d895b9c2d59fc93fc5653",
        ),
    ];
    for (password, memory, passes, lanes, expected) in cases {
        let key = argon2id(password.as_bytes().to_vec(), &SALT, memory, passes, lanes).unwrap();
        assert_eq!(key.len(), KEY_BYTES);
        assert_eq!(
            hex(&key),
            expected,
            "{password} m={memory} t={passes} p={lanes}"
        );
    }
}

#[test]
fn each_input_changes_the_key() {
    let base = derive(b"password", &SALT, 64, 1, 1).unwrap();
    assert_ne!(base, derive(b"passwore", &SALT, 64, 1, 1).unwrap());
    assert_ne!(base, derive(b"password", &[9; 16], 64, 1, 1).unwrap());
    assert_ne!(base, derive(b"password", &SALT, 128, 1, 1).unwrap());
    assert_ne!(base, derive(b"password", &SALT, 64, 2, 1).unwrap());
    assert_ne!(base, derive(b"password", &SALT, 64, 1, 2).unwrap());
}

#[test]
fn refuses_what_the_crate_refuses() {
    assert!(
        derive(b"password", &[0; 7], 64, 1, 1).is_none(),
        "salt under 8 bytes"
    );
    assert!(derive(b"password", &SALT, 64, 0, 1).is_none(), "no passes");
    assert!(derive(b"password", &SALT, 64, 1, 0).is_none(), "no lanes");
    assert!(derive(b"password", &SALT, 7, 1, 1).is_none(), "under 8 KiB");
    assert!(
        derive(b"password", &SALT, 8, 1, 2).is_none(),
        "under 8 KiB per lane"
    );
}

#[test]
fn takes_an_empty_password_without_trouble() {
    assert!(derive(b"", &SALT, 64, 1, 1).is_some());
}
