/**
 * The "no vault" gate — same message the CLI uses. Setup happens on the web
 * app; the desktop never writes meta/vault in v1.
 */
import { FiArrowRight, FiExternalLink, FiLogOut } from 'react-icons/fi';
import { openExternal } from '@/auth/bridge.js';
import { BrandMark, Wordmark } from '@/ui/components/primitives.js';

const WEB_URL = 'https://scync.space';

export default function NoVaultScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const openWeb = () => openExternal(WEB_URL);

  return (
    <div className="h-full w-full overflow-y-auto grid-bg">
      <div className="min-h-full flex flex-col">
        <header className="flex items-center gap-2.5 px-6 py-4 border-b border-border">
          <BrandMark size={26} />
          <Wordmark small />
        </header>
        <div className="flex-1 grid place-items-center p-6">
          <div className="w-full max-w-md card p-8 text-center anim-scale-in">
            <div className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-dim border border-accent-border text-accent-light mb-5">
              <span className="font-display font-extrabold text-xl">S</span>
            </div>
            <h1 className="font-display text-[19px] font-bold tracking-tight">
              Set up your vault on the web first
            </h1>
            <p className="text-[13px] text-muted mt-3 leading-relaxed">
              Signed in as <span className="text-text font-medium">{email}</span>, but this account has no
              vault yet. Create one at <span className="text-accent-light">scync.space</span> — choose a
              master password you will not lose, because there is no recovery.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button className="btn-primary w-full" onClick={openWeb}>
                Open scync.space <FiExternalLink size={13} />
              </button>
              <button className="btn-ghost w-full" onClick={onSignOut}>
                <FiLogOut size={13} /> Sign out
              </button>
            </div>
            <p className="mono-label mt-5 flex items-center justify-center gap-1.5">
              Then return here and unlock <FiArrowRight size={10} />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
