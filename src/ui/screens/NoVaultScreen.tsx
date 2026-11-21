/**
 * The "no vault" gate — same message the CLI uses. Setup happens on the web
 * app; the desktop never writes meta/vault in v1.
 */
export default function NoVaultScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="card w-full max-w-md p-8 text-center">
        <h1 className="font-display text-lg font-bold mb-3">Set up your vault on the Scync web app first</h1>
        <p className="text-sm text-muted mb-6">
          Signed in as <span className="text-text">{email}</span>, but this account has no vault
          yet. Create one at <span className="text-accent-light">scync.space</span> (choose a
          master password you will not lose — there is no recovery), then unlock here.
        </p>
        <button className="btn-ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
