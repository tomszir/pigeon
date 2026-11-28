// The crypto contract: what every Crypto, SealCrypto and Sealer must do, checked against Project
// Wycheproof's test vectors rather than against answers Pigeon works out for itself. The vectors
// are vendored byte for byte in ./wycheproof, pinned by hash in vendor/wycheproof.lock.json.
//
// Each platform's test file runs the contract on its own implementation:
//
//   cryptoContract('browser WebCrypto', () => createBrowserCrypto())
//
// Wycheproof says what a correct Ed25519, HMAC, ECDH, HKDF or AES-GCM implementation does.
// Pigeon's own spelling rule for Ed25519 (S below the group order) is stated again here from the
// protocol rather than imported from signature.ts, so a mistake there can't also hide itself
// here. Vectors for options Pigeon never uses (other key, IV or tag sizes,
// associated data, a salt, truncated MACs) are left out by filters, and each family checks that
// its filters still leave cases (valid and invalid ones, where the file has both that apply), so
// a filter can't quietly empty it. Where the vectors that fit leave a rule unexercised, a
// property next to them checks it.
//
// Test names start with the family and Wycheproof's tcId, so a failure names the vector it broke.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  base64Decode,
  bytesEqual,
  concatBytes,
  hexDecode,
  utf8Decode,
  utf8Encode,
} from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import { peerIdFromPublicKey } from '../identity/identity.ts'
import type { SealCrypto, Sealer } from '../mail/seal-crypto.ts'
import aesGcm from './wycheproof/aes_gcm_test.json'
import ecdh from './wycheproof/ecdh_secp256r1_webcrypto_test.json'
import ed25519 from './wycheproof/ed25519_test.json'
import hkdf from './wycheproof/hkdf_sha256_test.json'
import hmac from './wycheproof/hmac_sha256_test.json'

type Result = 'valid' | 'invalid' | 'acceptable'

interface Case {
  readonly tcId: number
  readonly comment: string
  readonly flags: readonly string[]
  readonly result: string
}

interface File<G> {
  readonly testGroups: readonly G[]
}

/** Wycheproof's hex, which is always well formed: a bad vector file is a bug, not a case. */
function hex(text: string): Uint8Array {
  const bytes = hexDecode(text)
  if (!bytes.ok) throw new Error(`malformed hex in a vector: ${text.slice(0, 16)}...`)
  return bytes.value
}

const result = (c: Case): Result => {
  if (c.result === 'valid' || c.result === 'invalid' || c.result === 'acceptable') return c.result
  throw new Error(`tcId ${c.tcId}: unknown result ${c.result}`)
}

const label = (family: string, c: Case, extra = '') =>
  `${family} tcId ${c.tcId}${extra}: ${c.comment || '(no comment)'} [${c.flags.join(', ')}]`

/** Fails when a family's filters leave it without valid or without invalid cases. */
function covers(family: string, cases: readonly { readonly expected: boolean }[]) {
  it(`${family} keeps valid and invalid cases after its filters`, () => {
    expect(cases.filter((c) => c.expected).length).toBeGreaterThan(0)
    expect(cases.filter((c) => !c.expected).length).toBeGreaterThan(0)
  })
}

interface SignatureGroup {
  readonly publicKey: { readonly pk?: string }
  readonly tests: readonly (Case & { readonly msg: string; readonly sig: string })[]
}

// Wycheproof's own flags for signatures that are spelled wrong rather than wrong in their maths:
// the wrong length, S at or past the group order. Pigeon
// refuses these itself, before the platform sees them, so they're refused even by a platform
// that would take them.
const ED25519_SPELLING = [
  'SignatureMalleability',
  'TruncatedSignature',
  'SignatureWithGarbage',
  'CompressedSignature',
]
const flagged = (c: Case, flags: readonly string[]) => c.flags.some((f) => flags.includes(f))

// RFC 8032 (5.1.7) has a verifier refuse an Ed25519 S at or past the group order L. Wycheproof
// flags its S = L and S just past L cases only as invalid, so they're picked out by that rule too.
const L = (1n << 252n) + 27742317777372353535851937790883648493n
const big = (bytes: Uint8Array) => bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)
const sAtOrPastL = (signature: Uint8Array) =>
  signature.length === 64 && big(signature.slice(32).reverse()) >= L

