import { FiExternalLink, FiGithub, FiShield, FiZap, FiLock } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { openExternal } from '@/auth/bridge.js';
import { APP_VERSION } from '@/lib/version.js';
import { BrandMark, useEscape } from './primitives.js';

const FACTS = [
  { icon: <FiLock size={13} />, title: 'AES-256-GCM', body: 'Every value is sealed client-side before it leaves this device.' },
  { icon: <FiShield size={13} />, title: 'PBKDF2 · 310k', body: 'The vault key is derived from your master password — never stored.' },
  { icon: <FiZap size={13} />, title: 'Zero-knowledge', body: 'Scync servers only ever hold ciphertext and metadata.' },
];

export default function AboutModal() {
  const open = useUiStore((s) => s.aboutOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  useEscape(open, () => setAboutOpen(false));
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => setAboutOpen(false)}>
      <div className="modal-panel card w-full max-w-sm p-6 anim-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <BrandMark size={44} glow />
          <div>
            <div className="font-display font-extrabold tracking-tight text-[16px]">Scync Desktop</div>
            <div className="mono-label">v{APP_VERSION} · MIT</div>
          </div>
        </div>

        <p className="text-muted text-[13px] leading-relaxed">
          The desktop companion to the Scync web app and CLI. Same account, same vault,
          same master password — decrypted locally, never on a server.
        </p>

        <div className="mt-5 space-y-2.5">
          {FACTS.map((f) => (
            <div key={f.title} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid place-items-center w-6 h-6 rounded-md bg-accent-dim border border-accent-border text-accent-light shrink-0">
                {f.icon}
              </span>
              <div>
                <div className="text-[12.5px] font-semibold">{f.title}</div>
                <div className="text-[11.5px] text-muted leading-snug mt-0.5">{f.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <button
            className="text-[12px] text-muted hover:text-text flex items-center gap-1.5 transition-colors"
            onClick={() => openExternal('https://github.com/hariharen9/Scync-Desktop')}
          >
            <FiGithub size={13} /> Source
          </button>
          <button
            className="text-[12px] text-muted hover:text-accent-light flex items-center gap-1.5 transition-colors"
            onClick={() => openExternal('https://scync.space')}
          >
            scync.space <FiExternalLink size={12} />
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button className="btn-ghost" onClick={() => setAboutOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
