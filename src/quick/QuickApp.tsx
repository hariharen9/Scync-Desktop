/**
 * Quick popup window (quick.html): metadata-only search over the main
 * window's index. Plaintext NEVER reaches this window — on copy, the main
 * window decrypts and moves the value straight to the system clipboard.
 *
 * UX notes:
 *   • On open it shows the most recent items immediately (the main window
 *     answers `quick:shown`), so there is never an empty "connecting" state.
 *   • Results are grouped by kind while the query is empty, and flat-ranked
 *     once you type.
 *   • Copy shows inline progress, success with the clipboard countdown, or a
 *     clear failure — in the row itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiAlertTriangle, FiCheck, FiCornerDownLeft, FiLock, FiSearch, FiX,
} from 'react-icons/fi';
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
  updatedAt?: number;
}

interface ResultsPayload { items: QuickSearchItem[]; locked: boolean; ready: boolean }
interface CopyResultPayload { ok: boolean; message: string; clearSecs?: number }

const KIND_META: Record<QuickSearchItem['kind'], { label: string; tone: string; dot: string }> = {
  secret: { label: 'Secret', tone: 'text-emerald-300', dot: 'bg-emerald-400' },
  password: { label: 'Password', tone: 'text-sky-300', dot: 'bg-sky-400' },
  totp: { label: '2FA', tone: 'text-violet-300', dot: 'bg-violet-400' },
  ssh: { label: 'SSH key', tone: 'text-amber-300', dot: 'bg-amber-400' },
  cert: { label: 'Certificate', tone: 'text-teal-300', dot: 'bg-teal-400' },
};

const GROUP_ORDER: Array<QuickSearchItem['kind']> = ['secret', 'password', 'totp', 'ssh', 'cert'];

/** Secondary text shown on the right of each row. */
function metaLine(item: QuickSearchItem): string {
  return [item.service, item.environment, item.project].filter(Boolean).join(' · ');
}