const ed25519Cases = () =>
  (ed25519 as File<SignatureGroup>).testGroups.flatMap((group) => {
    const signer = peerIdFromPublicKey(hex(group.publicKey.pk ?? ''))
    return group.tests.map((c) => ({ c, signer, expected: result(c) === 'valid' }))
  })

export interface CryptoContractOptions {
  /**
   * The same Crypto over a platform whose verify takes every signature, so Pigeon's own
   * refusals are checked apart from the platform's: a platform that checks a rule itself would
   * otherwise hide Pigeon's check of it going missing. Given where the Crypto takes its
   * SubtleCrypto as a parameter.
   */
  readonly permissive?: () => Crypto
}

/** Every Crypto: signatures, HMAC-SHA256 and SHA-256. */
export function cryptoContract(
  name: string,
  make: () => Crypto,
  options: CryptoContractOptions = {},
): void {
  describe(`${name} keeps the crypto contract`, () => {
    const { permissive } = options
    if (permissive)
      describe('its own refusals, over a platform that takes every signature', () => {
        const crypto = permissive()
        const ed = ed25519Cases().filter(
          ({ c }) => flagged(c, ED25519_SPELLING) || sAtOrPastL(hex(c.sig)),
        )
        it('own-refusal: the platform given really takes everything, and the list has cases', async () => {
          expect(ed.length).toBeGreaterThan(0)
          const valid = ed25519Cases().find(({ c }) => result(c) === 'valid')
          if (valid === undefined) throw new Error('no valid Ed25519 vector')
          // A real platform refuses a signature over other bytes; this one must take it.
          const other = utf8Encode('other bytes')
          expect(await crypto.verify(valid.signer, hex(valid.c.sig), other)).toBe(true)
        })
        for (const { c, signer } of ed)
          it(label('own-refusal ed25519', c), async () => {
            expect(await crypto.verify(signer, hex(c.sig), hex(c.msg))).toBe(false)
          })
      })

    describe('Ed25519 (Wycheproof)', () => {
      const crypto = make()
      const cases = ed25519Cases()
      covers(
        'ed25519',
        cases.filter(({ c }) => result(c) !== 'acceptable'),
      )
      for (const { c, signer, expected } of cases)
        it(label('ed25519', c), async () => {
          const verdict = await crypto.verify(signer, hex(c.sig), hex(c.msg))
          // 'acceptable' cases (small- and mixed-order public keys) are the platform's choice:
          // Pigeon sets no rule of its own for them, so only "a boolean, not a throw" is checked.
          if (result(c) === 'acceptable') expect(typeof verdict).toBe('boolean')
          else expect(verdict).toBe(expected)
        })
    })

    describe('HMAC-SHA256 (Wycheproof)', () => {
      const crypto = make()
      interface Group {
        readonly keySize: number
        readonly tagSize: number
        readonly tests: readonly (Case & { key: string; msg: string; tag: string })[]
      }
      // Pigeon's HMAC keys are 32 bytes and its tags are never truncated.
      const cases = (hmac as File<Group>).testGroups
        .filter((group) => group.keySize === 256 && group.tagSize === 256)
        .flatMap((group) => group.tests.map((c) => ({ c, expected: result(c) === 'valid' })))
      covers('hmac', cases)
      for (const { c, expected } of cases)
        it(label('hmac', c), async () => {
          const tag = await crypto.hmacSha256(hex(c.key), hex(c.msg))
          expect(bytesEqual(tag, hex(c.tag))).toBe(expected)
        })
    })

    describe('SHA-256 (FIPS 180-4 examples)', () => {
      const crypto = make()
      const examples = [
        ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        [
          'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
          '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
        ],
      ] as const
      for (const [text, digest] of examples)
        it(`sha256 of ${JSON.stringify(text)}`, async () => {
          expect(bytesEqual(await crypto.sha256(utf8Encode(text)), hex(digest))).toBe(true)
        })
    })

    it('verify answers false, never throws, for any signer, signature and data', async () => {
      const crypto = make()
      const ed = peerIdFromPublicKey(hex(ed25519.testGroups[0]?.publicKey.pk ?? ''))
      const signer = fc.oneof(fc.constant(ed), fc.string())
      const signature = fc.oneof(
        fc.uint8Array({ minLength: 64, maxLength: 64 }),
        fc.uint8Array({ maxLength: 80 }),
      )
      await fc.assert(
        fc.asyncProperty(signer, signature, fc.uint8Array(), async (who, sig, data) => {
          expect(await crypto.verify(who, sig, data)).toBe(false)
        }),
        { numRuns: 200 },
      )
    })
  })
}

