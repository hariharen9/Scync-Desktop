/**
 * CommandPalette — ⌘K / Ctrl+K.
 *
 * A keyboard-first launcher over plaintext METADATA only (never secret
 * values). Typing ranks items across all five domains plus navigation and
 * quick actions. Enter on an item decrypts in the MAIN window and writes
 * straight to the auto-clearing clipboard — the same boundary the quick
 * popup uses, just without the second window.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FiActivity, FiCheck, FiCommand, FiDatabase, FiFolder, FiKey, FiLock, FiPlus,
  FiShield, FiTerminal, FiType, FiCornerDownLeft, FiSearch, FiSettings,
} from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { searchItems } from '@/lib/search.js';
import type { QuickSearchItem } from '@/stores/dataStore.js';
import { bridge } from '@/auth/bridge.js';
import { useEscape } from './primitives.js';

type Kind = QuickSearchItem['kind'];

const KIND_META: Record<Kind, { label: string; icon: ReactNode; tone: string }> = {
  secret: { label: 'secret', icon: <FiDatabase size={13} />, tone: 'text-emerald-300' },
  password: { label: 'password', icon: <FiKey size={13} />, tone: 'text-sky-300' },
  totp: { label: '2FA', icon: <FiType size={13} />, tone: 'text-violet-300' },
  ssh: { label: 'ssh key', icon: <FiTerminal size={13} />, tone: 'text-amber-300' },
  cert: { label: 'certificate', icon: <FiShield size={13} />, tone: 'text-teal-300' },
};

const KIND_VIEW: Record<Kind, 'secrets' | 'passwords' | 'totp' | 'ssh' | 'certs'> = {
  secret: 'secrets', password: 'passwords', totp: 'totp', ssh: 'ssh', cert: 'certs',
};

interface ItemAction { id: string; kind: 'item'; item: QuickSearchItem }
interface CmdAction { id: string; kind: 'command'; label: string; hint: string; icon: ReactNode; run: () => void }
type Entry = ItemAction | CmdAction;

export default function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setView = useUiStore((s) => s.setView);
  const setViewWithSelection = useUiStore((s) => s.setViewWithSelection);
  const openForm = useUiStore((s) => s.openForm);
  const metaIndex = useDataStore((s) => s.metaIndex);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); };

  useEscape(open, close);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setFlash(null);
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Metadata index — stable per render pass but cheap; recompute only while open.
  const index = useMemo(() => (open ? metaIndex() : []), [open, metaIndex]);

  const commands: CmdAction[] = useMemo(() => [
    { id: 'cmd-new-secret', kind: 'command', label: 'New secret', hint: 'create', icon: <FiPlus size={13} />, run: () => openForm('secret') },
    { id: 'cmd-new-password', kind: 'command', label: 'New password', hint: 'create', icon: <FiKey size={13} />, run: () => openForm('password') },
    { id: 'cmd-new-project', kind: 'command', label: 'New project', hint: 'create', icon: <FiFolder size={13} />, run: () => openForm('project') },
    { id: 'cmd-dashboard', kind: 'command', label: 'Go to Dashboard', hint: 'navigate', icon: <FiActivity size={13} />, run: () => setView('dashboard') },
    { id: 'cmd-secrets', kind: 'command', label: 'Go to Secrets', hint: 'navigate', icon: <FiDatabase size={13} />, run: () => setView('secrets') },
    { id: 'cmd-settings', kind: 'command', label: 'Open Settings', hint: 'navigate', icon: <FiSettings size={13} />, run: () => setView('settings') },
    { id: 'cmd-lock', kind: 'command', label: 'Lock vault', hint: 'secure', icon: <FiLock size={13} />, run: () => { void import('@/lib/autoLock.js').then((m) => m.lockNow('manual')); } },
  ], [openForm, setView]);

  const entries: Entry[] = useMemo(() => {
    const q = query.trim();
    const itemHits = q ? searchItems(index, q, 8).map((item) => ({ id: `item:${item.kind}:${item.id}`, kind: 'item' as const, item })) : [];
    const cmdHits = commands
      .filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()))
      .map((c) => ({ ...c, kind: 'command' as const }));
    return [...itemHits, ...cmdHits];
  }, [query, index, commands]);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const copyItem = async (item: QuickSearchItem) => {
    const ds = useDataStore.getState();
    try {
      let value = '';
      switch (item.kind) {
        case 'secret': value = (await ds.decryptSecretById(item.id)).value; break;
        case 'password': value = (await ds.decryptPasswordById(item.id)).password; break;
        case 'ssh': value = await ds.decryptSshPrivate(item.id); break;
        case 'totp': value = (await ds.totpCodeFor(item.id)).code; break;
        case 'cert': value = (await ds.decryptCertById(item.id)).certPem; break;
      }
      if (!value) throw new Error('Nothing to copy');
      const secs = useUiStore.getState().settings.clipboardClearSecs ?? 20;
      await bridge.copySecret(value, secs);
      setFlash(item.id);
      setTimeout(() => setOpen(false), 620);
    } catch (e) {
      setFlash(null);
      useUiStore.getState().showToast('Copy failed', e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const activate = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.kind === 'command') {
      entry.run();
      setOpen(false);
    } else {
      void copyItem(entry.item);
    }
  };

  const reveal = (entry: ItemAction) => {
    setViewWithSelection(KIND_VIEW[entry.item.kind], entry.item.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(entries[cursor]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const entry = entries[cursor];
      if (entry && entry.kind === 'item') reveal(entry);
    }
  };

  const q = query.trim();

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh]" onMouseDown={close}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
      <div
        className="relative w-full max-w-[580px] rounded-xl border border-border-strong bg-panel-2/98 shadow-2xl overflow-hidden anim-pop-in"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <FiSearch size={16} className="text-subtle shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-subtle"
            placeholder="Search secrets, keys, or run a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="chip shrink-0">ESC</span>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5">
          {entries.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-subtle">
              {q ? <>No matches for “{q}”.</> : 'Start typing to search your vault.'}
            </div>
          ) : (
            entries.map((entry, i) => {
              const selected = i === cursor;
              if (entry.kind === 'command') {
                return (
                  <button
                    key={entry.id}
                    data-selected={selected}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => activate(entry)}
                    className={'w-full flex items-center gap-3 px-3 py-2 rounded-lg mx-1.5 text-left transition-colors ' + (selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]')}
                    style={{ width: 'calc(100% - 12px)' }}
                  >
                    <span className="grid place-items-center w-7 h-7 rounded-md bg-white/[0.04] border border-border text-muted shrink-0">
                      {entry.icon}
                    </span>
                    <span className="flex-1 text-[13px]">{entry.label}</span>
                    <span className="mono-label">{entry.hint}</span>
                    {selected && <FiCornerDownLeft size={12} className="text-subtle" />}
                  </button>
                );
              }
              const meta = KIND_META[entry.item.kind];
              const isFlashing = flash === entry.item.id;
              return (
                <button
                  key={entry.id}
                  data-selected={selected}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => activate(entry)}
                  className={'w-full flex items-center gap-3 px-3 py-2 rounded-lg mx-1.5 text-left transition-colors ' + (selected ? 'bg-accent-dim' : 'hover:bg-white/[0.03]')}
                  style={{ width: 'calc(100% - 12px)' }}
                >
                  <span className={'grid place-items-center w-7 h-7 rounded-md bg-black/30 border border-border shrink-0 ' + meta.tone}>
                    {isFlashing ? <FiCheck size={13} /> : meta.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] truncate">{entry.item.name}</span>
                    <span className="block text-[10.5px] text-subtle truncate">
                      {[entry.item.service, entry.item.environment, entry.item.project].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={'mono-label shrink-0 ' + meta.tone}>{meta.label}</span>
                  {selected && !isFlashing && <span className="chip chip-accent shrink-0">↵ copy</span>}
                  {isFlashing && <span className="chip chip-accent shrink-0">copied</span>}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border bg-black/20 text-subtle">
          <span className="flex items-center gap-1.5 mono-label"><span className="kbd">↑↓</span> navigate</span>
          <span className="flex items-center gap-1.5 mono-label"><span className="kbd">↵</span> copy / run</span>
          <span className="flex items-center gap-1.5 mono-label"><span className="kbd">⇥</span> open</span>
          <span className="ml-auto mono-label flex items-center gap-1"><FiCommand size={10} /> vault index</span>
        </div>
      </div>
    </div>
  );
}
