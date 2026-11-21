/**
 * Whole-collection onSnapshot subscriptions for every domain, matching the
 * behaviour of the CLI core's `subscribeToSecrets` / `subscribeToLedger`:
 * no orderBy/where — the full collection streams and filtering happens
 * client-side. Ported from the scync web app `packages/core/src/firestore.ts`.
 */
import { collection, onSnapshot } from 'firebase/firestore';
import { getDb } from './firebase.js';
import type {
  StoredSSHKey, StoredTOTP, StoredCertificate,
  StoredPassword, Project, CustomService,
} from './types.js';

export function subscribeToPasswords(
  uid: string,
  callback: (passwords: StoredPassword[]) => void,
): () => void {
  const db = getDb();
  const ref = collection(db, 'users', uid, 'passwords');

  return onSnapshot(ref, (snapshot) => {
    const list = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        name: data.name || data.title || '',
        username: data.username || '',
        url: data.url || '',
        encNotes: data.encNotes ?? null,
        category: data.category || 'General',
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      } as StoredPassword;
    });
    callback(list);
  });
}

export function subscribeToSSHKeys(
  uid: string,
  onUpdate: (keys: StoredSSHKey[]) => void,
): () => void {
  const db = getDb();
  const q = collection(db, 'users', uid, 'ssh_keys');
  return onSnapshot(q, (snapshot) => {
    const keys: StoredSSHKey[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      keys.push({
        id: data.id || doc.id,
        name: data.name,
        type: data.type || 'ssh-rsa',
        publicKey: data.publicKey,
        fingerprint: data.fingerprint,
        encPrivateKey: data.encPrivateKey,
        hosts: data.hosts || [],
        rotationDate: data.rotationDate?.toDate() || null,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      });
    });
    onUpdate(keys);
  });
}

export function subscribeToTOTPs(
  uid: string,
  onUpdate: (tokens: StoredTOTP[]) => void,
): () => void {
  const db = getDb();
  const q = collection(db, 'users', uid, 'totp_tokens');
  return onSnapshot(q, (snapshot) => {
    const tokens: StoredTOTP[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      tokens.push({
        id: data.id || doc.id,
        issuer: data.issuer || '',
        label: data.label || '',
        encSecret: data.encSecret,
        algorithm: data.algorithm || 'SHA1',
        digits: data.digits || 6,
        period: data.period || 30,
        icon: data.icon || '',
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      });
    });
    onUpdate(tokens);
  });
}

export function subscribeToCertificates(
  uid: string,
  onUpdate: (certs: StoredCertificate[]) => void,
): () => void {
  const db = getDb();
  const q = collection(db, 'users', uid, 'certificates');
  return onSnapshot(q, (snapshot) => {
    const certs: StoredCertificate[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      certs.push({
        id: data.id || doc.id,
        name: data.name || '',
        encCertPem: data.encCertPem,
        encKeyPem: data.encKeyPem || null,
        subject: data.subject || '',
        issuer: data.issuer || '',
        serialNumber: data.serialNumber || '',
        validFrom: data.validFrom?.toDate() || new Date(),
        validTo: data.validTo?.toDate() || new Date(),
        isSelfSigned: data.isSelfSigned || false,
        fingerprint: data.fingerprint || '',
        hosts: data.hosts || [],
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      });
    });
    onUpdate(certs);
  });
}

export function subscribeToProjects(
  uid: string,
  callback: (projects: Project[]) => void,
): () => void {
  const db = getDb();
  const projectsRef = collection(db, 'users', uid, 'projects');

  return onSnapshot(projectsRef, (snapshot) => {
    const projects = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        name: data.name || '',
        color: data.color || 'blue',
        icon: data.icon || '',
        description: data.description || '',
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      } as Project;
    });
    callback(projects);
  });
}

export function subscribeToServices(
  uid: string,
  callback: (services: CustomService[]) => void,
): () => void {
  const db = getDb();
  const servicesRef = collection(db, 'users', uid, 'services');

  return onSnapshot(servicesRef, (snapshot) => {
    const services = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        name: data.name || '',
        color: data.color || 'blue',
        icon: data.icon || '',
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      } as CustomService;
    });
    callback(services);
  });
}
