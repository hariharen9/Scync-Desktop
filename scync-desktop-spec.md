# Build "Scync Desktop": a standalone Mac + Windows app for an existing zero-knowledge vault

You are building **Scync Desktop**, an independent desktop client (macOS + Windows) for Scync, an existing
zero-knowledge secrets manager. The app plugs into the **same Firebase backend** (Firebase Auth + Firestore) that
the Scync web app and the `scync-cli` already use. It is a new, separate repository. It must run fully on its own:
no dependency on the web app, the CLI, or any server we operate.

Read this whole document before writing code. Where it disagrees with the reference source, **the source wins**.
Report every such disagreement instead of silently picking one.

---

## 0. Inputs and prerequisites

**Reference source (read-only, provided to you):** `scync-source.zip`, which contains two projects:

| Path | What it is | Use it for |
|---|---|---|
| `scync-cli/src/core/` | `crypto.ts`, `firestore.ts`, `types.ts`, `constants.ts`, `totp.ts`, `firebase.ts`, `vault-session.ts` | **Primary code to copy** (~1.5k lines, WebCrypto + Firebase JS SDK, already proven in production) |
| `scync-cli/src/auth/` | `loopback.ts`, `session.ts` | The Google loopback OAuth (PKCE) flow to port to Rust |
| `scync-cli/scripts/generate-google-client.mjs` | build-time injection of the Google Desktop client id/secret | Pattern to copy |
| `scync/AGENTS.md` | Code-verified architecture reference (crypto pipeline, Firestore data model, rules) | Data model and invariants |
| `scync/packages/core/src/` | Web-app core: `firestore.ts` (includes share-link creation, password change), `recovery`, `webauthn.ts` | Share links; anything the CLI lacks |
| `scync/firebase/firestore.rules` | Security rules | Understand what the backend enforces |

**Provided by the human (as env vars / CI secrets, never committed):**
- `SCYNC_GOOGLE_CLIENT_ID`, `SCYNC_GOOGLE_CLIENT_SECRET`: a Google OAuth client of type *Desktop app*, created in the
  same Google Cloud project as the Firebase project (so Firebase Auth accepts its tokens). Google treats the secret of
  an installed-app client as non-confidential, but GitHub push protection flags it, so it is injected at build time.
- Firebase public web config: copy `HOSTED_CONFIG` from `scync-cli/src/core/firebase.ts` (public by design; the same
  config ships in every browser that loads the web app). Support overriding it by env/config for self-hosters.
- Apple Developer ID + notarization credentials and a Windows code-signing option, **only needed in Phase 5**.
  Until then, build unsigned and say so in the README.
- A **throwaway test Google account with its own throwaway vault**. Never run write tests against a real user's vault.

---

## 1. Decisions already made (do not re-litigate; flag a problem if you find one)

- **Framework: Tauri 2** (Rust shell + system webview). UI in **React 18 + TypeScript + Vite + Tailwind v4 + Zustand**.
- **Why:** the backend contract (crypto + Firestore reads/writes + realtime listeners) already exists as portable
  TypeScript on the Firebase JS SDK. Reusing it removes the highest risks: byte-level crypto mismatch, write-shape
  mistakes that could corrupt real vaults, and missing realtime sync. Rust is used only where a desktop shell must
  do things a webview cannot: OAuth loopback, tray, global hotkey, clipboard, OS keychain, window management.
- **Independence:** the backend code is **vendored (copied) into this repo** under `src/backend/`, not linked or
  imported from another repo. Add `src/backend/PROVENANCE.md` recording the source repo, path, commit/version and
  every deliberate deviation. This repo talks directly to Firebase.
- **Same account, same vault, same master password.** Nothing about identity or crypto changes. A secret created here
  must appear in the web app and CLI, and vice versa.
- **License:** MIT. **Bundle id:** `space.scync.desktop`. **Product name:** Scync.

---

## 2. The backend contract (must match byte for byte)

### 2.1 Crypto (`crypto.ts` is the ONLY crypto entry point; copy it, do not rewrite it)
- Key derivation: `PBKDF2`, **SHA-256, 310,000 iterations**, 16-byte random salt (base64), input material is the
  string **`password + uid`** (plain concatenation, UTF-8), output a **non-extractable AES-256-GCM `CryptoKey`**
  (`encrypt`/`decrypt` usages). Salt and verifier live in Firestore `users/{uid}/meta/vault`.
