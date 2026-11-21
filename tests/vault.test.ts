/**
 * Lock state machine tests — rate-limit table and the unlock/lock/clear
 * lifecycle. The backend module is mocked for getVaultMeta only; deriveKey
 * and checkVerifier run for real so the full PBKDF2→verifier path is wired.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const META = {
  uid: 'test-uid',
  salt: 'MDEyMzQ1Njc4OWFiY2RlZg==',
  verifier: null as unknown as { iv: string; ciphertext: string },
};

vi.mock('@/backend/index.js', async (importOriginal) => {
  const crypto = await import('@/backend/crypto.js');
  return {
    ...(await importOriginal<typeof import('@/backend/index.js')>()),
    getVaultMeta: vi.fn(async () => META),
    deriveKey: crypto.deriveKey,
    checkVerifier: crypto.checkVerifier,
  };
});

import { useVaultStore, retryDelayMs, requireKey } from '@/stores/vaultStore.js';
import { deriveKey, createVerifier } from '@/backend/crypto.js';

const PASSWORD = 'test-master-pw';

beforeEach(async () => {
  // One real verifier per run: META.verifier locked to PASSWORD+test-uid.
  const key = await deriveKey(PASSWORD, 'test-uid', META.salt);
  META.verifier = await createVerifier(key);
  useVaultStore.getState().clearSession();
  useVaultStore.getState().setUid('test-uid');
});

describe('retryDelayMs rate-limit table', () => {
  it('no delay for the first 4 failed attempts', () => {
    for (let a = 0; a < 5; a++) expect(retryDelayMs(a)).toBe(0);
  });

  it('doubles from attempt 5 on, capped at 60s', () => {
    expect(retryDelayMs(5)).toBe(2_000);
    expect(retryDelayMs(6)).toBe(4_000);
    expect(retryDelayMs(7)).toBe(8_000);
    expect(retryDelayMs(10)).toBe(60_000);
    expect(retryDelayMs(50)).toBe(60_000);
  });
});

describe('vault lock lifecycle', () => {
  it('starts locked with no key', () => {
    const s = useVaultStore.getState();
    expect(s.lockPhase).toBe('locked');
    expect(s.derivedKey).toBeNull();
    expect(requireKey).toThrow(/locked/i);
  });

  it('unlock with the right password reaches unlocked and holds a key', async () => {
    const ok = await useVaultStore.getState().unlock(PASSWORD);
    expect(ok).toBe(true);
    const s = useVaultStore.getState();
    expect(s.lockPhase).toBe('unlocked');
    expect(s.derivedKey).not.toBeNull();
    expect(s.isVaultReady()).toBe(true);
    expect(requireKey()).toBe(s.derivedKey);
  });

  it('unlock with the wrong password increments attempts, stays locked', async () => {
    const startedAt = Date.now();
    const ok = await useVaultStore.getState().unlock('wrong-password');
    expect(ok).toBe(false);
    const s = useVaultStore.getState();
    expect(s.lockPhase).toBe('locked');
    expect(s.derivedKey).toBeNull();
    expect(s.failedAttempts).toBe(1);
    expect(s.error).toMatch(/incorrect/i);
    // attempt 1 → no delay; allow for clock advance between attempt and assert
    expect(s.nextAttemptAllowedAt).toBeGreaterThanOrEqual(startedAt);
    expect(s.nextAttemptAllowedAt).toBeLessThanOrEqual(Date.now());
  });

  it('five failures set a future nextAttemptAllowedAt', async () => {
    for (let i = 0; i < 5; i++) {
      await useVaultStore.getState().unlock('wrong-password');
    }
    const s = useVaultStore.getState();
    expect(s.failedAttempts).toBe(5);
    expect(s.nextAttemptAllowedAt).toBeGreaterThan(Date.now() - 1);
  });

  it('a failed attempt inside the backoff window is refused without deriving', async () => {
    useVaultStore.setState({
      failedAttempts: 6,
      nextAttemptAllowedAt: Date.now() + 30_000,
    });
    const ok = await useVaultStore.getState().unlock(PASSWORD);
    expect(ok).toBe(false);
    expect(useVaultStore.getState().error).toMatch(/wait/i);
    // Still rate-limited → no key minted.
    expect(useVaultStore.getState().derivedKey).toBeNull();
  });

  it('lock() drops the key but keeps meta; clearSession() forgets the user', async () => {
    await useVaultStore.getState().unlock(PASSWORD);
    useVaultStore.getState().lock();
    expect(useVaultStore.getState().lockPhase).toBe('locked');
    expect(useVaultStore.getState().derivedKey).toBeNull();

    useVaultStore.getState().clearSession();
    const s = useVaultStore.getState();
    expect(s.uid).toBeNull();
    expect(s.vaultMeta).toBeNull();
    expect(s.failedAttempts).toBe(0);
    expect(s.nextAttemptAllowedAt).toBe(0);
  });

  it('no uid → unlock refuses before deriving', async () => {
    useVaultStore.getState().clearSession();
    const ok = await useVaultStore.getState().unlock(PASSWORD);
    expect(ok).toBe(false);
    expect(useVaultStore.getState().error).toMatch(/sign/i);
  });
});
