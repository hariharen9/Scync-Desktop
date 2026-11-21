# Roadmap

Phase ordering follows the desktop spec; items are grouped but each is small
enough to ship alone. Unchecked = not started; checkbox order is priority.

## Phase 4 — closing gaps to the web/CLI apps

- [ ] Env-file import/export (web: `.env` batch import; adds `env_imported` /
      `env_exported` ledger events)
- [ ] Vault activity ledger UI (actions are already typed in the backend;
      desktop has no write path — decide deliberately to avoid double-ledger)
- [ ] Recovery-code usage tracking UI (remainingCodes decrement flow)
- [ ] Secret version history (versions array already round-trips; render diff +
      restore)
- [ ] Biometric / OS keychain unlock (needs key-blob storage design — the web
      app's biometric flow must remain the writer)

## Phase 5 — platform and distribution

- [ ] Updater plugin: signing key ceremony + update feed URL; re-add
      `updater` bundle target (`DECISIONS.md` D11)
- [ ] Code signing on Windows (certificateThumbprint is null today)
- [ ] macOS verification pass: `contentProtected`, system-browser OAuth,
      tray icon sizing, global-shortcut modifiers, `.icns` rendering
- [ ] Linux build (AppImage/deb) + tray parity checks
- [ ] Auto-update UX: in-app release notes dialog, staged rollout alerting

## Phase 6 — hardening

- [ ] Server-side unlock attempt limiting (cross-client; blog the posture in
      SECURITY.md)
- [ ] Lock-on-suspend: replace the wall-clock heuristic with OS power events
      when Tauri exposes them
- [ ] Pagefile/hardening on Windows: evaluate `VirtualLock` for the Rust-side
      static buffers (OAuth tokens, clipboard hash)
- [ ] Manual security review pass on `quick/*` capability JSON vs spec
- [ ] Fuzz `oauth.rs` callback parsing against hostile query strings

## Phase 7 — quality of life

- [ ] Global quick settings: light-dark theme toggle (dark-only today)
- [ ] Drag-reorder within project groups
- [ ] Import from 1Password/Bitwarden export formats (CLI has CSV — reuse its
      parser, kept desktop-vendored)
- [ ] Widget-like second window per project (exploratory)
