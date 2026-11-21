/**
 * vaultStore — the heart of the lock model.
 *
 * The derived key is a non-extractable CryptoKey living ONLY here, in the
 * main window's JS memory. It is never persisted, logged, or sent across
 * windows. Plaintext never lives in this store: decryption happens on demand
 * via `decryptX` helpers and reveal/copy flows.
 */
import { create } from 'zustand';
import {
  getVaultMeta,
  deriveKey,
  checkVerifier,
  type VaultMeta,
} from '@/backend/index.js';

export type LockPhase = 'locked' | 'unlocking' | 'unlocked';

/** Exponential backoff after 5 failed attempts (client-side rate limit). */
export const MAX_ATTEMPTS_BEFORE_DELAY = 5;

export function retryDelayMs(attempt: number): number {
  // attempt = failed-attempt count. 0..4 → 0 ms; then 1, 2, 4, 8, … seconds, capped at 60s.
  if (attempt < MAX_ATTEMPTS_BEFORE_DELAY) return 0;
  const exp = Math.min(60_000, 1_000 * 2 ** (attempt - MAX_ATTEMPTS_BEFORE_DELAY + 1));
  return exp;
}

interface VaultState {
  uid: string | null;
  derivedKey: CryptoKey | null;
  vaultMeta: VaultMeta | null;
  lockPhase: LockPhase;
  /** Failed unlock attempts since last success (drives rate limiting). */
  failedAttempts: number;
  /** Wall-clock time when the next attempt is allowed (rate limiting). */
  nextAttemptAllowedAt: number;
  error: string | null;

  setUid: (uid: string | null) => void;
  loadVaultMeta: (uid: string) => Promise<boolean>;
  unlock: (password: string) => Promise<boolean>;
  lock: (opts?: { silent?: boolean }) => void;
  clearSession: () => void;
  isVaultReady: () => boolean;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  uid: null,
  derivedKey: null,
  vaultMeta: null,
  lockPhase: 'locked',
  failedAttempts: 0,
  nextAttemptAllowedAt: 0,
  error: null,

  setUid: (uid) => set({ uid }),

  loadVaultMeta: async (uid) => {
    try {
      const meta = await getVaultMeta(uid);
      set({ vaultMeta: meta, error: null });
      return meta !== null;
    } catch (e) {
      set({ vaultMeta: null, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  /**
   * Unlock = getVaultMeta → deriveKey(password, uid, salt) → checkVerifier.
   * PBKDF2 runs in the webview's WebCrypto (async, off the UI thread).
   */
  unlock: async (password) => {
    const state = get();
    if (!state.uid) {
      set({ error: 'No signed-in user.' });
      return false;
    }
    if (Date.now() < state.nextAttemptAllowedAt) {
      const wait = Math.ceil((state.nextAttemptAllowedAt - Date.now()) / 1000);
      set({ error: `Too many attempts. Wait ${wait}s and try again.` });
      return false;
    }

    set({ lockPhase: 'unlocking', error: null });
    try {
      let meta = state.vaultMeta;
      if (!meta || state.uid) {
        const fresh = await getVaultMeta(state.uid);
        if (fresh) meta = fresh;
      }
      if (!meta) {
        set({
          lockPhase: 'locked',
          error: 'Vault is not initialized. Please set up your vault on the Scync web app first.',
        });
        return false;
      }

      const key = await deriveKey(password, state.uid, meta.salt);
      const ok = await checkVerifier(key, meta.verifier);
      if (!ok) {
        const attempts = state.failedAttempts + 1;
        set({
          lockPhase: 'locked',
          failedAttempts: attempts,
          nextAttemptAllowedAt: Date.now() + retryDelayMs(attempts),
          error: 'Incorrect master password.',
        });
        return false;
      }

      set({
        derivedKey: key,
        vaultMeta: meta,
        lockPhase: 'unlocked',
        failedAttempts: 0,
        nextAttemptAllowedAt: 0,
        error: null,
      });
      return true;
    } catch (e) {
      set({
        lockPhase: 'locked',
        error: e instanceof Error ? e.message : 'Unlock failed.',
      });
      return false;
    }
  },

  /**
   * Lock: drop the key and all metadata. The store holds no decrypted
   * values, so nulling the key IS the wipe; dataStore holds ciphertext only.
   * The quick-search popup is told via a `vault:locked` event (sent by the
   * caller with the Tauri emitter) to clear its results.
   */
  lock: (_opts) => {
    set({
      derivedKey: null,
      vaultMeta: get().vaultMeta ?? null,
      lockPhase: 'locked',
      error: null,
    });
  },

  /** Sign-out: forget uid and everything vault-related. */
  clearSession: () => {
    set({
      uid: null,
      derivedKey: null,
      vaultMeta: null,
      lockPhase: 'locked',
      failedAttempts: 0,
      nextAttemptAllowedAt: 0,
      error: null,
    });
  },

  isVaultReady: () => get().derivedKey !== null,
}));

/**
 * Decrypt-or-throw helper used by every on-demand reveal/copy path.
 * Redis-solving "decrypt only with an unlocked key" in one place.
 */
export function requireKey(): CryptoKey {
  const key = useVaultStore.getState().derivedKey;
  if (!key) throw new Error('Vault is locked');
  return key;
}