- `encrypt(key, plaintext)` returns `{ iv, ciphertext }`: AES-256-GCM, **random 12-byte IV**, standard base64 for both.
- Verifier: `encrypt(key, "Scync_VALID_v1")`. Wrong password means a GCM auth failure, so `checkVerifier` returns false.
  **No password hash is ever stored.**
- Never write bespoke crypto elsewhere. UI code only calls store actions that wrap `src/backend`.

### 2.2 Firestore data model (all under `users/{uid}/`, plus root `shares/`)

| Collection | Encrypted fields | Plaintext metadata |
|---|---|---|
| `meta/vault` | `verifier` | `salt`, `createdAt`, `biometrics[]` (WebAuthn entries: **read-only for you; never write or modify this field**) |
| `secrets` | `encValue`, `encNotes` | name, service, type, environment, status, lastRotated, expiresOn, projectId, remainingCodes |
| `passwords` | `encPassword`, `encNotes` | name, username, url, category |
| `ssh_keys` | `encPrivateKey` | name, type, publicKey, fingerprint, hosts[], rotationDate |
| `totp_tokens` | `encSecret` | issuer, label, algorithm (SHA1/256/512), digits (6/8), period (30/60), icon |
| `certificates` | `encCertPem`, `encKeyPem` | name, subject, issuer, serialNumber, validFrom/To, isSelfSigned, fingerprint, hosts[] |
| `projects` | n/a | name, color, icon, description |
| `services` | n/a | name, color, icon |
| `shares/{shareId}` (root) | `encValue` | secretName, service, type, expiresAt, viewsAllowed\|null, viewsUsed, createdByUid, projectId, createdAt |

Rules you must respect and never try to bypass: all of `users/{uid}/**` is readable and writable only by that uid.
Writes use `serverTimestamp()` where the existing functions do. Reuse the existing `create*/update*/delete*/subscribeTo*`
functions rather than hand-rolling Firestore calls. Subscriptions are whole-collection `onSnapshot` with client-side
filtering; keep that behaviour. Recovery-code sets are JSON inside a secret's value. "Secret" and "password" are
different entities.

### 2.3 What you must NOT touch in v1
These operations rewrite or create the whole vault, so a bug is the most expensive kind. Leave them to the web app:
- first-time vault setup (`setupVault`)
- master password change (`changeVaultPassword`, an atomic re-encrypt of all five domains)
- account/data deletion
- recovery kit generation
- any write to `meta/vault`
If the user has no vault, show: "Set up your vault on the Scync web app first", the same message the CLI uses.

---

## 3. Architecture

```
scync-desktop/
  src-tauri/            Rust: oauth loopback, tray, hotkey, clipboard, keychain, windows, updater
  src/
    backend/            VENDORED from scync-cli/src/core (+ PROVENANCE.md). No UI imports. No Node APIs.
    auth/               webview-side auth glue (calls Rust for Google, SDK for sign-in)
    stores/             Zustand: vaultStore (key, lock state), dataStore (decrypted-on-demand views), uiStore
    ui/                 screens + components
    quick/              quick-search popup (its own entry/window)
  scripts/              generate-google-client (build-time injection), fixtures
  .github/workflows/    CI matrix: macos-latest + windows-latest
```

### 3.1 Porting the CLI core into a webview
`scync-cli/src/core` was written for Node. Port with the **smallest possible diff**:
- `crypto.ts`: already pure WebCrypto (`crypto.subtle`, `TextEncoder`, `btoa`); copy unchanged.
- `firestore.ts`, `types.ts`, `constants.ts`, `totp.ts`: copy unchanged unless a Node import blocks you.
- `firebase.ts`: it uses `node:fs`, `node:os`, `dotenv`, and a Node `FilePersistence`. Replace the config loading with
  build-time constants + optional override from the Tauri app-config dir, and use the Firebase JS SDK's default
  browser persistence (IndexedDB) for the Auth session. Do **not** enable Firestore persistent/offline cache in v1
  (the web app does not; plaintext metadata would otherwise sit on disk).
