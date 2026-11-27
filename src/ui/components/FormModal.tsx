/**
 * FormModal — create/edit for every domain (secret, password, ssh key, TOTP,
 * certificate, project, service). All encrypted writes funnel through
 * dataStore write helpers; plaintext only lives in local form state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import forge from 'node-forge';
import { FiX } from 'react-icons/fi';
import { useUiStore, type Environment, type SecretStatus, type SecretType, type ProjectColor } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import {
  SERVICES, SECRET_TYPES, ENVIRONMENTS, STATUSES,
  generateSSHKeyPair, parseSSHPrivateKey, looksLikeSSHPrivateKey,
  computeOpenSSHFingerprint, detectSSHKeyType,
  parseCertificatePem, validateCertKeyPair,
} from '@/backend/index.js';
import { pushToast } from './Toast.js';
import { useEscape } from './primitives.js';

const PROJECT_COLORS: ProjectColor[] = ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'yellow', 'gray'];
const COLOR_HEX: Record<ProjectColor, string> = {
  violet: '#8b5cf6', blue: '#3b82f6', green: '#10b981', orange: '#f97316',
  red: '#ef4444', pink: '#ec4899', yellow: '#eab308', gray: '#6b7280',
};

function toDateInputValue(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromDateInputValue(v: string): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mono-label block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted block mt-1">{hint}</span>}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export default function FormModal() {
  const formModal = useUiStore((s) => s.formModal);
  const closeForm = useUiStore((s) => s.closeForm);
  const { kind, id } = formModal;
  const open = kind !== null;
  const editing = id !== null && id !== '';
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmOpen = useUiStore((s) => s.confirm !== null);

  // Esc closes the form, but not while a confirm sits above it.
  useEscape(open && !confirmOpen, closeForm);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('input, textarea, select');
      el?.focus();
    }, 40);
    return () => clearTimeout(t);
  }, [open, kind]);

  if (!open) return null;
  return (
    <div className="modal-overlay !items-start !pt-[8vh] overflow-y-auto" onClick={() => closeForm()}>
      <div ref={panelRef} className="modal-panel card w-full max-w-lg p-5 anim-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <button
            className="icon-btn absolute -right-1 -top-1 !w-7 !h-7"
            onClick={closeForm}
            aria-label="Close"
          >
            <FiX size={14} />
          </button>
          {kind === 'secret' && <SecretForm id={editing ? id : null} onDone={closeForm} />}
          {kind === 'password' && <PasswordForm id={editing ? id : null} onDone={closeForm} />}
          {kind === 'ssh' && <SshForm id={editing ? id : null} onDone={closeForm} />}
          {kind === 'totp' && <TotpForm id={editing ? id : null} onDone={closeForm} />}
          {kind === 'cert' && <CertForm id={editing ? id : null} onDone={closeForm} />}
          {kind === 'project' && <ProjectForm id={editing ? id : null} onDone={closeForm} />}
          {kind === 'service' && <ServiceForm id={editing ? id : null} onDone={closeForm} />}
        </div>
      </div>
    </div>
  );
}

interface FormProps { id: string | null; onDone: () => void }

function ModalHeader({ title }: { title: string }) {
  return <h2 className="font-display font-bold text-[15px] tracking-tight mb-4 pr-6">{title}</h2>;
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="text-[12px] text-rose-400 mt-2 anim-fade-in" role="alert">{error}</div>;
}

function Actions({ busy, canSubmit, label }: { busy: boolean; canSubmit: boolean; label: string }) {
  const closeForm = useUiStore((s) => s.closeForm);
  return (
    <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-border">
      <button type="button" className="btn-ghost" onClick={closeForm} disabled={busy}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
        {busy ? <><span className="spinner" /> Saving…</> : label}
      </button>
    </div>
  );
}

// ─── Secret ───

function generateRandomSecret(type: SecretType): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  if (type === 'Webhook Secret') return `whsec_${hex}`;
  if (type === 'License Key') {
    const upper = hex.slice(0, 20).toUpperCase();
    return `${upper.slice(0, 5)}-${upper.slice(5, 10)}-${upper.slice(10, 15)}-${upper.slice(15, 20)}`;
  }
  return hex;
}

const GENERATABLE_TYPES = new Set<SecretType>([
  'API Key', 'Secret Key', 'Webhook Secret', 'Passphrase', 'Password', 'License Key',
]);

function SecretForm({ id, onDone }: FormProps) {
  const secrets = useDataStore((s) => s.secrets);
  const projects = useDataStore((s) => s.projects);
  const writeSecret = useDataStore((s) => s.writeSecret);
  const openSshImport = useUiStore((s) => s.openSshImport);
  const stored = id ? secrets.find((s) => s.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? '');
  const [service, setService] = useState<string>(stored?.service ?? '');
  const [type, setType] = useState<SecretType>(stored?.type ?? 'API Key');
  const [environment, setEnvironment] = useState<Environment>(stored?.environment ?? 'Development');
  const [status, setStatus] = useState<SecretStatus>(stored?.status ?? 'Active');
  const [value, setValue] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<string>(stored?.projectId ?? '');
  const [lastRotated, setLastRotated] = useState(toDateInputValue(stored?.lastRotated ?? null));
  const [expiresOn, setExpiresOn] = useState(toDateInputValue(stored?.expiresOn ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phraseWords = useMemo(() => {
    if (type !== 'Recovery Phrase') return [];
    return value.trim().split(/[\s,\n]+/).map((w) => w.replace(/^\d+[.):-]\s*/, '').trim()).filter(Boolean);
  }, [type, value]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let effectiveValue = value;
    if (type === 'OAuth Client Secret' && (oauthClientId.trim() || oauthClientSecret.trim())) {
      effectiveValue = JSON.stringify({
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret.trim(),
      });
    } else if (type === 'Recovery Phrase' && effectiveValue.trim()) {
      effectiveValue = phraseWords.join(' ');
    }
    // Editing keeps the stored ciphertext when the value field was left blank.
    if (!editing && !effectiveValue.trim()) { setError('Value is required'); return; }
    setBusy(true);
    try {
      let currentValue = effectiveValue;
      let currentNotes = notes;
      if (editing && stored) {
        const dec = await useDataStore.getState().decryptSecretById(stored.id);
        if (!currentValue) currentValue = dec.value;
        if (!currentNotes) currentNotes = dec.notes;
      }
      await writeSecret(
        {
          name: name.trim(),
          service: service.trim() || 'Other',
          type,
          environment,
          status,
          value: currentValue,
          notes: currentNotes,
          lastRotated: fromDateInputValue(lastRotated),
          expiresOn: fromDateInputValue(expiresOn),
          projectId: projectId || null,
        },
        editing && stored ? stored.id : undefined,
        editing && stored ? stored : undefined,
      );
      pushToast.success(editing ? 'Secret updated' : 'Secret created', name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalHeader title={editing ? 'Edit secret' : 'New secret'} />
      <div className="space-y-3">
        <Row>
          <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Service">
            <input
              className="field"
              list="scync-services-list"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. OpenAI, AWS, Supabase…"
            />
            <datalist id="scync-services-list">
              {SERVICES.map((s) => <option key={s} value={s} />)}
            </datalist>
          </Field>
        </Row>
        <Row>
          <Field label="Type">
            <select className="field" value={type} onChange={(e) => setType(e.target.value as SecretType)}>
              {SECRET_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Environment">
            <select className="field" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
              {ENVIRONMENTS.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Status">
            <select className="field" value={status} onChange={(e) => setStatus(e.target.value as SecretStatus)}>
              {STATUSES.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Project">
            <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— none —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </Row>
        {type === 'OAuth Client Secret' ? (
          <Row>
            <Field label={editing ? 'Client ID (optional)' : 'Client ID'}>
              <input className="field font-mono text-[12px]" value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="client_id…" />
            </Field>
            <Field label={editing ? 'Client Secret (blank keeps current)' : 'Client Secret'}>
              <input className="field font-mono text-[12px]" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} placeholder="client_secret…" />
            </Field>
          </Row>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="mono-label">
                {type === 'Recovery Phrase'
                  ? `Recovery phrase${phraseWords.length > 0 ? ` (${phraseWords.length} words)` : ''}`
                  : editing ? 'Value (leave blank to keep current)' : 'Value'}
              </span>
              {GENERATABLE_TYPES.has(type) && (
                <button
                  type="button"
                  className="text-[11px] font-mono text-accent-light hover:underline"
                  onClick={() => setValue(generateRandomSecret(type))}
                >
                  Generate
                </button>
              )}
            </div>
            <textarea
              className="field font-mono text-[12px]"
              rows={type === 'Recovery Phrase' ? 4 : 3}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={type === 'Recovery Phrase' ? 'Paste 12 or 24 recovery words (spaces, commas, or numbered lines)…' : undefined}
            />
            {looksLikeSSHPrivateKey(value) && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2">
                <span className="text-[11.5px] text-muted">Looks like an SSH / <code className="font-mono">.pem</code> private key.</span>
                <button
                  type="button"
                  className="btn-ghost !py-1 !px-2 text-[11px] text-emerald-300 border-emerald-500/40"
                  onClick={() => openSshImport({ name: name.trim() || undefined, privateKey: value })}
                >
                  Store in SSH Manager
                </button>
              </div>
            )}
          </div>
        )}
        <Field label="Notes"><textarea className="field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Row>
          <Field label="Last rotated"><input type="date" className="field" value={lastRotated} onChange={(e) => setLastRotated(e.target.value)} /></Field>
          <Field label="Expires on"><input type="date" className="field" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></Field>
        </Row>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={name.trim() !== ''} label={editing ? 'Save changes' : 'Create secret'} />
    </form>
  );
}

// ─── Password ───

function PasswordForm({ id, onDone }: FormProps) {
  const passwords = useDataStore((s) => s.passwords);
  const writePassword = useDataStore((s) => s.writePassword);
  const stored = id ? passwords.find((p) => p.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? '');
  const [username, setUsername] = useState(stored?.username ?? '');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(stored?.url ?? '');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState(stored?.category ?? '');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let currentPassword = password;
      let currentNotes = notes;
      if (editing && stored) {
        const dec = await useDataStore.getState().decryptPasswordById(stored.id);
        if (!currentPassword) currentPassword = dec.password;
        if (!currentNotes) currentNotes = dec.notes;
      }
      await writePassword(
        { name: name.trim(), username: username.trim(), password: currentPassword, url: url.trim(), notes: currentNotes, category: category.trim() },
        editing && stored ? stored.id : undefined,
      );
      pushToast.success(editing ? 'Password updated' : 'Password created', name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalHeader title={editing ? 'Edit password' : 'New password'} />
      <div className="space-y-3">
        <Row>
          <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Category"><input className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Personal, Banking…" /></Field>
        </Row>
        <Row>
          <Field label="Username"><input className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
          <Field label="URL"><input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        </Row>
        <Field label={editing ? 'Password (leave blank to keep current)' : 'Password'}>
          <div className="flex gap-2">
            <input className="field flex-1" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <button type="button" className="btn-ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </Field>
        <Field label="Notes"><textarea className="field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={name.trim() !== '' && (password !== '' || editing)} label={editing ? 'Save changes' : 'Create password'} />
    </form>
  );
}

// ─── SSH key ───

function SshForm({ id, onDone }: FormProps) {
  const sshKeys = useDataStore((s) => s.sshKeys);
  const writeSshKey = useDataStore((s) => s.writeSshKey);
  const updateSshKeyMeta = useDataStore((s) => s.updateSshKeyMeta);
  const sshImportPrefill = useUiStore((s) => s.sshImportPrefill);
  const stored = id ? sshKeys.find((k) => k.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? sshImportPrefill?.name ?? '');
  const [hosts, setHosts] = useState(stored?.hosts.join(', ') ?? '');
  const [rotationDate, setRotationDate] = useState(toDateInputValue(stored?.rotationDate ?? null));
  const [pub, setPub] = useState('');
  const [priv, setPriv] = useState(sshImportPrefill?.privateKey ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string | undefined>(undefined);
  const [detectedType, setDetectedType] = useState<string>('');
  const [genType, setGenType] = useState<'ed25519' | 'rsa'>('ed25519');
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive public key, fingerprint, and key type from pasted PEM / OpenSSH private key.
  useEffect(() => {
    if (editing || !priv.trim()) {
      setNeedsPassphrase(false);
      setPassphraseError(undefined);
      return;
    }
    let cancelled = false;
    void parseSSHPrivateKey(priv, passphrase || undefined, name.trim() || undefined).then((parsed) => {
      if (cancelled) return;
      setNeedsPassphrase(parsed.needsPassphrase);
      setPassphraseError(parsed.passphraseError);
      setDetectedType(parsed.type);
      if (parsed.publicKey) {
        setPub(parsed.publicKey);
      }
    });
    return () => { cancelled = true; };
  }, [priv, passphrase, name, editing]);

  const fingerprint = useMemo(() => {
    if (!pub.trim()) return '';
    const sshModule = forge.ssh as unknown as {
      publicKeyFromSSHPubKey?: (s: string) => forge.pki.PublicKey;
    };
    try {
      const parsed = sshModule.publicKeyFromSSHPubKey?.(pub.trim());
      if (parsed) return `MD5:${forge.ssh.getPublicKeyFingerprint(parsed, { encoding: 'hex', delimiter: ':' })}`;
    } catch {
      // Fall back to OpenSSH base64 fingerprint helper
    }
    const fp = computeOpenSSHFingerprint(pub.trim());
    return fp === 'Unknown' ? '' : fp;
  }, [pub]);

  const resolvedType = pub.trim() ? detectSSHKeyType(pub.trim()) : (detectedType || 'ssh-rsa');

  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const pair = await generateSSHKeyPair(name.trim() || 'scync-generated', genType);
      setPub(pair.publicKey);
      setPriv(pair.privateKey);
      setDetectedType(pair.type);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!editing) {
      if (!priv.trim()) { setError('Private key is required'); return; }
      if (needsPassphrase) { setError(passphraseError || 'Passphrase required to decrypt private key'); return; }
    }
    setBusy(true);
    try {
      const hostList = hosts.split(',').map((h) => h.trim()).filter(Boolean);
      if (editing && stored) {
        const patch: { name?: string; hosts?: string[]; rotationDate?: Date | null } = { hosts: hostList };
        if (name.trim() && name.trim() !== stored.name) patch.name = name.trim();
        if (rotationDate !== toDateInputValue(stored.rotationDate)) patch.rotationDate = fromDateInputValue(rotationDate);
        await updateSshKeyMeta(stored.id, patch);
      } else {
        await writeSshKey({
          name: name.trim(),
          type: resolvedType,
          publicKey: pub.trim(),
          fingerprint: fingerprint || 'Unknown',
          privateKey: priv.trim(),
          hosts: hostList,
        });
      }
      pushToast.success(editing ? 'Key updated' : 'SSH key added', name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit}>
        <ModalHeader title="Edit SSH key metadata" />
        <div className="space-y-3">
          <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Hosts (comma-separated)"><input className="field" value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="host1, host2" /></Field>
          <Field label="Rotation due"><input type="date" className="field" value={rotationDate} onChange={(e) => setRotationDate(e.target.value)} /></Field>
        </div>
        <ErrorLine error={error} />
        <Actions busy={busy} canSubmit={name.trim() !== ''} label="Save changes" />
      </form>
    );
  }

  return (
    <form onSubmit={submit}>
      <ModalHeader title="New SSH key" />
      <div className="space-y-3">
        <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Row>
          <Field label="Generate a keypair">
            <div className="flex gap-2">
              <select className="field flex-1" value={genType} onChange={(e) => setGenType(e.target.value as 'ed25519' | 'rsa')}>
                <option value="ed25519">Ed25519</option>
                <option value="rsa">RSA-4096</option>
              </select>
              <button type="button" className="btn-ghost whitespace-nowrap" onClick={generate} disabled={generating}>
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </Field>
          <Field label="Key type (detected)">
            <input className="field" value={resolvedType} readOnly placeholder="—" />
          </Field>
        </Row>
        <Field label="Private key (OpenSSH or PEM — auto-derives public key)">
          <textarea className="field font-mono text-[11px]" rows={3} value={priv} onChange={(e) => setPriv(e.target.value)} />
        </Field>
        {needsPassphrase && (
          <Field label="Key passphrase" hint={passphraseError}>
            <input className="field" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Enter passphrase to derive public key…" />
          </Field>
        )}
        <Field label="Public key (OpenSSH or PEM)" hint={fingerprint ? `Fingerprint: ${fingerprint}` : undefined}>
          <textarea className="field font-mono text-[11px]" rows={3} value={pub} onChange={(e) => setPub(e.target.value)} />
        </Field>
        <Field label="Hosts (comma-separated)"><input className="field" value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="host1, host2" /></Field>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={name.trim() !== ''} label="Add key" />
    </form>
  );
}

