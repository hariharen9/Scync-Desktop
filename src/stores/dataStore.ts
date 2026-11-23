/**
 * dataStore — ciphertext-only mirrors of every Firestore collection.
 *
 * subscribes with whole-collection onSnapshot (no queries) exactly like the
 * web app and CLI; all filtering/sorting happens client-side in the UI.
 * Plaintext is NEVER stored here: every decrypt action is on demand and
 * throws "Vault is locked" when the key is gone.
 */
import { create } from 'zustand';
import {
  getDb,
  subscribeToSecrets,
  subscribeToPasswords,
  subscribeToSSHKeys,
  subscribeToTOTPs,
  subscribeToCertificates,
  subscribeToProjects,
  subscribeToServices,
  subscribeToUserShares,
  createSecret,
  updateSecret,
  deleteSecret,
  decryptSecret,
  createSSHKey,
  deleteSSHKey,
  updateSSHKey,
  createTOTP,
  deleteTOTP,
  updateTOTP,
  createCertificate,
  deleteCertificate,
  updateCertificateMetadata,
  createPassword,
  updatePassword,
  deletePassword,
  decryptPasswordItem,
  createProject,
  updateProject,
  deleteProject,
  createService,
  updateService,
  deleteService,
  createShare,
  revokeShare,
  generateTOTPCode,
  getRemainingSeconds,
  ConflictError,
  VaultLockedError,
} from '@/backend/index.js';
import { requireKey, useVaultStore } from './vaultStore.js';
import type {
  StoredSecret, SecretFormData, DecryptedSecret,
  StoredPassword, PasswordFormData, DecryptedPassword,
  StoredSSHKey, StoredTOTP, StoredCertificate,
  Project, CustomService, ShareDocument, TOTPConfig,
} from '@/backend/index.js';

export interface DomainState {
  secrets: StoredSecret[];
  passwords: StoredPassword[];
  sshKeys: StoredSSHKey[];
  totpTokens: StoredTOTP[];
  certificates: StoredCertificate[];
  projects: Project[];
  services: CustomService[];
  shares: ShareDocument[];
}

/** Domains whose first onSnapshot has arrived (drives skeletons vs empty). */
export interface LoadedState {
  secrets: boolean;
  passwords: boolean;
  sshKeys: boolean;
  totpTokens: boolean;
  certificates: boolean;
  projects: boolean;
  services: boolean;
  shares: boolean;
}

interface DataState extends DomainState {
  subscriptionsReady: boolean;
  loaded: LoadedState;
  subscribeAll: (uid: string) => () => void;
  unsubscribeAll: () => void;
  clearAll: () => void;

  // Decryption helpers (on demand; throw when locked)
  decryptSecretById: (id: string) => Promise<DecryptedSecret>;
  decryptPasswordById: (id: string) => Promise<DecryptedPassword>;
  decryptSshPrivate: (id: string) => Promise<string>;
  decryptSshPublic: (id: string) => Promise<string>;
  decryptCertById: (id: string) => Promise<{ certPem: string; keyPem: string | null }>;
  totpCodeFor: (id: string) => Promise<{ code: string; remaining: number }>;

  // Writes
  writeSecret: (formData: SecretFormData, id?: string, previousSecret?: StoredSecret) => Promise<void>;
  removeSecret: (id: string, name?: string, service?: string) => Promise<void>;
  writePassword: (formData: PasswordFormData, id?: string) => Promise<void>;
  removePassword: (id: string) => Promise<void>;
  writeSshKey: (data: { name: string; type: string; publicKey: string; fingerprint: string; privateKey: string; hosts?: string[] }) => Promise<void>;
  removeSshKey: (id: string) => Promise<void>;
  updateSshKeyMeta: (id: string, data: { name?: string; hosts?: string[]; rotationDate?: Date | null }) => Promise<void>;
  writeTotp: (data: { issuer: string; label: string; secret: string; algorithm?: 'SHA1' | 'SHA256' | 'SHA512'; digits?: 6 | 8; period?: 30 | 60 }, id?: string) => Promise<void>;
  updateTotpMeta: (data: { issuer: string; label: string; algorithm?: 'SHA1' | 'SHA256' | 'SHA512'; digits?: 6 | 8; period?: 30 | 60 }, id: string) => Promise<void>;
  removeTotp: (id: string) => Promise<void>;
  writeCertificate: (data: {
    name: string; subject: string; issuer: string; serialNumber: string;
    validFrom: Date; validTo: Date; isSelfSigned: boolean; fingerprint: string;
    hosts: string[]; certPem: string; keyPem: string | null;
  }) => Promise<void>;
  removeCertificate: (id: string) => Promise<void>;
  updateCertMeta: (id: string, data: { name?: string; hosts?: string[] }) => Promise<void>;
  writeProject: (data: { name: string; color: Project['color']; icon: string; description: string }, id?: string) => Promise<void>;
  removeProject: (id: string, moveSecretsTo: string | null) => Promise<number>;
  writeService: (data: { name: string; color: CustomService['color']; icon: string }, id?: string) => Promise<void>;
  removeService: (id: string) => Promise<void>;