- `vault-session.ts`: drop the background-agent code (`AgentClient`) entirely. The desktop app is its own long-lived
  process; the in-process key is the session. Keep `deriveKey` + `checkVerifier` unlock logic.
- Pin the Firebase JS SDK to the same major as the CLI (`^10.14.1`). Pin all dependencies to exact versions.

### 3.2 Auth (Google + email/password)
- **Google:** do the loopback flow in **Rust** (port `scync-cli/src/auth/loopback.ts`: ignore the large HTML string, keep
  the logic): bind `127.0.0.1` on a random free port, redirect URI `http://127.0.0.1:<port>/callback`, scope
  `openid email profile`, **PKCE S256**, random `state` (verify it), open the system browser, receive the code,
  exchange it at Google's token endpoint with `client_id` + `client_secret` (Rust `reqwest`, which also avoids
  webview CORS), return `{ idToken, accessToken }` to the webview via a Tauri command. The webview then calls
  `signInWithCredential(auth, GoogleAuthProvider.credential(idToken, accessToken))`. Add a timeout (e.g. 3 minutes), a
  cancel button, and a minimal self-contained success page (**no external fonts or CDN assets** on that page).
- **Email/password:** `signInWithEmailAndPassword`, as in the CLI's `login.ts`.
- After sign-in the uid must equal the uid the web app sees for the same account, since it feeds key derivation.
  Add a Phase 0 check that proves this.
- Build-time client injection: copy the pattern of `generate-google-client.mjs` (env vars baked into a generated,
  git-ignored module; preserve existing values when env is absent; empty values mean Google sign-in is disabled with
  a clear message). Do it in Rust (`build.rs` / `option_env!`) or in the Vite build, whichever is simpler.
- Sign-out clears the Firebase session and locks the vault.

### 3.3 Vault lock model (security-critical)
- The derived key is **never persisted**, never logged, never sent across windows. It lives only as a non-extractable
  `CryptoKey` in the **main window's** JS memory. Plaintext of secrets exists only transiently (reveal/copy), is
  cleared on lock, and is never stored in Zustand beyond the reveal timeout.
- **Lock triggers:** manual; idle timeout (default 5 min, configurable); window hidden to tray for N minutes
  (default 5); system sleep / screen lock (cross-platform heuristic: a timer whose wall-clock jump exceeds ~30 s
  implies suspend, then lock on resume; add platform-specific events later if easy); app quit; sign-out.
- **Lock action:** drop the key, clear all decrypted state, tell the quick-search window to clear its results, and
  show the unlock screen. The Firebase Auth session is separate and survives lock (unlock then needs only the master
  password, as in the CLI).
- Unlock = `getVaultMeta` then `deriveKey(password, uid, salt)` then `checkVerifier`. Run PBKDF2 in the webview's
  WebCrypto (async, off the main thread already); show a progress state. Rate-limit retries client-side (e.g.
  exponential delay after 5 failures).

### 3.4 Quick-search popup (headline feature)
Two webview windows exist in separate JS contexts, and **the key must not be shared**. Therefore:
- **Main window** (label `main`) owns the vault key and all data. Closing it only **hides** it; the process stays alive
  in the tray (this is what makes the hotkey work). Quit only via tray menu or Cmd/Ctrl+Q.
- **Popup window** (label `quick`): frameless, transparent, always-on-top, skip-taskbar, ~640 px wide, centred on the
  monitor under the cursor, hides on blur and on Esc. Toggled by the global hotkey.
- **Protocol (Tauri events, popup to main and back):**
  - `quick:query {q}` then main replies with **metadata-only** results (id, kind, name, service, environment,
    project, status). No secret values, ever.
  - `quick:copy {id, kind, field}` then **main decrypts** and hands the plaintext to a Rust command
    `copy_secret(text, clear_after_secs)`. Rust writes the clipboard and after the timeout clears it **only if the
    clipboard still holds our value** (compare a hash). Default 20 s, configurable. The plaintext never reaches the
    popup. For TOTP entries, offer "Copy code" the same way.
  - Popup shows a brief "Copied, clears in Ns" confirmation, then hides.
- **If the vault is locked:** the hotkey shows the popup in a locked state with an "Unlock" action that shows and
  focuses the main window on the unlock screen. Do not take the master password in the popup in v1.
