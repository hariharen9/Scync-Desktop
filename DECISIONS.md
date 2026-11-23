# Decision log — Scync Desktop

Short-lived entries that explain **why** the desktop app is shaped the way it
is. Newest at the bottom. Today's context: desktop MVP targeting Windows,
reusing the existing web app's vault.

## D1 — Vendor the backend instead of sharing a workspace package

`scync/` (web) and `scync-cli/` are frozen for this build: their code is
**copied** into `src/backend/` and adapted, never referenced or modified.
Rationale: the constraint "don't touch web and CLI code" would otherwise
force a workspace refactor (monorepo packages/core) that changes three apps
at once. Vendoring trades some duplication for a hard, checkable boundary.
Every copied file is listed with its origin and deviations in
`PROVENANCE.md`. The cost is real: some contract changes now need to be
re-applied here by hand — `docs/INTEROP.md` is the checklist that guards it.

## D2 — Crypto stays byte-identical, not "compatible"

`crypto.ts`, `types.ts`, `constants.ts`, `firestore.ts`, `totp.ts` are
byte-identical copies from the CLI core (including PBKDF2 310k iterations,
AES-256-GCM, key = `password + uid`, verifier = `encrypt(key, "Scync_VALID_v1")`).
Golden tests (`tests/crypto.test.ts`) pin the contract so a careless desktop
"tweak" cannot silently fork the vault format.

## D3 — Frontend Firebase integration instead of Node CLI core

The CLI's backend runs in Node and its Firebase client works with global
fetch/`undici`. The desktop UI runs in the webview, so the web app's
browser-shaped Firebase integration (IndexedDB persistence, browser
`Auth`Listeners) was vendored and adapted (`src/backend/firebase.ts`) with the
hosted config hardcoded and `setBaseConfig` kept for self-hosters. Pinned to
`firebase@10.14.1` — the same major as the CLI — so the wire behavior
(REST endpoints, field shapes) cannot drift between majors.

## D4 — Google OAuth via Rust loopback (not Firebase popup)

`signInWithPopup` needs a stable HTTPS origin for the OAuth redirect, which
the desktop webview (`tauri://localhost` on macOS, `http://tauri.localhost`
on Windows) does not provide. Instead a Rust command runs a loopback
flow: ephemeral port, PKCE S256, constant-time state check, opens the system
browser, self-contained success page. Tokens return to JS via
`signInWithCredential(GoogleAuthProvider.credential(idToken, accessToken))`,
so after that point everything (uid, token persistence, Firestore rules) is
exactly the web app's flow. Client id/secret are injected at build time by
`scripts/generate-google-client.mjs` from env vars and live only in a
git-ignored generated file. Share links are hardcoded to
`https://scync.space/share/...` because `window.location.origin` would be the
webview origin (documented in PROVENANCE as the one place web semantics were
replaced, not copied).

## D5 — The main window owns everything secret; the popup owns nothing

The quick-search popup (`quick.html`) is a separate, always-on-top,
frameless window. Its data flow is deliberately one-shaped: it emits
`quick:query`, receives metadata-only results, and requests `quick:copy`.
The **main** window resolves the copy — decrypts on demand, calls the Rust
clipboard command, and reports back a result event. Plaintext never crosses
the window boundary, so a compromised or injected popup cannot read vault
values; its capabilities file only allows core window commands and hide.

## D6 — Rust owns no crypto

Rust handles only what a webview can't: tray, hotkeys, menu, loopback OAuth
server, system clipboard, single-instance, autostart, content protection.
It never touches the vault key or Firestore. Consequence: the entire
security review of vault confidentiality is TypeScript + tests, and Rust
changes stay low-risk.

## D7 — Lock model: key dropped, ciphertext retained

`lockNow` nulls the derived key and (for idle/hidden/tray locks) tears down
Firestore subscriptions and clears the data store. Metadata survives only
while signed in; ciphertext arrays are re-fetched on next unlock via
whole-collection snapshots. Rate limiting (5 attempts, then exponential
backoff capped at 60 s) is client-side only — the same posture as the web
app; server-side attempt limits are documented as a gap in SECURITY.md.

## D8 — Settings in Rust-managed JSON, non-secret only

`settings.json` (hotkey, idle/hidden lock minutes, clipboard clear seconds,
content protection, and nothing else) lives in the OS app-config dir and is
read/written by Rust commands. Nothing secret is stored there by design;
Firebase auth tokens are handled by the SDK's own IndexedDB persistence.

## D9 — Main window close hides to tray

The spec's hotkey + tray posture only makes sense if the process survives
window close. Quit is explicit (tray menu → Quit). The quick popup hides
itself on blur and on Esc; the global shortcut toggles it, positioned on the
cursor's monitor.

## D10 — Share keys live in a separate desktop module

`generateShareKey` / `exportShareKey` / `importShareKey` were added to the
web core's share flow in the web repo; to keep the CLI's `crypto.ts`
byte-identical, they live in `src/backend/share-keys.ts` here.