// ─── TOTP ───

function TotpForm({ id, onDone }: FormProps) {
  const totpTokens = useDataStore((s) => s.totpTokens);
  const writeTotp = useDataStore((s) => s.writeTotp);
  const stored = id ? totpTokens.find((t) => t.id === id) ?? null : null;
  const editing = stored !== null;

  const [issuer, setIssuer] = useState(stored?.issuer ?? '');
  const [label, setLabel] = useState(stored?.label ?? '');
  const [secret, setSecret] = useState('');
  const [algorithm, setAlgorithm] = useState<'SHA1' | 'SHA256' | 'SHA512'>(stored?.algorithm ?? 'SHA1');
  const [digits, setDigits] = useState<6 | 8>(stored?.digits ?? 6);
  const [period, setPeriod] = useState<30 | 60>(stored?.period ?? 30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!editing && !secret.trim()) { setError('Secret (base32) is required'); return; }
    setBusy(true);
    try {
      const trimmedSecret = secret.replace(/\s+/g, '').toUpperCase();
      if (editing && stored && !trimmedSecret) {
        // Keep the stored secret ciphertext: metadata-only update.
        await useDataStore.getState().updateTotpMeta({
          issuer: issuer.trim(),
          label: label.trim(),
          algorithm,
          digits,
          period,
        }, stored.id);
      } else {
        await writeTotp(
          {
            issuer: issuer.trim(),
            label: label.trim(),
            secret: trimmedSecret,
            algorithm,
            digits,
            period,
          },
          editing && stored ? stored.id : undefined,
        );
      }
      pushToast.success(editing ? 'Token updated' : 'Token added', issuer.trim() || label.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalHeader title={editing ? 'Edit TOTP token' : 'New TOTP token'} />
      <div className="space-y-3">
        <Row>
          <Field label="Issuer"><input className="field" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="e.g. GitHub" /></Field>
          <Field label="Label"><input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. you@work" /></Field>
        </Row>
        <Field label={editing ? 'Secret (base32, leave blank to keep current)' : 'Secret (base32)'}>
          <textarea className="field font-mono text-[12px]" rows={2} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="JBSWY3DPEHPK3PXP" />
        </Field>
        <Row>
          <Field label="Algorithm">
            <select className="field" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as 'SHA1' | 'SHA256' | 'SHA512')}>
              <option>SHA1</option><option>SHA256</option><option>SHA512</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Digits">
              <select className="field" value={digits} onChange={(e) => setDigits(Number(e.target.value) as 6 | 8)}>
                <option value={6}>6</option><option value={8}>8</option>
              </select>
            </Field>
            <Field label="Period">
              <select className="field" value={period} onChange={(e) => setPeriod(Number(e.target.value) as 30 | 60)}>
                <option value={30}>30s</option><option value={60}>60s</option>
              </select>
            </Field>
          </div>
        </Row>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={issuer.trim() !== '' || label.trim() !== ''} label={editing ? 'Save changes' : 'Add token'} />
    </form>
  );
}

