/**
 * Quick popup window (quick.html): metadata-only search over the main
 * window's index. Plaintext NEVER reaches this window — on copy, the main
 * window decrypts and moves the value straight to the system clipboard.
 */
import { useEffect, useRef, useState } from 'react';
import { FiAlertTriangle, FiCornerDownLeft, FiLock, FiSearch } from 'react-icons/fi';
import { listen, bridge, emit } from '@/auth/bridge.js';
import { secondaryLabel } from '@/lib/search.js';
import { useNowInterval } from '@/ui/components/Toast.js';
import { BrandMark, Kbd, MOD_KEY } from '@/ui/components/primitives.js';

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

const KIND_TONE: Record<QuickSearchItem['kind'], string> = {
  secret: 'text-emerald-300',
  password: 'text-sky-300',
  ssh: 'text-amber-300',
  totp: 'text-violet-300',
  cert: 'text-teal-300',
};

export default function QuickApp({ initialResults }: { initialResults?: ResultsPayload } = {}) {
  const [results, setResults] = useState<ResultsPayload>(initialResults ?? { items: [], locked: false, ready: false });
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearAt, setClearAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nowMs = useNowInterval(1000, clearAt > 0);

  useEffect(() => {
    const stops = [
      listen<ResultsPayload>('quick:results', (p) => setResults(p)),
      listen<CopyResultPayload>('quick:copy-result', (p) => {
        if (p.ok) {
          setError(null);
          setCopied(p.message);
          setClearAt(p.clearSecs && p.clearSecs > 0 ? Date.now() + p.clearSecs * 1000 : 0);
          setTimeout(() => void bridge.hideQuickWindow(), 950);
        } else {
          setCopied(null);
          setClearAt(0);
          setError(p.message);
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
      setError(null);
      setClearAt(0);
      setResults({ items: [], locked: false, ready: false });
    });
    return () => void stop.then((f) => f());
  }, []);

  // Debounced query → main window.
  useEffect(() => {
    const t = setTimeout(() => { void emit('quick:query', { q: query }); }, 55);
    return () => clearTimeout(t);
  }, [query]);

  const items = results.items;
  const current = items[cursor];
  const secondary = current ? secondaryLabel(current.kind) : null;

  const pick = (item: QuickSearchItem, field?: string) => {
    setError(null);
    void emit('quick:copy', { id: item.id, kind: item.kind, field: field ?? 'primary' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void bridge.hideQuickWindow();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)));
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
    <div className="quick-shell text-[13px]" onKeyDown={onKeyDown}>
      <div className="quick-card">
        {/* Search row */}
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-border">
          <BrandMark size={18} />
          <FiSearch size={14} className="text-subtle shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none placeholder:text-subtle text-[14px]"
            placeholder={results.locked ? 'Vault is locked' : 'Search your vault…'}
            value={query}
            disabled={results.locked}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          {!results.locked && <Kbd>Esc</Kbd>}
        </div>

        {/* Locked state */}
        {results.locked ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-8">
            <div className="grid place-items-center w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 mb-3">
              <FiLock size={18} />
            </div>
            <div className="text-[13px] font-semibold">Vault is locked</div>
            <p className="text-[11.5px] text-muted mt-1 mb-4 max-w-[260px] leading-relaxed">
              Unlock in the main window to search and copy secrets from here.
            </p>
            <button
              className="btn-primary !text-[12px]"
              onClick={() => { void bridge.showMainWindow(); void bridge.hideQuickWindow(); }}
            >
              Open Scync to unlock
            </button>
          </div>
        ) : (
          <>
            <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-1.5">
              {results.ready && items.length === 0 && query.trim() !== '' && (
                <div className="text-subtle px-2 py-8 text-center text-[12.5px]">
                  No matches for “{query.trim()}”.
                </div>
              )}
              {results.ready && items.length === 0 && query.trim() === '' && (
                <div className="text-subtle px-2 py-8 text-center text-[12.5px] leading-relaxed">
                  Type to search across secrets, passwords,<br />keys, certificates, and 2FA codes.
                </div>
              )}
              {!results.ready && query.trim() === '' && (
                <div className="text-subtle px-2 py-8 text-center text-[12.5px]">Connecting to your vault…</div>
              )}
              {items.map((item, i) => (
                <button
                  key={`${item.kind}:${item.id}`}
                  data-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(item)}
                  className={
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left mb-0.5 border transition-colors ' +
                    (i === cursor ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')
                  }
                >
                  <span className={'mono-label w-14 shrink-0 ' + KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</span>
                  <span className="truncate flex-1 text-[13px]">{item.name}</span>
                  <span className="text-[11px] text-subtle truncate max-w-[38%]">
                    {[item.service, item.environment, item.project].filter(Boolean).join(' · ')}
                  </span>
                  {i === cursor && <FiCornerDownLeft size={12} className="text-subtle shrink-0" />}
                </button>
              ))}
            </div>

            {/* Status / hints footer */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border bg-black/20 min-h-[34px]">
              {error ? (
                <span className="flex items-center gap-1.5 text-[11px] text-rose-400 truncate">
                  <FiAlertTriangle size={11} /> {error}
                </span>
              ) : copied ? (
                <span className="text-[11px] text-accent-light truncate">
                  {copied}{countdown > 0 ? ` · clears in ${countdown}s` : ''}
                </span>
              ) : (
                <div className="flex items-center gap-3 mono-label">
                  <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
                  <span className="flex items-center gap-1"><Kbd>↵</Kbd> copy</span>
                  {secondary && <span className="flex items-center gap-1"><Kbd>{MOD_KEY}</Kbd><Kbd>↵</Kbd> {secondary.toLowerCase()}</span>}
                </div>
              )}
              {!error && !copied && items.length > 0 && (
                <span className="mono-label shrink-0">{cursor + 1}/{items.length}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
