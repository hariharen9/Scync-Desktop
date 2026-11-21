import { useUiStore } from '@/stores/uiStore.js';
import { APP_VERSION } from '@/lib/version.js';

export default function AboutModal() {
  const open = useUiStore((s) => s.aboutOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setAboutOpen(false)}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <img src="/icons/128x128.png" alt="" className="w-10 h-10 rounded-lg" />
          <div>
            <div className="font-display font-extrabold tracking-tight">Scync Desktop</div>
            <div className="mono-label">v{APP_VERSION}</div>
          </div>
        </div>
        <p className="text-muted text-[13px] leading-relaxed">
          Local-first secrets vault paired with the Scync web app. Your vault is
          encrypted client-side; this machine only ever holds a derived key in
          memory while unlocked.
        </p>
        <p className="mono-label mt-4">
          AES-256-GCM · PBKDF2-SHA256 · TOTP RFC 6238
        </p>
        <div className="flex justify-end mt-4">
          <button className="btn-ghost" onClick={() => setAboutOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
