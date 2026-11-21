import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';import { getAuth, type Auth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, type Firestore, connectFirestoreEmulator } from 'firebase/firestore';

/**
 * Public configuration for the hosted Scync backend.
 *
 * Firebase web config is not a secret — it ships in every browser that loads
 * the web app. It identifies the project; it does not grant access. Real
 * authorization comes from Firebase Auth, and real confidentiality comes from
 * the zero-knowledge vault encryption.
 *
 * The desktop app bakes HOSTED_CONFIG at build time (same values as the CLI's
 * `src/core/firebase.ts`) and lets self-hosters override every field through
 * `scync-desktop.json` in the Tauri app-config directory (resolved via the
 * `get_backend_config` Tauri command).
 */
export const HOSTED_CONFIG = {
  apiKey: 'AIzaSyDubqBg3OWE9uwTKZI_tQpVF7CK7J3d2xo',
  authDomain: 'scync-app.firebaseapp.com',
  projectId: 'scync-app',
  storageBucket: 'scync-app.firebasestorage.app',
  messagingSenderId: '989519172211',
  appId: '1:989519172211:web:bfd70bddc93b0705991006',
} as const;

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  useEmulators?: boolean;
  authEmulatorUrl?: string;
  firestoreEmulatorHost?: string;
  firestoreEmulatorPort?: number;
}

/**
 * Google OAuth Desktop client for the loopback (PKCE) flow.
 *
 * Generated at build time by `scripts/generate-google-client.mjs` from
 * SCYNC_GOOGLE_CLIENT_ID / SCYNC_GOOGLE_CLIENT_SECRET env vars (git-ignored,
 * GitHub push protection flags the values even for installed-app clients).
 * Empty strings simply mean Google sign-in is disabled with a clear message.
 */
import { BUNDLED_GOOGLE_CLIENT_ID, BUNDLED_GOOGLE_CLIENT_SECRET } from '../generated/google-client.js';

export function getGoogleClientConfig(): { clientId: string; clientSecret: string } {
  return {
    clientId: BUNDLED_GOOGLE_CLIENT_ID,
    clientSecret: BUNDLED_GOOGLE_CLIENT_SECRET,
  };
}

/** Google sign-in is available only when a client id was injected at build time. */
export function isGoogleLoginEnabled(): boolean {
  return getGoogleClientConfig().clientId.length > 0;
}

/** True when talking to the shared hosted Scync project rather than a self-host. */
export function isHostedBackend(config: FirebaseClientConfig): boolean {
  return config.projectId === HOSTED_CONFIG.projectId;
}

let currentAuth: Auth | null = null;
let currentDb: Firestore | null = null;
let currentConfig = { ...HOSTED_CONFIG } as FirebaseClientConfig;

/**
 * Merge build-time hosted config with overrides. Two sources, in order of
 * precedence: `initFirebase({ ... })` arguments (used by tests/emulator setup)
 * and the Tauri app-config file via `get_backend_config` (self-hosters).
 */
export function mergeConfig(overrides: Partial<FirebaseClientConfig> = {}): FirebaseClientConfig {
  return { ...currentConfig, ...overrides };
}

export function setBaseConfig(config: Partial<FirebaseClientConfig>): void {
  currentConfig = { ...HOSTED_CONFIG, ...config };
}

export function initFirebase(config: Partial<FirebaseClientConfig> = {}): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} {
  const merged = mergeConfig(config);

  const app = getApps().length === 0
    ? initializeApp({
        apiKey: merged.apiKey,
        authDomain: merged.authDomain,
        projectId: merged.projectId,
        storageBucket: merged.storageBucket,
        messagingSenderId: merged.messagingSenderId,
        appId: merged.appId,
      })
    : getApp();

  // Firebase JS SDK default: IndexedDB persistence (browserSessionPersistence
  // would lose the session on every window re-create; default browserPersistence
  // keeps the signed-in user across restarts of the desktop app).
  const auth = getAuth(app);
  const db = getFirestore(app);

  if (merged.useEmulators) {
    try {
      connectAuthEmulator(auth, merged.authEmulatorUrl || 'http://127.0.0.1:9099', { disableWarnings: true });
    } catch (_) {
      // already connected
    }
    try {
      connectFirestoreEmulator(db, merged.firestoreEmulatorHost || '127.0.0.1', merged.firestoreEmulatorPort || 8080);
    } catch (_) {
      // already connected
    }
  }

  currentAuth = auth;
  currentDb = db;

  return { app, auth, db };
}

export function getDb(): Firestore {
  if (!currentDb) {
    return initFirebase().db;
  }
  return currentDb;
}

export function getAuthInstance(): Auth {
  if (!currentAuth) {
    return initFirebase().auth;
  }
  return currentAuth;
}

export async function ensureAuthReady(): Promise<Auth> {
  const auth = getAuthInstance();
  if (typeof (auth as any).authStateReady === 'function') {
    await (auth as any).authStateReady();
  }
  return auth;
}

export async function closeFirebase(): Promise<void> {
  if (currentDb) {
    try {
      const { terminate } = await import('firebase/firestore');
      await terminate(currentDb);
    } catch (_) {}
    currentDb = null;
  }
}
