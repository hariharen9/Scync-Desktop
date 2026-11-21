import { getVaultMeta } from './firestore.js';
import { deriveKey, checkVerifier, encrypt, decrypt } from './crypto.js';
import { VaultLockedError, VaultNotInitializedError } from './errors.js';
import type { EncryptedField } from './types.js';
import type { Firestore } from 'firebase/firestore';

/**
 * Ported from scync-cli `src/core/vault-session.ts` with the background-agent
 * code (AgentClient) removed entirely: the desktop app is its own long-lived
 * process, and the in-process non-extractable CryptoKey IS the session.
 */
export interface VaultSession {
  uid: string;
  salt: string;
  key?: CryptoKey;
  decrypt(ciphertext: EncryptedField): Promise<string>;
  encrypt(plaintext: string): Promise<EncryptedField>;
  batchDecrypt(ciphertexts: EncryptedField[]): Promise<string[]>;
}

export interface UnlockVaultOptions {
  passwordOverride?: string;
}

export async function unlockVault(
  uid: string,
  db?: Firestore,
  passwordOverride?: string,
  _options: UnlockVaultOptions = {}
): Promise<VaultSession> {
  const meta = await getVaultMeta(uid, db);
  if (!meta) {
    throw new VaultNotInitializedError();
  }

  const password = passwordOverride;
  if (!password) {
    throw new VaultLockedError('Master password cannot be empty.');
  }

  const key = await deriveKey(password, uid, meta.salt);
  const isValid = await checkVerifier(key, meta.verifier);

  if (!isValid) {
    throw new VaultLockedError('Incorrect master password.');
  }

  return {
    uid,
    salt: meta.salt,
    key,
    decrypt: (ct) => decrypt(key, ct),
    encrypt: (pt) => encrypt(key, pt),
    batchDecrypt: (cts) => Promise.all(cts.map((ct) => decrypt(key, ct))),
  };
}
