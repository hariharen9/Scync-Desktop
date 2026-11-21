/**
 * CRUD + subscription helpers for the domains the CLI core only reads.
 *
 * Ported from the scync web app `packages/core/src/firestore.ts` unchanged in
 * write shape (same fields, same serverTimestamp usage, same whole-collection
 * onSnapshot subscriptions with client-side filtering). The CLI core already
 * provides reads + creates for ssh_keys / totp_tokens and reads for
 * passwords / certificates; this module fills the gaps the desktop UI needs.
 */
import {
  collection, doc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { getDb } from './firebase.js';
import { encrypt, decrypt } from './crypto.js';
import type {
  StoredPassword, DecryptedPassword, PasswordFormData,
} from './types.js';

// ─── Update ssh / totp / certificate (web app supports edits; CLI only creates) ───

export async function updateTOTP(
  uid: string,
  key: CryptoKey,
  id: string,
  data: { issuer: string; label: string; secret?: string; algorithm?: 'SHA1' | 'SHA256' | 'SHA512'; digits?: 6 | 8; period?: 30 | 60 },
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'totp_tokens', id);
  const updates: Record<string, any> = {
    issuer: data.issuer,
    label: data.label,
    algorithm: data.algorithm || 'SHA1',
    digits: data.digits || 6,
    period: data.period || 30,
    updatedAt: serverTimestamp(),
  };
  if (data.secret !== undefined) {
    updates.encSecret = await encrypt(key, data.secret);
  }
  await updateDoc(ref, updates);
}

export interface CertificateFormData {
  name: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  isSelfSigned: boolean;
  fingerprint: string;
  hosts: string[];
  certPem: string;
  keyPem: string | null;
}

export async function createCertificate(
  uid: string,
  key: CryptoKey,
  data: CertificateFormData,
): Promise<void> {
  const db = getDb();
  const certsRef = collection(db, 'users', uid, 'certificates');
  const newRef = doc(certsRef);

  const encCertPem = await encrypt(key, data.certPem);
  const encKeyPem = data.keyPem ? await encrypt(key, data.keyPem) : null;

  await setDoc(newRef, {
    id: newRef.id,
    name: data.name,
    encCertPem,
    encKeyPem,
    subject: data.subject,
    issuer: data.issuer,
    serialNumber: data.serialNumber,
    validFrom: data.validFrom,
    validTo: data.validTo,
    isSelfSigned: data.isSelfSigned,
    fingerprint: data.fingerprint,
    hosts: data.hosts,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCertificate(uid: string, certId: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'users', uid, 'certificates', certId));
}

// ─── Passwords CRUD (web-app write shapes) ───

export async function createPassword(
  uid: string,
  key: CryptoKey,
  formData: PasswordFormData,
): Promise<void> {
  const db = getDb();
  const ref = collection(db, 'users', uid, 'passwords');
  const newRef = doc(ref);

  const encPassword = await encrypt(key, formData.password);
  const encNotes = formData.notes ? await encrypt(key, formData.notes) : null;

  const stored: StoredPassword = {
    id: newRef.id,
    name: formData.name,
    username: formData.username,
    url: formData.url,
    category: formData.category,
    encPassword,
    encNotes,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await setDoc(newRef, {
    ...stored,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updatePassword(
  uid: string,
  key: CryptoKey,
  id: string,
  formData: PasswordFormData,
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'passwords', id);

  const encPassword = await encrypt(key, formData.password);
  const encNotes = formData.notes ? await encrypt(key, formData.notes) : null;

  await updateDoc(ref, {
    name: formData.name,
    username: formData.username,
    url: formData.url,
    category: formData.category,
    encPassword,
    encNotes,
    updatedAt: serverTimestamp(),
  });
}

export async function deletePassword(uid: string, id: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'users', uid, 'passwords', id));
}

export async function decryptPasswordItem(
  key: CryptoKey,
  stored: StoredPassword,
): Promise<DecryptedPassword> {
  const password = await decrypt(key, stored.encPassword);
  const notes = stored.encNotes ? await decrypt(key, stored.encNotes) : '';

  const { encPassword, encNotes, ...rest } = stored;

  return {
    ...rest,
    password,
    notes,
  };
}

// ─── Update ssh key metadata (name/hosts/rotationDate) ───

export async function updateSSHKey(
  uid: string,
  id: string,
  data: { name?: string; hosts?: string[]; rotationDate?: Date | null },
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'ssh_keys', id);
  const updates: Record<string, any> = { updatedAt: serverTimestamp() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.hosts !== undefined) updates.hosts = data.hosts;
  if (data.rotationDate !== undefined) updates.rotationDate = data.rotationDate;
  await updateDoc(ref, updates);
}

// ─── Update certificate metadata (name/hosts) ───

export async function updateCertificateMetadata(
  uid: string,
  id: string,
  data: { name?: string; hosts?: string[] },
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'certificates', id);
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// ─── Custom services ───
// Copied verbatim from the web app's packages/core/src/firestore.ts so both
// clients write identical document shapes to `users/{uid}/services`.

export async function createService(
  uid: string,
  data: { name: string; color: string; icon: string },
): Promise<void> {
  const db = getDb();
  const servicesRef = collection(db, 'users', uid, 'services');
  const newRef = doc(servicesRef);

  await setDoc(newRef, {
    ...data,
    id: newRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateService(
  uid: string,
  serviceId: string,
  data: { name?: string; color?: string; icon?: string },
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'services', serviceId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

export async function deleteService(uid: string, serviceId: string): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'users', uid, 'services', serviceId);
  await deleteDoc(ref);
}
