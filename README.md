# Scync Desktop

Zero-knowledge secrets manager for the desktop — the Tauri 2 + React companion
to the Scync web app and `scync-cli`. Same Firebase backend, same
byte-compatible crypto, same Firestore documents.

## Status

Alpha. Windows is the only platform built and tested so far; macOS/Linux
targets compile with the same sources but are unverified (see ROADMAP).

## Stack

- **Tauri 2** (Rust shell): tray, global hotkey, quick-search popup, loopback
  Google OAuth, system clipboard with auto-clear, single instance, launch at
  login, live content protection.
- **React 18 + Vite 6 + Tailwind v4 + Zustand** for the UI.
- **Firebase JS SDK 10.14.1** (same major as the CLI) talking to the shared
  Firestore; whole-collection `onSnapshot` with client-side filtering — byte
  identical read/write shapes to the web app.
- **Crypto**: PBKDF2-SHA256 (310,000 iterations) → AES-256-GCM via WebCrypto.
  Key input is `password + uid` — identical to the web app and CLI.

## Development

```bash
npm install
npm run tauri dev        # full app (Rust + Vite dev server on :1420)
npm run dev:vite         # UI only in a browser (Rust features degraded)
npm test                 # vitest (crypto, lock FSM, search, TOTP RFC vectors)
cargo test               # in src-tauri/ (OAuth PKCE, state validation)
```

Google sign-in is compiled in at build time:

```bash
SCYNC_GOOGLE_CLIENT_ID=... SCYNC_GOOGLE_CLIENT_SECRET=... npm run generate-google-client
```

Without it the Google button shows a disabled-state message and email/password
sign-in still works. Never commit `src/generated/google-client.ts` (git-ignored).

## Releasing

Pushing a version tag builds every platform and publishes a GitHub Release:

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` runs these matrices in parallel:

| Platform | Runners | Architectures | Artifacts |
|---|---|---|---|
| Windows | `windows-latest` | x64, ARM64 | `.exe` (NSIS), `.msi` |
| macOS | `macos-latest` | Intel, Apple Silicon | `.dmg` (`.app` inside) |
| Linux | `ubuntu-22.04` | x64, ARM64 | `.deb`, `.rpm`, `.AppImage` |

Notes:

- The tag version is written into `package.json` and `tauri.conf.json` at build
  time (`scripts/sync-version.mjs`), so artifacts carry the tag's version.
  `Cargo.toml` is left alone deliberately: bumping it would dirty `Cargo.lock`
  and break `cargo --locked`.
- Tags containing a suffix (`v0.2.0-beta.1`) publish as pre-releases.
- Requires repo secrets `SCYNC_GOOGLE_CLIENT_ID` / `SCYNC_GOOGLE_CLIENT_SECRET`;
  absent, the build still succeeds with Google sign-in disabled.
- **Nothing is code-signed.** macOS builds are unsigned, so users must
  right-click → Open, and Windows shows a SmartScreen warning until signing
  credentials exist (ROADMAP Phase 5).

## Architecture in one screen

```
src/
  backend/     Vendored crypto + Firestore layer (see PROVENANCE.md)
  stores/      vaultStore (key + lock FSM) · dataStore (ciphertext mirror)
               uiStore (views, settings)
  lib/         autoLock · clipboard · search (metadata-only fuzzy)
  ui/          App gate chain → Shell → per-domain views
  quick/       Quick popup window (metadata only, never plaintext)
src-tauri/
  src/main.rs  Window/tray/hotkey lifecycle
  src/commands.rs  Tauri commands (oauth bridge, clipboard, settings)
  src/oauth.rs Loopback Google OAuth + PKCE
  src/settings.rs  Non-secret settings.json
```

Trust boundaries:

- The vault key lives **only** in the main window's JS memory as a
  non-extractable `CryptoKey`.
- The quick popup receives **metadata only**; on `quick:copy` the main window
  decrypts and hands the value straight to the Rust clipboard command.
- Rust never sees the vault key or any decrypted value (only the transient
  copied secret, auto-cleared after N seconds if unchanged).

## Hard rules

- Never write to `users/{uid}/meta/vault` from the desktop — vault setup,
  password change, and biometric setup belong to the web app.
- Backend contract changes require updating the web app and CLI in the same
  change set (they live outside this repo — do not edit them from here).
- All plaintext display paths go through the reveal-on-click component with a
  15 second auto-hide.

See `DECISIONS.md` for the reasoning log and `SECURITY.md` for the threat
model. `docs/INTEROP.md` is the cross-client compatibility checklist.
`TODO.md` is the short-term working list (what to polish and verify next);
`ROADMAP.md` holds the longer phases.