- Search: fuzzy match across name / service / project / environment / username / issuer / hosts (plaintext metadata
  only), keyboard-first (type, arrows, Enter = copy value, Cmd/Ctrl+Enter = copy secondary field, Esc = close).
- Default hotkey `CommandOrControl+Shift+Space`, **user-configurable**. On registration failure (already taken), show
  a clear error and let the user choose another. Use the official `tauri-plugin-global-shortcut`.

### 3.5 Tray / menu bar, lifecycle
- Tray icon with menu: Open Scync, Quick Search, Lock now, Auto-lock timeout, Launch at login, Check for updates, Quit.
  Show lock state in the icon or tooltip. Use Tauri's built-in tray API. macOS template (monochrome) icon.
- `tauri-plugin-single-instance` (second launch focuses the existing instance); `tauri-plugin-autostart` (opt-in,
  default off); macOS option to hide the Dock icon (accessory activation policy) so Scync lives in the menu bar.
- Stretch (do not block on it): on macOS make the popup appear over full-screen apps (NSPanel-style window).

### 3.6 Hardening
- **Tauri capabilities/permissions: least privilege.** Grant each window only the commands it needs. The popup gets
  no clipboard or fs access of its own.
- **Strict CSP**, `default-src 'self'`, with `connect-src` limited to exactly the Google/Firebase hosts the SDK needs
  (determine empirically and keep it minimal). No inline script, no remote scripts, no remote fonts: **bundle fonts
  locally** (the web app uses Syne, Plus Jakarta Sans, DM Mono).
- Disable devtools in release builds. Enable window content protection (best-effort screenshot/recording
  protection) as a setting, default on. Never log secrets, tokens, or master passwords (including in panics or
  crash reports). No analytics or telemetry of any kind.
- External links open in the system browser only. No navigation away from the app origin.
- Dependency hygiene: `cargo audit`, `npm audit` in CI; lockfiles committed; exact pins.

### 3.7 UI scope and look
Same dark, emerald-accent visual language as the web app (accent `#10b981`, near-black backgrounds), sized for a
desktop window: sidebar navigation, a list/detail layout, and a command bar. Screens: Unlock, Secrets (grouped by
project, filters by service/environment/status), Passwords, TOTP (live codes with countdown), SSH Keys, Certificates,
Projects, Settings (auto-lock, clipboard clear, hotkey, launch at login, content protection, sign out), About.
Reveal-on-click with auto-hide, copy buttons, expiry/rotation "attention" badges using the existing
`getAttentionSecrets` logic.

---

## 4. Scope

**v1 IN:** Google + email/password sign-in; unlock/lock; realtime read of all five domains + projects + services;
search; reveal/copy; create/edit/delete for the five domains and projects; TOTP live codes; share-link creation
(copy `createShare` from the web app core, **including its URL format and key-in-URL-fragment behaviour**); SSH key and
certificate viewing/copying; tray; global quick search; auto-lock; clipboard auto-clear; auto-update; signed builds.

**v1 OUT:** vault setup, password change, account deletion, recovery kit, WebAuthn biometrics, `.env` import/export,
password-manager importer, version history UI, team features, browser extension. (Note them in `ROADMAP.md`.)

**v1.1:** Touch ID / Windows Hello unlock (see Phase 4).

---

## 5. Phased plan with acceptance criteria

Work phase by phase. After each phase: run the test suite, update docs, and report (what was built, what deviates from
this prompt, what is risky or unresolved). **Do not start the next phase until the current one's criteria are met.**

### Phase 0: Spike and go/no-go (small, throwaway-quality OK)
Goal: prove the three risky claims on **both** macOS and Windows.
1. Rust loopback Google OAuth returns an id token; `signInWithCredential` succeeds; **uid equals the web app's uid**
   for the same account.
2. With the vendored core: `getVaultMeta` + `deriveKey` + `checkVerifier` succeed with the correct password and
   fail with a wrong one; measure and report PBKDF2 time on each OS.
3. Realtime: `subscribeToSecrets` delivers live updates; **a secret created in the web app appears and decrypts here,
   and a secret created here appears and decrypts in the web app** (use the throwaway account).
