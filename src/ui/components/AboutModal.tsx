import { FiExternalLink, FiGithub, FiGlobe, FiHeart, FiShield, FiZap, FiLock } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { openExternal } from '@/auth/bridge.js';
import { APP_VERSION } from '@/lib/version.js';
import { BrandMark, useEscape } from './primitives.js';

const CREATOR_URL = 'https://hariharen.space';

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
        <div className="mb-5">
          <div className="flex items-center gap-3">
            <BrandMark size={36} glow />
            <div className="font-display font-extrabold tracking-tight text-[16px]">Scync Desktop</div>
          </div>
          <div className="mono-label mt-1 pl-[48px]">v{APP_VERSION} · MIT</div>
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

        {/* Creator credit */}
        <div className="mt-5 rounded-xl border border-accent-border bg-accent-dim/40 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-full bg-accent/20 border border-accent-border text-accent-light font-display font-extrabold text-[13px] shrink-0">
              H
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-subtle">Designed &amp; built by</div>
              <div className="text-[13.5px] font-semibold text-text leading-tight">Hariharen</div>
            </div>
          </div>
          <button
            className="mt-2.5 w-full flex items-center justify-center gap-1.5 rounded-lg border border-accent-border bg-black/20 px-3 py-1.5 text-[11.5px] text-accent-light hover:bg-accent-dim transition-colors"
            onClick={() => openExternal(CREATOR_URL)}
          >
            <FiGlobe size={11} /> hariharen.space <FiExternalLink size={10} />
          </button>
          <p className="text-[10.5px] text-subtle text-center mt-2 flex items-center justify-center gap-1">
            Made with <FiHeart size={9} className="text-rose-400" /> for people who keep secrets
          </p>
        </div>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
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
