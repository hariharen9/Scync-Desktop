/**
 * Quick popup window (quick.html): metadata-only search over the main
 * window's index. Plaintext NEVER reaches this window — on copy, the main
 * window decrypts and moves the value straight to the system clipboard.
 */
import { useEffect, useRef, useState } from 'react';
import { FiCornerDownLeft } from 'react-icons/fi';
import { listen, bridge, emit } from '@/auth/bridge.js';
import { useNowInterval } from '@/ui/components/Toast.js';

interface QuickSearchItem {
  id: string;
  kind: 'secret' | 'password' | 'ssh' | 'totp' | 'cert';
  name: string;
  service: string;
  environment: string;
  project: string;
  status: string;
}

interface ResultsPayload { items: QuickSearchItem[]; locked: boolean; ready: boolean }
interface CopyResultPayload { ok: boolean; message: string; clearSecs?: number }

const KIND_LABEL: Record<QuickSearchItem['kind'], string> = {
  secret: 'secret',
  password: 'password',
  ssh: 'ssh key',
  totp: '2FA',
  cert: 'cert',
};

export default function QuickApp() {
  const [results, setResults] = useState<ResultsPayload>({ items: [], locked: false, ready: false });
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [clearAt, setClearAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nowMs = useNowInterval(1000, clearAt > 0);

  useEffect(() => {
    const stops = [
      listen<ResultsPayload>('quick:results', (p) => setResults(p)),
      listen<CopyResultPayload>('quick:copy-result', (p) => {
        if (p.ok) {
          setCopied(p.message);
          setClearAt(p.clearSecs && p.clearSecs > 0 ? Date.now() + p.clearSecs * 1000 : 0);
          setTimeout(() => void bridge.hideQuickWindow(), 900);
        } else {
          setCopied(null);
          setClearAt(0);
        }
      }),
      listen<null>('vault:locked', () => setResults((r) => ({ ...r, locked: true, items: [] }))),
    ];
    return () => {
      for (const s of stops) void s.then((f) => f());
    };
  }, []);

  // Re-focus + clear query each time the popup is shown.
  useEffect(() => {
    const stop = listen<null>('quick:shown', () => {
      inputRef.current?.focus();
      setQuery('');
      setCursor(0);
      setCopied(null);
      setClearAt(0);
      setResults({ items: [], locked: false, ready: false });
    });
    return () => void stop.then((f) => f());
  }, []);

  // Debounced query → main window.
  useEffect(() => {
    const t = setTimeout(() => {
      void emit('quick:query', { q: query });
    }, 60);
    return () => clearTimeout(t);
  }, [query]);

  const items = results.items;

  const pick = (item: QuickSearchItem, field?: string) => {
    void emit('quick:copy', { id: item.id, kind: item.kind, field: field ?? 'primary' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void bridge.hideQuickWindow();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[cursor];
      if (item) pick(item, e.metaKey || e.ctrlKey ? 'secondary' : 'primary');
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const countdown = clearAt > 0 ? Math.max(0, Math.ceil((clearAt - nowMs) / 1000)) : 0;

  return (
    <div className="h-full flex flex-col text-[13px]" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5 border-b border-border">
        <span className="font-display font-extrabold text-accent-light text-xs tracking-tight">S</span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none placeholder:text-subtle"
          placeholder={results.locked ? 'Vault is locked — press Esc' : 'Search your vault…'}
          value={query}
          disabled={results.locked}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-1.5">
        {results.ready && items.length === 0 && query.trim() !== '' && (
          <div className="text-subtle px-2 py-6 text-center">No matches.</div>
        )}
        {results.ready && items.length === 0 && query.trim() === '' && !results.locked && (
          <div className="text-subtle px-2 py-6 text-center">Type to search — results come from the main window's index.</div>
        )}
        {items.map((item, i) => (
          <button
            key={`${item.kind}:${item.id}`}
            data-selected={i === cursor}
            onMouseEnter={() => setCursor(i)}
            onClick={() => pick(item)}
            className={'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left ' + (i === cursor ? 'bg-accent-dim border border-accent-border' : 'border border-transparent')}
          >
            <span className="mono-label w-16 shrink-0">{KIND_LABEL[item.kind]}</span>
            <span className="truncate flex-1">{item.name}</span>
            <span className="text-[11px] text-subtle truncate max-w-[35%]">{[item.service, item.environment, item.project].filter(Boolean).join(' · ')}</span>
            {i === cursor && <FiCornerDownLeft size={12} className="text-subtle shrink-0" />}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border">
        <div className="mono-label">
          {copied
            ? <span className="text-accent-light">{copied}{countdown > 0 ? ` · clears in ${countdown}s` : ''}</span>
            : '↑↓ navigate · ↵ copy · Ctrl+↵ second field · Esc hide'}
        </div>
      </div>
    </div>
  );
}