  // Sharing
  shareSecret: (config: Parameters<typeof createShare>[1]) => Promise<string>;
  removeShare: (shareId: string) => Promise<void>;

  // Quick-search support: metadata-only entries for the popup
  metaIndex: () => QuickSearchItem[];
}

export interface QuickSearchItem {
  id: string;
  kind: 'secret' | 'password' | 'ssh' | 'totp' | 'cert';
  name: string;
  service: string;
  environment: string;
  project: string;
  status: string;
  /** Sort key for the popup's "recent" list (epoch ms). */
  updatedAt?: number;
}

const EMPTY: DomainState = {
  secrets: [],
  passwords: [],
  sshKeys: [],
  totpTokens: [],
  certificates: [],
  projects: [],
  services: [],
  shares: [],
};

const NOT_LOADED: LoadedState = {
  secrets: false,
  passwords: false,
  sshKeys: false,
  totpTokens: false,
  certificates: false,
  projects: false,
  services: false,
  shares: false,
};

let unsubscribers: Array<() => void> = [];

function assertUnlocked(): CryptoKey {
  try {
    return requireKey();
  } catch {
    throw new VaultLockedError('Vault is locked');
  }
}

export const useDataStore = create<DataState>((set, get) => ({
  ...EMPTY,
  subscriptionsReady: false,
  loaded: { ...NOT_LOADED },

  subscribeAll: (uid) => {
    // Tear down any previous round of subscriptions before re-subscribing.
    get().unsubscribeAll();
    const db = getDb();
    void db;

    const makeSetter = <K extends keyof DomainState>(key: K) =>
      (items: DomainState[K]) => set({
        [key]: items,
        loaded: { ...get().loaded, [key]: true },
      } as unknown as Partial<DataState>);

    unsubscribers = [
      subscribeToSecrets(uid, makeSetter('secrets')),
      subscribeToPasswords(uid, makeSetter('passwords')),
      subscribeToSSHKeys(uid, makeSetter('sshKeys')),
      subscribeToTOTPs(uid, makeSetter('totpTokens')),
      subscribeToCertificates(uid, makeSetter('certificates')),
      subscribeToProjects(uid, makeSetter('projects')),
      subscribeToServices(uid, makeSetter('services')),
      subscribeToUserShares(uid, makeSetter('shares')),
    ];

    set({ subscriptionsReady: true });

    return () => get().unsubscribeAll();
  },

  unsubscribeAll: () => {
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch (_) {
        // already gone
      }
    }
    unsubscribers = [];
    set({ subscriptionsReady: false, loaded: { ...NOT_LOADED } });
  },

  clearAll: () => set({ ...EMPTY, loaded: { ...NOT_LOADED } }),

  decryptSecretById: async (id) => {
    const stored = get().secrets.find((s) => s.id === id);
    if (!stored) throw new Error('Secret not found');
    return decryptSecret(assertUnlocked(), stored);
  },

  decryptPasswordById: async (id) => {
    const stored = get().passwords.find((p) => p.id === id);
    if (!stored) throw new Error('Password entry not found');
    return decryptPasswordItem(assertUnlocked(), stored);
  },

  decryptSshPrivate: async (id) => {
    const { decrypt } = await import('@/backend/crypto.js');
    const stored = get().sshKeys.find((k) => k.id === id);
    if (!stored) throw new Error('SSH key not found');
    return decrypt(assertUnlocked(), stored.encPrivateKey);
  },

  decryptSshPublic: async (id) => {
    const stored = get().sshKeys.find((k) => k.id === id);
    if (!stored) throw new Error('SSH key not found');
    return stored.publicKey; // public key is plaintext metadata
  },

  decryptCertById: async (id) => {
    const { decrypt } = await import('@/backend/crypto.js');
    const stored = get().certificates.find((c) => c.id === id);
    if (!stored) throw new Error('Certificate not found');
    const key = assertUnlocked();
    const certPem = await decrypt(key, stored.encCertPem);
    const keyPem = stored.encKeyPem ? await decrypt(key, stored.encKeyPem) : null;
    return { certPem, keyPem };
  },

  totpCodeFor: async (id) => {
    const { decrypt } = await import('@/backend/crypto.js');
    const stored = get().totpTokens.find((t) => t.id === id);
    if (!stored) throw new Error('TOTP token not found');
    const secret = await decrypt(assertUnlocked(), stored.encSecret);
    return {
      code: generateTOTPCode({
        issuer: stored.issuer,
        label: stored.label,
        secret,
        algorithm: stored.algorithm,
        digits: stored.digits,
        period: stored.period,
      }),
      remaining: getRemainingSeconds(stored.period),
    };
  },

  writeSecret: async (formData, id, previousSecret) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    const key = assertUnlocked();
    if (id) {
      await updateSecret(uid, key, id, formData, previousSecret);
    } else {
      await createSecret(uid, key, formData);
    }
  },

  removeSecret: async (id, name, service) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await deleteSecret(uid, id, name, service);
  },

  writePassword: async (formData, id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    const key = assertUnlocked();
    if (id) await updatePassword(uid, key, id, formData);
    else await createPassword(uid, key, formData);
  },

  removePassword: async (id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await deletePassword(uid, id);
  },

  writeSshKey: async (data) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await createSSHKey(uid, assertUnlocked(), data);
  },

  removeSshKey: async (id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await deleteSSHKey(uid, id);
  },

  updateSshKeyMeta: async (id, data) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await updateSSHKey(uid, id, data);
  },

  writeTotp: async (data, id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    if (id) await updateTOTP(uid, assertUnlocked(), id, data);
    else await createTOTP(uid, assertUnlocked(), data);
  },

  removeTotp: async (id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await deleteTOTP(uid, id);
  },

  updateTotpMeta: async (data, id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await updateTOTP(uid, assertUnlocked(), id, data);
  },

  writeCertificate: async (data) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await createCertificate(uid, assertUnlocked(), data);
  },

  removeCertificate: async (id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await deleteCertificate(uid, id);
  },

  updateCertMeta: async (id, data) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await updateCertificateMetadata(uid, id, data);
  },

  writeProject: async (data, id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    if (id) await updateProject(uid, id, data);
    else await createProject(uid, data);
  },

  removeProject: async (id, moveSecretsTo) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    return deleteProject(uid, id, moveSecretsTo);
  },

  writeService: async (data, id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    if (id) await updateService(uid, id, data);
    else await createService(uid, data);
  },

  removeService: async (id) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    await deleteService(uid, id);
  },

  shareSecret: async (config) => {
    const uid = useVaultStore.getState().uid;
    if (!uid) throw new VaultLockedError('No signed-in user');
    return createShare(uid, config);
  },

  removeShare: async (shareId) => {
    await revokeShare(shareId);
  },

  metaIndex: () => {
    const s = get();
    const projectName = (id: string | null) =>
      id ? s.projects.find((p) => p.id === id)?.name ?? '' : '';

    const items: QuickSearchItem[] = [];
    for (const secret of s.secrets) {
      items.push({
        id: secret.id,
        kind: 'secret',
        name: secret.name,
        service: secret.service,
        environment: secret.environment,
        project: projectName(secret.projectId),
        status: secret.status,
        updatedAt: secret.updatedAt.getTime(),
      });
    }
    for (const pw of s.passwords) {
      items.push({
        id: pw.id,
        kind: 'password',
        name: pw.name,
        service: pw.category,
        environment: '',
        project: '',
        status: '',
        updatedAt: pw.updatedAt.getTime(),
      });
    }
    for (const k of s.sshKeys) {
      items.push({
        id: k.id,
        kind: 'ssh',
        name: k.name,
        service: k.type,
        environment: k.hosts.join(' '),
        project: '',
        status: '',
        updatedAt: k.updatedAt.getTime(),
      });
    }
    for (const t of s.totpTokens) {
      items.push({
        id: t.id,
        kind: 'totp',
        name: t.label || t.issuer,
        service: t.issuer,
        environment: '',
        project: '',
        status: '',
        updatedAt: t.updatedAt.getTime(),
      });
    }
    for (const c of s.certificates) {
      items.push({
        id: c.id,
        kind: 'cert',
        name: c.name,
        service: c.issuer,
        environment: c.hosts.join(' '),
        project: '',
        status: '',
        updatedAt: c.updatedAt.getTime(),
      });
    }
    return items;
  },
}));

export type { ShareDocument, TOTPConfig };

// Write-path failures surface as ConflictError (concurrent edit) — leave the
// message handling to the UI layer. Never swallow: data correctness first.
export { ConflictError };
