/**
 * Vendored Scync backend — the ONLY place the vault key's crypto and the
 * Firestore contract are touched. UI code calls stores, stores call this.
 *
 * See PROVENANCE.md for exactly what each file was copied/port from and list
 * of deliberate deviations.
 */
export * from './types.js';
export * from './crypto.js';
export * from './share-keys.js';
export * from './constants.js';
export * from './firebase.js';
export * from './firestore.js';
export * from './subscriptions.js';
export * from './domains.js';
export * from './shares.js';
export * from './totp.js';
export * from './ssh.js';
export * from './certificates.js';
export * from './vault-session.js';
export * from './errors.js';
export * from './utils.js';
