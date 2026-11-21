/**
 * TOTP tests — RFC 6238 Appendix B vectors (8-digit, T0=0). The otpauth
 * library does the HMAC math; these tests pin OUR pipeline (config → code)
 * and guard against accidental changes to algorithms/digits wiring.
 */
import { describe, it, expect } from 'vitest';
import { generateTOTPCode, getRemainingSeconds, validateBase32 } from '../src/backend/totp.js';

// RFC 6238 App. B secrets are ASCII: "12345678901234567890" repeated to 20
// (SHA1), 32 (SHA256) and 64 (SHA512) bytes.
function asciiBase32(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alpha[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alpha[(value << (5 - bits)) & 31];
  return out;
}

const KEY = '12345678901234567890';
// RFC 6238 App. B: the secret is ASCII "12345678901234567890" repeated to
// 20 / 32 / 64 bytes for SHA1 / SHA256 / SHA512 respectively.
const baseOf = (n: number) => asciiBase32(KEY.repeat(Math.ceil(n / 20)).slice(0, n));
const SECRETS2: Record<'SHA1' | 'SHA256' | 'SHA512', string> = {
  SHA1: baseOf(20),
  SHA256: baseOf(32),
  SHA512: baseOf(64),
};

const VECTORS: Array<{ t: number; sha1: string; sha256: string; sha512: string }> = [
  { t: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { t: 1_111_111_109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { t: 1_111_111_111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { t: 1_234_567_890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { t: 2_000_000_000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { t: 20_000_000_000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
];

const ALGOS = ['SHA1', 'SHA256', 'SHA512'] as const;

describe('TOTP — RFC 6238 App. B vectors', () => {
  for (const algo of ALGOS) {
    for (const v of VECTORS) {
      it(`${algo} T=${v.t} yields ${v[algo.toLowerCase() as 'sha1' | 'sha256' | 'sha512']}`, () => {
        const code = generateTOTPCode({
          issuer: 'test',
          label: 'rfc6238',
          secret: SECRETS2[algo],
          algorithm: algo,
          digits: 8,
          period: 30,
          at: v.t,
        });
        expect(code).toBe(v[algo.toLowerCase() as 'sha1' | 'sha256' | 'sha512']);
      });
    }
  }

  it('6-digit codes format without padding characters', () => {
    const code = generateTOTPCode({
      issuer: 'test',
      label: 'len',
      secret: SECRETS2.SHA1,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      at: 59,
    });
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('TOTP helpers', () => {
  it('validateBase32 accepts real secrets, rejects junk', () => {
    expect(validateBase32('JBSWY3DPEHPK3PXP')).toBe(true);
    expect(validateBase32('jbsw y3dp ehpk 3pxp')).toBe(true);
    expect(validateBase32('abcdefgh')).toBe(true);
    expect(validateBase32('01234567')).toBe(false); // 0/1 not in base32 alphabet
    expect(validateBase32('short')).toBe(false);
    expect(validateBase32('')).toBe(false);
  });

  it('getRemainingSeconds stays inside the period', () => {
    expect(getRemainingSeconds(30)).toBeGreaterThanOrEqual(1);
    expect(getRemainingSeconds(30)).toBeLessThanOrEqual(30);
    expect(getRemainingSeconds(60)).toBeLessThanOrEqual(60);
  });
});
