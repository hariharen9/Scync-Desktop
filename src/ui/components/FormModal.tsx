/**
 * FormModal — create/edit for every domain (secret, password, ssh key, TOTP,
 * certificate, project, service). All encrypted writes funnel through
 * dataStore write helpers; plaintext only lives in local form state.
 */
import { useEffect, useMemo, useState } from 'react';
import forge from 'node-forge';
import { useUiStore, type Environment, type SecretStatus, type SecretType, type ProjectColor } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { generateSSHKeyPair } from '@/backend/index.js';
import { parseCertificatePem, validateCertKeyPair } from '@/backend/index.js';
import { pushToast } from './Toast.js';

const ENVIRONMENTS: Environment[] = ['Personal', 'Work', 'Development', 'Staging', 'Production', 'Local', 'Testing', 'CI/CD'];
const STATUSES: SecretStatus[] = ['Active', 'Rotated', 'Expired', 'Revoked'];
const SECRET_TYPES: SecretType[] = [
  'API Key', 'Personal Access Token', 'OAuth Token', 'OAuth Client Secret',
  'Recovery Codes', 'Secret Key', 'Webhook Secret', 'Service Account JSON',
  'Database URL', 'License Key', 'Passphrase', 'Secret Note', 'Password', 'Other',
];
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

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center overflow-y-auto py-8" onClick={() => closeForm()}>
      <div className="card w-full max-w-lg p-5 my-auto" onClick={(e) => e.stopPropagation()}>
        {kind === 'secret' && <SecretForm id={editing ? id : null} onDone={closeForm} />}
        {kind === 'password' && <PasswordForm id={editing ? id : null} onDone={closeForm} />}
        {kind === 'ssh' && <SshForm id={editing ? id : null} onDone={closeForm} />}
        {kind === 'totp' && <TotpForm id={editing ? id : null} onDone={closeForm} />}
        {kind === 'cert' && <CertForm id={editing ? id : null} onDone={closeForm} />}
        {kind === 'project' && <ProjectForm id={editing ? id : null} onDone={closeForm} />}
        {kind === 'service' && <ServiceForm id={editing ? id : null} onDone={closeForm} />}
      </div>
    </div>
  );
}

interface FormProps { id: string | null; onDone: () => void }

function ModalHeader({ title }: { title: string }) {
  return <h2 className="font-semibold text-sm mb-4">{title}</h2>;
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="text-[12px] text-red-400 mt-2">{error}</div>;
}

function Actions({ busy, canSubmit, label }: { busy: boolean; canSubmit: boolean; label: string }) {
  const closeForm = useUiStore((s) => s.closeForm);
  return (
    <div className="flex gap-2 justify-end mt-5">
      <button type="button" className="btn-ghost" onClick={closeForm} disabled={busy}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}

// ─── Secret ───

function SecretForm({ id, onDone }: FormProps) {
  const secrets = useDataStore((s) => s.secrets);
  const projects = useDataStore((s) => s.projects);
  const writeSecret = useDataStore((s) => s.writeSecret);
  const stored = id ? secrets.find((s) => s.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? '');
  const [service, setService] = useState<string>(stored?.service ?? '');
  const [type, setType] = useState<SecretType>(stored?.type ?? 'API Key');
  const [environment, setEnvironment] = useState<Environment>(stored?.environment ?? 'Development');
  const [status, setStatus] = useState<SecretStatus>(stored?.status ?? 'Active');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<string>(stored?.projectId ?? '');
  const [lastRotated, setLastRotated] = useState(toDateInputValue(stored?.lastRotated ?? null));
  const [expiresOn, setExpiresOn] = useState(toDateInputValue(stored?.expiresOn ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Editing keeps the stored ciphertext when the value field was left blank.
    if (!editing && !value.trim()) { setError('Value is required'); return; }
    setBusy(true);
    try {
      let currentValue = value;
      let currentNotes = notes;
      if (editing && stored) {
        const dec = await useDataStore.getState().decryptSecretById(stored.id);
        if (!currentValue) currentValue = dec.value;
        if (!currentNotes) currentNotes = dec.notes;
      }
      await writeSecret(
        {
          name: name.trim(),
          service: service.trim() || 'other',
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
          <Field label="Service"><input className="field" value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. AWS, GitHub…" /></Field>
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
        <Field label={editing ? `Value (leave blank to keep ${editing ? 'current' : ''})` : 'Value'}>
          <textarea className="field font-mono text-[12px]" rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
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
  const stored = id ? sshKeys.find((k) => k.id === id) ?? null : null;
  const editing = stored !== null;

  const [name, setName] = useState(stored?.name ?? '');
  const [hosts, setHosts] = useState(stored?.hosts.join(', ') ?? '');
  const [rotationDate, setRotationDate] = useState(toDateInputValue(stored?.rotationDate ?? null));
  const [pub, setPub] = useState('');
  const [priv, setPriv] = useState('');
  const [genType, setGenType] = useState<'ed25519' | 'rsa'>('ed25519');
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fingerprint = useMemo(() => {
    if (!pub.trim()) return '';
    const sshModule = forge.ssh as unknown as {
      publicKeyFromSSHPubKey?: (s: string) => forge.pki.PublicKey;
    };
    try {
      const parsed = sshModule.publicKeyFromSSHPubKey?.(pub.trim());
      if (!parsed) throw new Error('not an OpenSSH public key');
      return String(forge.ssh.getPublicKeyFingerprint(parsed, { encoding: 'hex', delimiter: ':' }));
    } catch {
      try {
        // PEM-format public key
        const parsed = forge.pki.publicKeyFromPem(pub.trim());
        return String(forge.ssh.getPublicKeyFingerprint(parsed, { encoding: 'hex', delimiter: ':' }));
      } catch {
        return '';
      }
    }
  }, [pub]);

  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const pair = await generateSSHKeyPair(name.trim() || 'scync-generated', genType);
      setPub(pair.publicKey);
      setPriv(pair.privateKey);
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
      if (!pub.trim() || !priv.trim()) { setError('Public and private key are required'); return; }
      if (!fingerprint) { setError('Could not parse public key (OpenSSH one-line or PEM expected)'); return; }
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
          type: pub.startsWith('ssh-') ? pub.split(' ')[0] : 'unknown',
          publicKey: pub.trim(),
          fingerprint,
          privateKey: priv.trim(),
          hosts: hostList,
        });
      }
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
          <Field label="Key type (from public key)">
            <input className="field" value={pub.startsWith('ssh-') ? pub.split(' ')[0] : ''} readOnly placeholder="—" />
          </Field>
        </Row>
        <Field label="Public key (OpenSSH or PEM)" hint={fingerprint ? `Fingerprint: ${fingerprint}` : undefined}>
          <textarea className="field font-mono text-[11px]" rows={3} value={pub} onChange={(e) => setPub(e.target.value)} />
        </Field>
        <Field label="Private key">
          <textarea className="field font-mono text-[11px]" rows={3} value={priv} onChange={(e) => setPriv(e.target.value)} />
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
