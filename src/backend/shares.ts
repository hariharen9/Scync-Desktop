/**
 * Zero-knowledge share links, ported from the scync web app
 * `packages/core/src/firestore.ts` (createShare / fetchUserShares /
 * subscribeToUserShares / revokeShare / consumeShare).
 *
 * Deliberate deviation: `createShare` always returns an
 * `https://scync.space/share/...` URL. The web app uses `window.location.origin`
 * when one exists; inside the desktop webview that origin would be the Tauri
 * local origin, which no recipient could open. The scync.space web app is and
 * remains the consumer side of a share link.
 */
import {
  collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, serverTimestamp,
  query, where, runTransaction, Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase.js';
import { generateShareKey, exportShareKey, importShareKey } from './share-keys.js';
import { encrypt as encryptWithKey, decrypt as decryptWithKey } from './crypto.js';
import type { ShareDocument, ShareConfig, DecryptedShare } from './types.js';

/** Create a shareable link for a secret; the share key travels in the URL fragment. */
export async function createShare(uid: string, config: ShareConfig): Promise<string> {
  const db = getDb();

  // Generate a fresh share key (independent of vault key)
  const shareKey = await generateShareKey();

  // Encrypt the secret value with the share key
  const encValue = await encryptWithKey(shareKey, config.value);

  // Calculate expiry timestamp
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + config.expiryHours);

  // Create share document
  const shareRef = doc(collection(db, 'shares'));
  const shareDoc: Omit<ShareDocument, 'id'> = {
    encValue,
    secretName: config.secretName,
    service: config.service,
    type: config.type,
    expiresAt,
    viewsAllowed: config.viewsAllowed,
    viewsUsed: 0,
    createdByUid: uid,
    projectId: config.projectId,
    createdAt: new Date(),
  };

  await setDoc(shareRef, {
    ...shareDoc,
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: serverTimestamp(),
  });

  // Export the share key to base64url
  const keyFragment = await exportShareKey(shareKey);

  return `https://scync.space/share/${shareRef.id}#${keyFragment}`;
}

/** Fetch all shares created by a user (metadata only; creator can read own docs). */
export async function fetchUserShares(uid: string): Promise<ShareDocument[]> {
  const db = getDb();
  const q = query(collection(db, 'shares'), where('createdByUid', '==', uid));

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      encValue: data.encValue,
      secretName: data.secretName,
      service: data.service,
      type: data.type,
      expiresAt: data.expiresAt?.toDate() || new Date(),
      viewsAllowed: data.viewsAllowed,
      viewsUsed: data.viewsUsed,
      createdByUid: data.createdByUid,
      projectId: data.projectId,
      createdAt: data.createdAt?.toDate() || new Date(),
    };
  });
}

/** Subscribe to user's shares in real-time. */
export function subscribeToUserShares(uid: string, callback: (shares: ShareDocument[]) => void): () => void {
  const db = getDb();
  const q = query(collection(db, 'shares'), where('createdByUid', '==', uid));

  return onSnapshot(q, snapshot => {
    const shares = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        encValue: data.encValue,
        secretName: data.secretName,
        service: data.service,
        type: data.type,
        expiresAt: data.expiresAt?.toDate() || new Date(),
        viewsAllowed: data.viewsAllowed,
        viewsUsed: data.viewsUsed,
        createdByUid: data.createdByUid,
        projectId: data.projectId,
        createdAt: data.createdAt?.toDate() || new Date(),
      };
    });
    callback(shares);
  });
}

/** Revoke a share (delete the document). Creator only, enforced by rules. */
export async function revokeShare(shareId: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'shares', shareId));
}

/**
 * Consume a share link (recipient side).
 * Read → validate → decrypt → atomic viewsUsed increment, in a transaction so
 * a wrong key or exhausted share burns no view.
 *
 * NOTE (desktop): consuming share links normally happens in the recipient's
 * browser on scync.space. This function is provided for completeness/testing;
 * the desktop UI does not open foreign share links.
 */
export async function consumeShare(shareId: string, keyFragment: string): Promise<DecryptedShare> {
  const db = getDb();
  const shareKey = await importShareKey(keyFragment);
  const shareRef = doc(db, 'shares', shareId);

  return runTransaction(db, async (tx) => {
    const shareSnap = await tx.get(shareRef);

    if (!shareSnap.exists()) {
      throw new Error('SHARE_NOT_FOUND');
    }

    const data = shareSnap.data();
    const now = new Date();
    const expiresAt = data.expiresAt?.toDate() || new Date(0);

    if (expiresAt < now) {
      throw new Error('SHARE_EXPIRED');
    }

    const viewsAllowed = data.viewsAllowed !== undefined && data.viewsAllowed !== null
      ? data.viewsAllowed
      : null;
    const viewsUsed = data.viewsUsed || 0;
    if (viewsAllowed !== null && viewsUsed >= viewsAllowed) {
      throw new Error('SHARE_CONSUMED');
    }

    const value = await decryptWithKey(shareKey, data.encValue);

    tx.update(shareRef, {
      viewsUsed: viewsUsed + 1,
    });

    return {
      secretName: data.secretName,
      service: data.service,
      type: data.type,
      value,
      viewsRemaining: viewsAllowed !== null ? viewsAllowed - (viewsUsed + 1) : null,
      expiresAt,
    };
  });
}
