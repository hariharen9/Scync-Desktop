/**
 * Shared UI primitives — the small, reusable pieces every screen composes
 * from. Kept presentation-only: no backend or store imports beyond the
 * toast helper, so they are safe to use in both the main window and the
 * metadata-only quick popup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';

// The animated "neon lattice orb" brand logo, imported as a bundled asset URL
// so it is fetched once and cached, then rendered via <img> (SMIL animations
// run inside <img>-embedded SVGs). Kept out of the JS bundle.
import scyncLogoUrl from '../../../assets/scync-logo.svg?url';

// ─── Keyboard chip ──────────────────────────────────────────────────────────

/** True on macOS, where the primary modifier is ⌘ rather than Ctrl. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
/** Label for the primary modifier, for use inside <Kbd>. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** `⌘K` / `Ctrl K` shortcut chip. */
export function ModKbd({ keyName }: { keyName: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <kbd className="kbd">{MOD_KEY}</kbd>
      <kbd className="kbd">{keyName}</kbd>
    </span>
  );
}

// ─── Chips & pills ──────────────────────────────────────────────────────────

type ChipTone = 'default' | 'accent' | 'warn' | 'danger';

export function Chip({ tone = 'default', icon, children, title }: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  const cls = tone === 'accent' ? 'chip chip-accent' : tone === 'warn' ? 'chip chip-warn' : tone === 'danger' ? 'chip chip-danger' : 'chip';
  return (
    <span className={cls} title={title}>
      {icon}
      {children}
    </span>
  );
}

// ─── Spinner / skeleton ─────────────────────────────────────────────────────

export function Spinner({ size = 'sm', className = '' }: { size?: 'sm' | 'lg'; className?: string }) {
  return <span className={`spinner ${size === 'lg' ? 'spinner-lg' : ''} ${className}`} aria-hidden="true" />;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="px-2 space-y-1.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-2.5 py-2.5" style={{ opacity: 1 - i * 0.11 }}>
          <Skeleton className="h-3 w-[62%] mb-2" />
          <Skeleton className="h-2.5 w-[40%]" />
        </div>
      ))}
    </div>
  );
}

// ─── Brand mark ─────────────────────────────────────────────────────────────
// The real animated "neon lattice orb" logo (scync-logo.svg), shared by every
// screen. Rendered as an <img> so the SMIL animation plays and the 500 KB of
// path data stays out of the JS bundle.

export function BrandMark({ size = 28, glow = false }: { size?: number; glow?: boolean }) {
  // The artwork's orb occupies roughly the central 72% of its square canvas.
  // Scale the image with a transform (which does NOT affect layout) so the
  // visible orb fills the box exactly while the element's layout box is
  // precisely `size` — keeping it aligned with adjacent text.
  const scale = 1.36;
  return (
    <span
      className="relative inline-grid place-items-center shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {glow && (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(140,60,255,0.42), transparent 70%)',
            filter: 'blur(8px)',
            animation: 'glow-breathe 4.2s ease-in-out infinite',
          }}
        />
      )}
      <img
        src={scyncLogoUrl}
        alt=""
        draggable={false}
        className="relative block select-none"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          transform: `scale(${scale})`,
          transformOrigin: 'center',
        }}
      />
    </span>
  );
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span className={`font-display font-extrabold tracking-[-0.03em] ${small ? 'text-[13px]' : 'text-[15px]'}`}>
      SCYNC
    </span>
  );
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#10b981', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#0ea5e9', '#14b8a6'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(name: string, email?: string): string {
  const source = (name || email || '?').trim();
  if (!source) return '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Avatar({ name, email, photoURL, size = 32 }: {
  name?: string | null;
  email?: string;
  photoURL?: string | null;
  size?: number;
}) {
  const color = AVATAR_COLORS[hashString(email || name || 'x') % AVATAR_COLORS.length];
  // If the remote photo is blocked by CSP or fails to load (expired Google CDN
  // URL), fall back to the initials badge rather than a broken-image icon.
  const [failed, setFailed] = useState(false);
  if (photoURL && !failed) {
    return (
      <img
        src={photoURL}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size, border: '1px solid rgba(255,255,255,0.12)' }}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="rounded-full grid place-items-center shrink-0 font-semibold select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.36),
        color: '#04120d',
        background: `linear-gradient(145deg, ${color}, ${color}bb)`,
        boxShadow: `0 0 0 1px ${color}55`,
        letterSpacing: '0.02em',
      }}
      aria-hidden="true"
    >
      {initialsOf(name ?? '', email)}
    </span>
  );
}

// ─── Section label ──────────────────────────────────────────────────────────

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="mono-label">{children}</span>
      {trailing}
    </div>
  );
}

// ─── Copy feedback ─────────────────────────────────────────────────────────

/**
 * Small state machine for "copy → show check for a beat". Returns a boolean
 * flag plus a trigger that runs an async copy and reports success.
 */
export function useCopyFeedback(timeoutMs = 1600): {
  copied: boolean;
  run: (fn: () => Promise<unknown> | unknown) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown> | unknown) => {
      await fn();
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeoutMs);
    },
    [timeoutMs],
  );

  return { copied, run };
}

export function CopyIconButton({ onCopy, label = 'Copy', className = '', size = 13 }: {
  onCopy: () => Promise<unknown> | unknown;
  label?: string;
  className?: string;
  size?: number;
}) {
  const { copied, run } = useCopyFeedback();
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        void run(onCopy).catch(() => undefined);
      }}
    >
      {copied ? <FiCheck size={size} className="text-accent-light" /> : <FiCopy size={size} />}
    </button>
  );
}

// ─── Relative time ─────────────────────────────────────────────────────────

export function formatRelative(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return '—';
  const diff = now - date.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  if (mins < 1) return future ? 'in a moment' : 'just now';
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return future ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return future ? `in ${days}d` : `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
}

// ─── Overlay dismiss (Esc) ─────────────────────────────────────────────────

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onEscape]);
}
