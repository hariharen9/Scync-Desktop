import { useEffect, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiInfo } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { friendlyError } from '@/lib/errors.js';

/** Re-render timer hook (returns Date.now(), ticking every `ms` while active). */
export function useNowInterval(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

export type ToastTone = 'neutral' | 'success' | 'error';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Fire-and-forget toast helper usable outside React. */
export function pushToast(text: string, detail?: string, tone: ToastTone = 'neutral') {
  const { showToast, clearToast } = useUiStore.getState();
  if (toastTimer) clearTimeout(toastTimer);
  showToast(text, detail, tone);
  const ttl = tone === 'error' ? 5200 : 3200;
  toastTimer = setTimeout(() => clearToast(), ttl);
}

/** Convenience wrappers so call sites read at a glance. */
pushToast.success = (text: string, detail?: string) => pushToast(text, detail, 'success');
pushToast.error = (text: string, detail?: string) => pushToast(text, detail, 'error');
/** Translate a thrown backend error into friendly copy (keeps the raw detail). */
pushToast.fromError = (e: unknown, fallback = 'Something went wrong') => {
  const friendly = friendlyError(e);
  pushToast(friendly.title || fallback, friendly.detail, 'error');
};

const TONE: Record<ToastTone, { icon: JSX.Element; ring: string; text: string }> = {
  neutral: { icon: <FiInfo size={15} />, ring: 'text-accent-light', text: 'text-text' },
  success: { icon: <FiCheckCircle size={15} />, ring: 'text-emerald-400', text: 'text-text' },
  error: { icon: <FiAlertTriangle size={15} />, ring: 'text-rose-400', text: 'text-text' },
};

export default function Toast() {
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast) setVisible(true);
    else setVisible(false);
  }, [toast]);

  if (!toast) return null;
  const tone = TONE[toast.tone ?? 'neutral'];

  return (
    <div className="fixed bottom-5 right-5 z-50 anim-fade-up" role="status" aria-live="polite">
      <div className="relative overflow-hidden rounded-xl border border-border-strong bg-panel-2/95 backdrop-blur-md shadow-2xl min-w-[240px] max-w-sm">
        <div className="flex items-start gap-2.5 px-3.5 py-3">
          <span className={`mt-0.5 shrink-0 ${tone.ring}`}>{tone.icon}</span>
          <div className="min-w-0 flex-1">
            <div className={`text-[12.5px] font-medium leading-snug ${tone.text}`}>{toast.text}</div>
            {toast.detail && <div className="mono-label mt-1 break-words normal-case tracking-normal">{toast.detail}</div>}
          </div>
          <button
            className="shrink-0 text-subtle hover:text-text transition-colors -mr-1 -mt-0.5"
            onClick={clearToast}
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {visible && (
          <div
            className={`h-0.5 origin-left ${toast.tone === 'error' ? 'bg-rose-500' : toast.tone === 'success' ? 'bg-emerald-500' : 'bg-accent'}`}
            style={{ animation: `toast-bar ${toast.tone === 'error' ? 5.2 : 3.2}s linear forwards` }}
          />
        )}
      </div>
    </div>
  );
}