// ─── Certificate ───

function CertForm({ onDone }: FormProps) {
  const writeCertificate = useDataStore((s) => s.writeCertificate);
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseCertificatePem> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!certPem.trim()) { setParsed(null); return; }
    try {
      const info = parseCertificatePem(certPem.trim());
      setParsed(info);
      setHosts((prev) => (prev.trim() ? prev : info.hosts.join(', ')));
      setError(null);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : 'Could not parse certificate PEM');
    }
  }, [certPem]);

  useEffect(() => {
    if (parsed && certPem.trim() && keyPem.trim()) {
      if (!validateCertKeyPair(certPem.trim(), keyPem.trim())) {
        setError('Key does not match certificate');
      } else {
        setError(null);
      }
    }
  }, [keyPem, parsed, certPem]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parsed) { setError('A valid certificate PEM is required'); return; }
    setBusy(true);
    try {
      await writeCertificate({
        name: name.trim(),
        subject: parsed.subject,
        issuer: parsed.issuer,
        serialNumber: parsed.serialNumber,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo,
        isSelfSigned: parsed.isSelfSigned,
        fingerprint: parsed.fingerprint,
        hosts: hosts.split(',').map((h) => h.trim()).filter(Boolean),
        certPem: certPem.trim(),
        keyPem: keyPem.trim() || null,
      });
      pushToast.success('Certificate added', name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalHeader title="New certificate" />
      <div className="space-y-3">
        <Row>
          <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Hosts (comma-separated)"><input className="field" value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="api.example.com" /></Field>
        </Row>
        <Field label="Certificate PEM" hint={parsed ? `${parsed.subject} · expires ${parsed.validTo.toLocaleDateString()}${parsed.isSelfSigned ? ' · self-signed' : ''}` : 'Paste the PEM to auto-fill metadata'}>
          <textarea className="field font-mono text-[10px]" rows={6} value={certPem} onChange={(e) => setCertPem(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
        </Field>
        <Field label="Private key PEM (optional)">
          <textarea className="field font-mono text-[10px]" rows={4} value={keyPem} onChange={(e) => setKeyPem(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
        </Field>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={name.trim() !== '' && parsed !== null} label="Add certificate" />
    </form>
  );
}

// ─── Project ───

function ProjectForm({ id, onDone }: FormProps) {
  const projects = useDataStore((s) => s.projects);
  const writeProject = useDataStore((s) => s.writeProject);
  const stored = id ? projects.find((p) => p.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? '');
  const [color, setColor] = useState<ProjectColor>(stored?.color ?? 'green');
  const [icon, setIcon] = useState(stored?.icon ?? '');
  const [description, setDescription] = useState(stored?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await writeProject({ name: name.trim(), color, icon: icon.trim(), description: description.trim() }, editing && stored ? stored.id : undefined);
      pushToast.success(editing ? 'Project updated' : 'Project created', name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalHeader title={editing ? 'Edit project' : 'New project'} />
      <div className="space-y-3">
        <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Color">
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={'w-7 h-7 rounded-full border-2 transition-transform ' + (color === c ? 'border-white scale-110' : 'border-transparent')}
                style={{ backgroundColor: COLOR_HEX[c] }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <Field label="Icon (emoji or short tag)"><input className="field" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🚀" maxLength={8} /></Field>
        <Field label="Description"><textarea className="field" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={name.trim() !== ''} label={editing ? 'Save changes' : 'Create project'} />
    </form>
  );
}

// ─── Service ───

function ServiceForm({ id, onDone }: FormProps) {
  const services = useDataStore((s) => s.services);
  const writeService = useDataStore((s) => s.writeService);
  const stored = id ? services.find((s) => s.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? '');
  const [color, setColor] = useState<ProjectColor>(stored?.color ?? 'blue');
  const [icon, setIcon] = useState(stored?.icon ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await writeService({ name: name.trim(), color, icon: icon.trim() }, editing && stored ? stored.id : undefined);
      pushToast.success(editing ? 'Service updated' : 'Service created', name.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ModalHeader title={editing ? 'Edit service' : 'New service'} />
      <div className="space-y-3">
        <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Color">
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={'w-7 h-7 rounded-full border-2 transition-transform ' + (color === c ? 'border-white scale-110' : 'border-transparent')}
                style={{ backgroundColor: COLOR_HEX[c] }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <Field label="Icon (emoji or short tag)"><input className="field" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="☁️" maxLength={8} /></Field>
      </div>
      <ErrorLine error={error} />
      <Actions busy={busy} canSubmit={name.trim() !== ''} label={editing ? 'Save changes' : 'Create service'} />
    </form>
  );
}

export { pushToast };
