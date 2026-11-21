/**
 * Crypto golden tests — the backend contract:
 * PBKDF2-SHA256 310k iterations, AES-256-GCM, key input = password+uid,
 * verifier = encrypt(key, "Scync_VALID_v1"), random 12-byte IV, base64.
 * These must stay byte-compatible with the web app and CLI.
 */
import { describe, it, expect } from 'vitest';
import {
  utf8Encode, utf8Decode, base64Encode, base64Decode,
  deriveKey, encrypt, decrypt, createVerifier, checkVerifier,
} from '../src/backend/crypto.js';

const PASSWORD = 'correct horse battery staple';
const UID = 'u7Gq1sTm3GdJ9riIfA71gsJF9Fr1';

// Independent reference implementation for cross-checking derives.
async function referenceDerive(password: string, uid: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password + uid), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations: 310_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

describe('base64 helpers (RFC 4648 vectors)', () => {
  it('encodes/decodes known vectors', () => {
    expect(base64Encode(utf8Encode('foobar'))).toBe('Zm9vYmFy');
    expect(utf8Decode(base64Decode('Zm9vYmFy'))).toBe('foobar');
    expect(utf8Decode(base64Decode(''))).toBe('');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const b64 = base64Encode(bytes);
    expect(Array.from(base64Decode(b64))).toEqual(Array.from(bytes));
  });
});

describe('deriveKey — PBKDF2-SHA256, 310k, password+uid', () => {
  it('key is non-extractable and matches an independent derivation', async () => {
    const salt = base64Decode('MDEyMzQ1Njc4OWFiY2RlZg==');
    const key = await deriveKey(PASSWORD, UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    expect(key.extractable).toBe(false);
    // Non-extractable keys can only be compared by behaviour: encrypt with
    // the reference key, decrypt with ours (same parameters → same key bits).
    const ref = await referenceDerive(PASSWORD, UID, salt);
    const ct = await encrypt(ref, 'probe');
    await expect(decrypt(key, ct)).resolves.toBe('probe');
  });

  it('uid changes the key (uid is part of the key input)', async () => {
    const k1 = await deriveKey('pw', 'uid-A', 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const k2 = await deriveKey('pw', 'uid-B', 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const ct = await encrypt(k1, 'x');
    await expect(decrypt(k2, ct)).rejects.toThrow();
  });
});

describe('encrypt / decrypt — AES-256-GCM', () => {
  it('round-trips plaintext, including multi-byte characters', async () => {
    const key = await deriveKey(PASSWORD, UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    for (const plain of ['', 'short', 'ключ 🔐 emoji', 'x'.repeat(10_000)]) {
      const field = await encrypt(key, plain);
      await expect(decrypt(key, field)).resolves.toBe(plain);
    }
  });

  it('uses a fresh random 12-byte IV per encryption', async () => {
    const key = await deriveKey(PASSWORD, UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const a = await encrypt(key, 'same');
    const b = await encrypt(key, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(base64Decode(a.iv).length).toBe(12);
  });

  it('tampered ciphertext fails authentication', async () => {
    const key = await deriveKey(PASSWORD, UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const field = await encrypt(key, 'do not touch');
    const raw = base64Decode(field.ciphertext);
    raw[0] ^= 0x01;
    field.ciphertext = base64Encode(raw);
    await expect(decrypt(key, field)).rejects.toThrow();
  });

  it('wrong key fails authentication', async () => {
    const k1 = await deriveKey('pass-one', UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const k2 = await deriveKey('pass-two', UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const field = await encrypt(k1, 'secret');
    await expect(decrypt(k2, field)).rejects.toThrow();
  });
});

describe('verifier — zero-knowledge lock check', () => {
  it('verifier is the magic string under the derived key', async () => {
    const key = await deriveKey(PASSWORD, UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const verifier = await createVerifier(key);
    await expect(decrypt(key, verifier)).resolves.toBe('Scync_VALID_v1');
    await expect(checkVerifier(key, verifier)).resolves.toBe(true);
  });

  it('rejects a verifier made with a different password', async () => {
    const right = await deriveKey(PASSWORD, UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const wrong = await deriveKey('not-the-password', UID, 'MDEyMzQ1Njc4OWFiY2RlZg==');
    const verifier = await createVerifier(wrong);
    await expect(checkVerifier(right, verifier)).resolves.toBe(false);
  });
});
