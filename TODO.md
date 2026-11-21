# TODO — working list

Feature-level phases live in `ROADMAP.md`; this file is the operational,
do-next list for getting the MVP to releasable. Keep both in sync when an
item moves; delete items here when completed (the git log remembers).

## 1. Verification pass (needs a machine / live account — blockers for "releasable")

- [ ] Full manual run: `npm run tauri dev` — sign-in (Google + email),
      setup-vault handoff, unlock, search, reveal, copy, lock, logout.
      One round-trip done informally; redo after polish changes.
- [ ] Two-client interop session: desktop + web (and CLI) on one account —
      create/edit/delete from each side, confirm web sees desktop changes and
      vice versa; confirm desktop never writes `meta/vault` (Firestore console).
      Checklist in `docs/INTEROP.md` §6.
- [ ] First-run UX on a machine with no vault: NoVault screen copy is accurate
      vs. what the web app offers (create in web → desktop just signs in).
- [ ] Quick popup end-to-end: set hotkey in Settings, spawn from keypress while
      locked and while unlocked, copy via popup, watch `clearSecs` clipboard wipe.
- [ ] Auto-lock matrix: idle timer, lock-on-suspend heuristic (see §4), hotkey
      lock, tray lock — all four wipe the key and redirect to Unlock.
- [ ] `npm run tauri build` (untested): bundle produces a working installer;
      confirm `contentProtected` has no visible side effects in debug.
- [ ] Google OAuth first live run with the shared CLI client id: loopback
      redirect registered, consent screen branding mentions Scync, token lands
      in OS keychain (verify with a restart of the app).

## 2. Fix / small polish batch (no design changes)

- [ ] Code-split the 875 kB main chunk (firebase is most of it): dynamic-import
      firebase behind a lazy init so first paint of the sign-in screen is fast.
- [ ] Loading skeletons for Secrets view first onSnapshot (spinner exists;
      skeletons match the spec's polish bar).
- [ ] Window state persistence: restore size/position between launches
      (`window-state` plugin) — spec lists remembered windows.
- [ ] Tray icon + menu extras: double-click-to-restore, tooltip shows lock state.
- [ ] Error toasts for Firestore write failures are generic — surface the
      specific offline/permission copy from `errors.ts` (verify all paths).
- [ ] Keyboard pass: tab order in modals, Enter submits, Esc cancels uniformly;
      focus trap in FormModal/ConfirmModal.
- [ ] Empty-state illustrations on first open (currently text-only EmptyState).
- [ ] Version display: show app version in Settings + About (about modal has it;
      add to Settings footer) — `__APP_VERSION__` already wired.

## 3. From ROADMAP that should be pulled forward

- [ ] Env-file import/export (`ROADMAP.md` Phase 4) — highest-frequency
      developer feature the web has that desktop lacks.
- [ ] Secret version history render + restore (data already round-trips).
- [ ] Dark/light toggle (Phase 7 quick win; dark-only today).
- [ ] Import from 1Password/Bitwarden exports — reuses CLI CSV parser; big
      onboarding win.

## 4. Hardening (from `SECURITY.md` gaps, when "alpha" stops fitting)

- [ ] Server-side unlock attempt limiting (decision needed at web/CLI level).
- [ ] Lock-on-suspend: OS power events instead of wall-clock heuristic once
      Tauri exposes them.
- [ ] Fuzz `oauth.rs` callback parsing; capability JSON review pass.
- [ ] macOS verification sprint (needs a Mac): content protection, `.icns`,
      system-browser OAuth, shortcut modifiers.
- [ ] Updater plugin + code signing (`ROADMAP.md` Phase 5) — gate for any
      distribution beyond sideloading.

## 5. Accepted-as-is (revisit dates, do not silently drop)

- Webview-plaintext memory exposure — inherent, documented in `SECURITY.md`.
- Google client secret in binary — OAuth installed-app reality, documented.
- 17 npm-audit findings, transitive in firebase@10.14.1/undici — reviewed in
  `DECISIONS.md` D12; re-audit when firebase bumps.
- Client-side-only rate limiting on unlock attempts.
- SecretsView project filter stores a project name, not id (code comment
  documents why; revisit if ids become user-visible).