/** What a platform hands the seal contract: its SealCrypto, and a Sealer from a test key. */
export interface SealPlatform {
  readonly seal: () => SealCrypto
  /** A Sealer for a P-256 private key given as a JWK (`d`, `x`, `y`), as Wycheproof gives it. */
  readonly sealer: (jwk: EcJwk) => Promise<Sealer>
}

export interface EcJwk {
  readonly kty: string
  readonly crv: string
  readonly d?: string
  readonly x?: string
  readonly y?: string
}

/** base64url without padding, as JWKs spell their numbers. */
function base64url(text: string): Uint8Array {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = base64Decode(standard + '='.repeat((4 - (standard.length % 4)) % 4))
  if (!bytes.ok) throw new Error(`malformed base64url in a vector: ${text.slice(0, 16)}...`)
  return bytes.value
}

/** The raw public key a JWK names: 04, x, y, however long Wycheproof made x and y. */
const rawPublic = (jwk: EcJwk) =>
  concatBytes(new Uint8Array([4]), base64url(jwk.x ?? ''), base64url(jwk.y ?? ''))

/** Every SealCrypto and Sealer: ECDH P-256, HKDF-SHA256 with no salt, and AES-256-GCM. */
export function sealContract(name: string, platform: SealPlatform): void {
  describe(`${name} keeps the seal contract`, () => {
    describe('ECDH P-256 (Wycheproof, WebCrypto keys)', () => {
      interface Group {
        readonly tests: readonly (Case & { public: EcJwk; private: EcJwk; shared: string })[]
      }
      const cases = (ecdh as unknown as File<Group>).testGroups.flatMap((group) =>
        group.tests.map((c) => ({ c, expected: result(c) === 'valid' })),
      )
      covers('ecdh', cases)
      for (const { c, expected } of cases)
        it(label('ecdh', c), async () => {
          const sealer = await platform.sealer(c.private)
          const shared = await sealer.share(rawPublic(c.public))
          if (expected) expect(shared && bytesEqual(shared, hex(c.shared))).toBe(true)
          else expect(shared).toBeUndefined()
        })
    })

    describe('HKDF-SHA256 (Wycheproof)', () => {
      interface Group {
        readonly tests: readonly (Case & {
          ikm: string
          salt: string
          info: string
          size: number
          okm: string
        })[]
      }
      // Pigeon's HKDF has no salt and takes its info as text, so only vectors with an empty salt
      // and an info that is UTF-8 apply.
      const asText = (info: string) => {
        const bytes = hex(info)
        const text = utf8Decode(bytes)
        return text.ok && bytesEqual(utf8Encode(text.value), bytes) ? text.value : undefined
      }
      const cases = (hkdf as File<Group>).testGroups
        .flatMap((group) => group.tests)
        .filter((c) => c.salt === '' && asText(c.info) !== undefined)
        .map((c) => ({ c, info: asText(c.info) ?? '', expected: result(c) === 'valid' }))
      it('hkdf keeps valid cases after its filters', () => {
        expect(cases.filter((c) => c.expected).length).toBeGreaterThan(0)
      })
      // Every Wycheproof vector that fits has an empty info, so the vectors alone wouldn't
      // notice an HKDF that ignored it; Pigeon tells keys apart by their info (one per
      // direction in a handshake, one per kind of mail), so that's checked here.
      // One known answer with a text info, so how the text becomes bytes (UTF-8) is pinned too.
      // It's RFC 5869's test case 3 (22 bytes of 0x0b, no salt) with the info changed, computed
      // with Python's own hmac and hashlib, which share no code with WebCrypto:
      //   hkdf(ikm=b'\x0b' * 22, salt=b'', info='pigeon hkdf: über'.encode(), length=42)
      it('hkdf of a text info matches a known answer, so its info is UTF-8', async () => {
        const okm = await platform.seal().hkdf(hex('0b'.repeat(22)), 'pigeon hkdf: über', 42)
        const expected =
          '5c0578632788faa99ac6dc487edb49a79d484da7726693d737bd35c1f75dbc32b7126d06534ddad5ea68'
        expect(bytesEqual(okm, hex(expected))).toBe(true)
      })
      it('hkdf gives different keys for different infos, and the same key for the same one', async () => {
        const seal = platform.seal()
        await fc.assert(
          fc.asyncProperty(
            fc.uint8Array({ minLength: 1, maxLength: 64 }),
            fc.string(),
            fc.string(),
            async (ikm, a, b) => {
              fc.pre(a !== b)
              const [ka, again, kb] = await Promise.all([
                seal.hkdf(ikm, a, 32),
                seal.hkdf(ikm, a, 32),
                seal.hkdf(ikm, b, 32),
              ])
              expect(bytesEqual(ka, again)).toBe(true)
              expect(bytesEqual(ka, kb)).toBe(false)
            },
          ),
          { numRuns: 100 },
        )
      })
      for (const { c, info, expected } of cases)
        it(label('hkdf', c), async () => {
          const derived = platform.seal().hkdf(hex(c.ikm), info, c.size)
          if (expected) expect(bytesEqual(await derived, hex(c.okm))).toBe(true)
          else await expect(derived).rejects.toThrow()
        })
    })

    describe('AES-256-GCM (Wycheproof)', () => {
      interface Group {
        readonly keySize: number
        readonly ivSize: number
        readonly tagSize: number
        readonly tests: readonly (Case & {
          key: string
          iv: string
          aad: string
          msg: string
          ct: string
          tag: string
        })[]
      }
      // Pigeon seals under 32-byte keys with a 12-byte nonce, a 16-byte tag and no associated
      // data: `open` takes the nonce, then the ciphertext and tag.
      const cases = (aesGcm as File<Group>).testGroups
        .filter((group) => group.keySize === 256 && group.ivSize === 96 && group.tagSize === 128)
        .flatMap((group) => group.tests)
        .filter((c) => c.aad === '')
        .map((c) => ({ c, expected: result(c) === 'valid' }))
      covers('aes-gcm', cases)
      for (const { c, expected } of cases)
        it(label('aes-gcm', c), async () => {
          const sealed = concatBytes(hex(c.iv), hex(c.ct), hex(c.tag))
          const opened = await platform.seal().open(hex(c.key), sealed)
          if (expected) expect(opened && bytesEqual(opened, hex(c.msg))).toBe(true)
          else expect(opened).toBeUndefined()
        })

      // GCM under one key must never use a nonce twice: that leaks the XOR of the plaintexts and
      // lets anyone forge tags. `seal` picks each nonce fresh, so two seals never share one.
      it('aes-gcm seals with a fresh nonce every time', async () => {
        const seal = platform.seal()
        const key = new Uint8Array(32)
        const data = utf8Encode('the same letter')
        const nonces = new Set<string>()
        for (let i = 0; i < 32; i++) {
          const sealed = await seal.seal(key, data)
          nonces.add(Array.from(sealed.subarray(0, 12)).join(','))
        }
        expect(nonces.size).toBe(32)
      })

      it('opens what it seals, and nothing changed by a single bit', async () => {
        const seal = platform.seal()
        await fc.assert(
          fc.asyncProperty(
            fc.uint8Array({ minLength: 32, maxLength: 32 }),
            fc.uint8Array({ maxLength: 256 }),
            fc.nat(),
            fc.integer({ min: 0, max: 7 }),
            async (key, data, at, bit) => {
              const sealed = await seal.seal(key, data)
              const opened = await seal.open(key, sealed)
              expect(opened && bytesEqual(opened, data)).toBe(true)
              const changed = new Uint8Array(sealed)
              const index = at % changed.length
              changed[index] = (changed[index] ?? 0) ^ (1 << bit)
              expect(await seal.open(key, changed)).toBeUndefined()
            },
          ),
          { numRuns: 100 },
        )
      })
    })
  })
}