export default function QuickApp({ initialResults }: { initialResults?: ResultsPayload } = {}) {
  const [results, setResults] = useState<ResultsPayload>(initialResults ?? { items: [], locked: false, ready: false });
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<string | null>(null); // item key being copied
  const [copied, setCopied] = useState<{ key: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearAt, setClearAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Which item key a copy is in flight for (read inside the event handler).
  const pendingRef = useRef<string | null>(null);
  const nowMs = useNowInterval(1000, clearAt > 0);

  useEffect(() => {
    const stops = [
      listen<ResultsPayload>('quick:results', (p) => setResults(p)),
      listen<CopyResultPayload>('quick:copy-result', (p) => {
        // `pending` still holds the item we asked to copy; promote it to `copied`.
        setCopied((prev) => {
          if (p.ok) return { key: pendingRef.current ?? '', message: p.message };
          return prev;
        });
        setPending(null);
        if (p.ok) {
          setError(null);
          setClearAt(p.clearSecs && p.clearSecs > 0 ? Date.now() + p.clearSecs * 1000 : 0);
          setTimeout(() => void bridge.hideQuickWindow(), 1000);
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

  // Reset per-show. We do NOT clear `ready`: the main window answers
  // `quick:shown` with fresh results, so the old list can stay visible until
  // the new payload lands (no flash of "connecting").
  useEffect(() => {
    const stop = listen<null>('quick:shown', () => {
      inputRef.current?.focus();
      setQuery('');
      setCursor(0);
      setCopied(null);
      setPending(null);
      setError(null);
      setClearAt(0);
    });
    return () => void stop.then((f) => f());
  }, []);

  // Debounced query → main window.
  useEffect(() => {
    const t = setTimeout(() => { void emit('quick:query', { q: query }); }, 55);
    return () => clearTimeout(t);
  }, [query]);

  const items = results.items;
  const trimmed = query.trim();
  const searching = trimmed !== '';

  // Grouped view while idle; flat ranked list while searching.
  const groups = useMemo(() => {
    if (searching) return null;
    const byKind = new Map<QuickSearchItem['kind'], QuickSearchItem[]>();
    for (const item of items) {
      const arr = byKind.get(item.kind) ?? [];
      arr.push(item);
      byKind.set(item.kind, arr);
    }
    return GROUP_ORDER
      .filter((k) => byKind.has(k))
      .map((k) => ({ kind: k, entries: byKind.get(k)! }));
  }, [items, searching]);

  // Flat order for keyboard navigation (matches visual order exactly).
  const flat = useMemo(() => {
    if (groups) return groups.flatMap((g) => g.entries);
    return items;
  }, [groups, items]);

  const current = flat[cursor];
  const secondary = current ? secondaryLabel(current.kind) : null;

  const pick = (item: QuickSearchItem, field?: string) => {
    setError(null);
    setCopied(null);
    const key = `${item.kind}:${item.id}`;
    pendingRef.current = key;
    setPending(key);
    void emit('quick:copy', { id: item.id, kind: item.kind, field: field ?? 'primary' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void bridge.hideQuickWindow();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[cursor];
      if (item) pick(item, e.metaKey || e.ctrlKey ? 'secondary' : 'primary');
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const countdown = clearAt > 0 ? Math.max(0, Math.ceil((clearAt - nowMs) / 1000)) : 0;

  const rowFor = (item: QuickSearchItem, index: number) => {
    const key = `${item.kind}:${item.id}`;
    const selected = index === cursor;
    const isPending = pending === key;
    const isCopied = !isPending && copied?.key === key;
    const meta = KIND_META[item.kind];
    return (
      <button
        key={key}
        data-selected={selected}
        onMouseEnter={() => setCursor(index)}
        onClick={() => pick(item)}
        className={
          'w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-left border transition-colors ' +
          (selected ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')
        }
      >
        <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + meta.dot} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] truncate leading-tight">{item.name}</span>
          {metaLine(item) && (
            <span className="block text-[10.5px] text-subtle truncate leading-tight mt-0.5">{metaLine(item)}</span>
          )}
        </span>
        <span className={'mono-label shrink-0 ' + meta.tone}>{meta.label}</span>
        {isPending ? (
          <span className="w-3 h-3 rounded-full border-2 border-white/20 border-t-accent animate-spin shrink-0" />
        ) : isCopied ? (
          <FiCheck size={12} className="text-accent-light shrink-0" />
        ) : selected ? (
          <FiCornerDownLeft size={12} className="text-subtle shrink-0" />
        ) : null}
      </button>
    );
  };

  return (
    <div className="quick-shell text-[13px]" onKeyDown={onKeyDown}>
      <div className="quick-card">
        {/* Search row */}
        <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5 border-b border-border">
          <BrandMark size={16} />
          <FiSearch size={13} className="text-subtle shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none placeholder:text-subtle text-[14px] min-w-0"
            placeholder={results.locked ? 'Vault is locked' : 'Search secrets, passwords, keys…'}
            value={query}
            disabled={results.locked}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          {query ? (
            <button
              className="text-subtle hover:text-text transition-colors shrink-0"
              onClick={() => { setQuery(''); setCursor(0); inputRef.current?.focus(); }}
              aria-label="Clear"
            >
              <FiX size={13} />
            </button>
          ) : (
            !results.locked && <Kbd>Esc</Kbd>
          )}
        </div>

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
              {/* Loading only on a genuinely cold start with nothing to show */}
              {!results.ready && items.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-2 py-10 text-[12px] text-subtle">
                  <span className="w-3 h-3 rounded-full border-2 border-white/20 border-t-accent animate-spin" />
                  Loading your vault…
                </div>
              )}

              {results.ready && items.length === 0 && searching && (
                <div className="text-subtle px-4 py-10 text-center text-[12.5px]">
                  <div className="text-[13px] text-muted">No matches for “{trimmed}”</div>
                  <div className="mt-1 text-[11.5px]">Try a service, project, or environment name.</div>
                </div>
              )}

              {results.ready && items.length === 0 && !searching && (
                <div className="text-subtle px-4 py-10 text-center text-[12.5px] leading-relaxed">
                  Nothing in your vault yet.<br />
                  <span className="text-[11.5px]">Add secrets in the main window to find them here.</span>
                </div>
              )}

              {/* Idle: grouped by kind, newest first within each group */}
              {groups && groups.length > 0 && (
                <>
                  {groups.map((group) => (
                    <div key={group.kind} className="mb-1">
                      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
                        <span className={'w-1.5 h-1.5 rounded-full ' + KIND_META[group.kind].dot} />
                        <span className="mono-label">{KIND_META[group.kind].label}s</span>
                        <span className="mono-label text-subtle/60">{group.entries.length}</span>
                      </div>
                      {group.entries.map((item) => rowFor(item, flat.indexOf(item)))}
                    </div>
                  ))}
                </>
              )}

              {/* Searching: flat ranked list */}
              {groups === null && items.map((item, i) => rowFor(item, i))}
            </div>

            {/* Footer: status or key hints */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border bg-black/20 min-h-[34px]">
              {error ? (
                <span className="flex items-center gap-1.5 text-[11px] text-rose-400 truncate min-w-0">
                  <FiAlertTriangle size={11} className="shrink-0" /> <span className="truncate">{error}</span>
                </span>
              ) : copied ? (
                <span className="flex items-center gap-1.5 text-[11px] text-accent-light truncate min-w-0">
                  <FiCheck size={11} className="shrink-0" />
                  {copied.message}{countdown > 0 ? ` · clears in ${countdown}s` : ''}
                </span>
              ) : (
                <div className="flex items-center gap-3 mono-label min-w-0 overflow-hidden">
                  <span className="flex items-center gap-1 shrink-0"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
                  <span className="flex items-center gap-1 shrink-0"><Kbd>↵</Kbd> copy</span>
                  {secondary && (
                    <span className="flex items-center gap-1 shrink-0 truncate">
                      <Kbd>{MOD_KEY}</Kbd><Kbd>↵</Kbd> {secondary.toLowerCase()}
                    </span>
                  )}
                </div>
              )}
              {!error && !copied && flat.length > 0 && (
                <span className="mono-label shrink-0 tabular-nums">{cursor + 1}/{flat.length}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
