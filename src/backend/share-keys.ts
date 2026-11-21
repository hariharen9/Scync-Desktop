/**
 * Zero-knowledge share keys, ported byte-for-byte from the scync web app
 * `packages/core/src/crypto.ts` (generateShareKey / exportShareKey /
 * importShareKey). Kept in their own module so `crypto.ts` (the vault-only
 * crypto entry point, copied unchanged from the CLI) stays byte-identical.
 */
import { bufferToBase64Url, base64UrlToBuffer } from './crypto.js';

/**
 * Generate a fresh extractable AES-256-GCM-256 share key,
 * independent of the vault key.
 */
export async function generateShareKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — we need to export it for the URL fragment
    ['encrypt', 'decrypt']
  );
}

/** Export a share key to base64url format for the URL fragment. */
export async function exportShareKey(key: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64Url(rawKey);
}

/** Import a share key from a base64url URL fragment (non-extractable, decrypt-only). */
export async function importShareKey(base64urlKey: string): Promise<CryptoKey> {
  const rawKey = base64UrlToBuffer(base64urlKey);
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable after import
    ['decrypt']
  );
}
