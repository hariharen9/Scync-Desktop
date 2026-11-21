import { useEffect, useState } from 'react';
import { useUiStore } from '@/stores/uiStore.js';

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

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Fire-and-forget toast helper usable outside React. */
export function pushToast(text: string, detail?: string) {
  const { showToast, clearToast } = useUiStore.getState();
  if (toastTimer) clearTimeout(toastTimer);
  showToast(text, detail);
  toastTimer = setTimeout(() => clearToast(), 3200);
}

export default function Toast() {
  const toast = useUiStore((s) => s.toast);

  if (!toast) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="px-4 py-2.5 rounded-lg text-[13px] shadow-xl border bg-panel border-border max-w-sm">
        <div>{toast.text}</div>
        {toast.detail && <div className="mono-label mt-0.5">{toast.detail}</div>}
      </div>
    </div>
  );
}