## D11 — Updater deferred

The Tauri updater plugin needs a signing key pair and an update feed URL that
don't exist yet for this project. The bundle target is left out of
`tauri.conf.json`; wiring the updater is a ROADMAP item, not silent debt.

## D12 — `npm audit` posture

17 vulnerabilities reported at install time, all transitive inside
`firebase@10` (undici et al.). Same exposure as the frozen web app/CLI pin;
accepted for this milestone and recorded here rather than silently upgrading
the shared Firebase major (which would risk contract drift; see D3).

## D13 — TOTP decryption cost: per window, not per second

The TOTP view decrypts each token's secret once per code window (30/60 s) and
ticks the countdown locally; the quick popup decrypts only on copy. Crude
alternative (decrypt every second) was measured unnecessary and would burn
battery; correctness is the same because code derivation is deterministic on
the decrypted secret.

## D14 — UX polish pass: shared primitives, command palette, motion

Elevated the MVP into a cohesive product without touching the backend
contract (`src/backend/` is unchanged; PROVENANCE stands):

- **Design tokens live in `src/styles/app.css`.** One motion vocabulary
  (`fade-up`/`scale-in`/`pop-in` plus staggered entrances), one control set
  (`.field`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.icon-btn`,
  `.chip`, `.kbd`, `.skeleton`), and a slightly lifted `--color-subtle` for
  legible metadata. The look still matches the web app's dark emerald
  language; density is tuned for a desktop window.
- **`src/ui/components/primitives.tsx`** is the shared kit (BrandMark, Avatar,
  Kbd/ModKbd, Chip, Skeleton, useCopyFeedback, useEscape). `ModKbd` renders
  ⌘ on macOS and Ctrl elsewhere so keyboard hints are never wrong.
- **Command palette (`⌘K`/`Ctrl+K`)** searches the metadata-only index and
  copies without painting plaintext, exactly like the quick popup — same
  `bridge.copySecret` boundary. Enter copies, Tab jumps to the item's view.
- **Quick popup** gained group labels, a platform-correct secondary-field
  hint, a proper locked state with "Open Scync to unlock", and inline copy
  errors. Still metadata-only; the split-window key boundary is unchanged.
- **Affordance edits are UI-only.** Reveal now offers decrypt-and-copy without
  revealing; lists show skeletons until their first snapshot (`dataStore.loaded`);
  every list is arrow-key navigable with `/` to focus search; write failures
  are translated by `src/lib/errors.ts` into actionable copy.
- **New Rust command `open_external`** opens http(s) links in the system
  browser (the spec's external-link rule had no implementation). It rejects
  any non-http(s) scheme. Registered in `main.rs` and wrapped by
  `openExternal()` in `auth/bridge.ts`, which falls back to `window.open` in
  browser dev.
- **Lock reasons are surfaced.** `lockNow(reason)` records idle/timeout/
  suspend causes and the unlock screen explains "Locked automatically · idle
  timeout"; manual/tray locks stay silent.

None of this changes a single Firestore write shape, crypto parameter, or
`meta/vault` behaviour. The full suite (tsc, 49 vitest, vite build, cargo
build/test) is green, and every screen was inspected in a browser against
seeded metadata.

## D15 — Tag-triggered release matrix across three platforms

Pushing a `v*.*.*` tag runs `.github/workflows/release.yml`, which builds
Windows (x64, ARM64), macOS (Intel, Apple Silicon) and Linux (x64, ARM64) in
parallel and publishes one GitHub Release with every artifact attached.

- **Native builds per OS, no cross-compiling between operating systems.**
  Tauri links against the platform webview (WebView2, WKWebView,
  WebKitGTK), so a Windows host cannot produce a macOS bundle. Only the
  Linux ARM64 leg is a true cross-build (GCC aarch64 toolchain plus
  `PKG_CONFIG_ALLOW_CROSS`).
- **macOS ships per-architecture `.dmg`s rather than one universal binary.**
  Universal builds require a `lipo` merge step of the two `.app` trees; two
  DMGs are simpler, smaller, and let users pick their architecture. Revisit
  if a single download matters more than size.
- **Linux targets added to `tauri.conf.json`** (`deb`, `rpm`, `appimage`).
  They were absent, so a Linux job would have built nothing.
- **Version is taken from the tag** by `scripts/sync-version.mjs`, which
  writes `package.json` and `tauri.conf.json`. `Cargo.toml` is not bumped:
  that dirties `Cargo.lock` and would break `cargo --locked` in the same run.
- **Artifacts are unsigned.** The workflow does not pretend otherwise; the
  README states the macOS Gatekeeper and Windows SmartScreen consequences.
  Signing and notarization slot into the same jobs once credentials exist.

`ci.yml` stays as-is for fast feedback on branches; the release matrix is
deliberately separate so ordinary pushes never burn macOS/Linux runner time.
