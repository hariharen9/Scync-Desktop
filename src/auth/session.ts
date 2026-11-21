/**
 * Webview-side auth glue. Calls Rust for the Google loopback flow and the
 * Firebase JS SDK for everything auth-related. The uid produced here feeds
 * key derivation, so it must be byte-identical to the web app's uid.
 */
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithCredential,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { ensureAuthReady, getAuthInstance, getGoogleClientConfig, isGoogleLoginEnabled } from '@/backend/firebase.js';
import { bridge } from './bridge.js';

let started = false;

/** Listen for Firebase auth changes. Resolves immediately, emits via callback. */
export function watchAuth(callback: (user: User | null) => void): () => void {
  if (!started) {
    started = true;
    ensureAuthReady().catch((e: unknown) => console.warn('auth init failed', e));
  }
  return onAuthStateChanged(getAuthInstance(), callback);
}

/** Google: loopback OAuth in Rust → signInWithCredential. */
export async function signInWithGoogle(): Promise<User> {
  if (!isGoogleLoginEnabled()) {
    throw new Error(
      'Google sign-in is not configured in this build. Use email/password sign-in, or rebuild with SCYNC_GOOGLE_CLIENT_ID / SCYNC_GOOGLE_CLIENT_SECRET set.'
    );
  }
  const { clientId, clientSecret } = getGoogleClientConfig();
  const tokens = await bridge.googleSignIn(clientId, clientSecret);
  const credential = GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
  const cred = await signInWithCredential(getAuthInstance(), credential);
  return cred.user;
}

/** Email/password sign-in (the CLI's login.ts equivalent). */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const trimmed = email.trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(getAuthInstance(), trimmed, password);
  return cred.user;
}

/** Sign-out clears the Firebase session; the vault keyhandoff is store-side. */
export async function signOut(): Promise<void> {
  await fbSignOut(getAuthInstance());
}