4. The global shortcut registers, and a frameless popup window toggles with it on both OSes.
**Gate:** all four pass on both OSes, or stop and report which fails and why.

### Phase 1: Foundation (read-only)
Repo scaffold, CI (build + lint + tests on macOS and Windows), vendored backend with `PROVENANCE.md`, auth, unlock/lock
state machine, read-only lists for every domain, search, reveal/copy with clipboard auto-clear.
**Acceptance:** unit tests for crypto vectors and lock transitions pass; manual run against the throwaway vault shows
all domains; locking clears decrypted state.

### Phase 2: Full CRUD + sharing
Create/edit/delete for the five domains and projects/services; TOTP live codes; share-link creation and revoke;
optimistic UI that reconciles with snapshots.
**Acceptance:** Firebase **emulator** integration tests (pattern: `scync-cli`'s `test:emulator`, i.e.
`firebase emulators:exec --project demo-scync ...`) cover every write path; round-trip interop with the web app
verified by hand and documented; **no writes outside the documented shapes**.

### Phase 3: Desktop-native layer
Tray, global quick search with the event protocol in section 3.4, single-instance, autostart, hide-to-tray, auto-lock
triggers (including sleep heuristic), clipboard auto-clear in Rust, settings persistence (non-secret settings only, in
the app-config dir).
**Acceptance:** quick search copies a secret without the popup ever holding plaintext (prove with a test or a
logged assertion); locked-state hotkey flow works; clipboard clears only when unchanged; hotkey conflict is handled.

### Phase 4: Biometric unlock (separate, riskier; do last)
`tauri-plugin-biometric` is **mobile-only**, so desktop needs custom Rust: macOS Keychain item protected with
biometry access control (LocalAuthentication / Security.framework) and Windows Hello (`KeyCredentialManager` /
`UserConsentVerifier` via the `windows` crate). Store a **locally wrapped** unlock secret in the OS keychain /
credential store; it is device-local and **must never be written to Firestore** (`meta/vault.biometrics` belongs to the
web app's WebAuthn scheme and is wiped on password change). Provide a clear fallback to the master password, an
explicit "disable and forget this device" action, and invalidate the stored secret if the biometric set changes.
Write a short threat-model note first and get it reviewed before implementing.

### Phase 5: Packaging and release
GitHub Actions matrix builds: Windows (NSIS/MSI) and macOS (universal `.dmg`; **the macOS build cannot be produced
on Windows, so the CI runner does it**). Code signing + macOS notarization when credentials exist. `tauri-plugin-updater`
with signed update manifests on GitHub Releases (generate the updater keypair; the private key stays in CI secrets).
Release checklist, README install instructions, and an honest "unsigned build" warning section until signing exists.

---

## 6. Testing requirements
- **Unit (Vitest):** crypto round-trip and **golden fixtures** (fixed password/uid/salt plus ciphertexts produced by the
  web app's core; the build fails if decryption differs), lock state machine, search ranking, TOTP vectors (RFC 6238).
- **Emulator integration:** auth + Firestore rules + all CRUD against the Firebase emulator. Never against production
  in CI.
- **Rust tests:** PKCE verifier/challenge generation, `state` validation, clipboard-clear-only-if-unchanged logic.
- **Manual interop checklist** (committed as `docs/INTEROP.md`): create/edit/delete in each of web, CLI, and desktop and
  confirm the others see it.

## 7. Working agreement
- Ask before: adding a dependency that touches crypto, networking, or auth; changing any data shape; deviating from
  section 2 or 3. Do not ask for routine decisions; make them and record them in `DECISIONS.md`.
- Keep `README.md`, `DECISIONS.md`, `PROVENANCE.md`, `ROADMAP.md`, `SECURITY.md` (threat model and what is deliberately
  out of scope) current. Commit in small, reviewable steps.
- Never invent API shapes, field names, or crypto parameters: read the source. Never claim something works without
  running it on the target OS; say plainly what you could not test (for example, "not run on macOS").
- Do not print, log, or commit secrets, tokens, or the Google client secret.

## 8. Explicit non-goals
No server of our own. No telemetry. No new crypto or key-derivation scheme. No change to the Firestore schema or
rules. No Electron. No dependency on Node at runtime.
