# Security model — Scync Desktop

## What protects your vault

- **Zero-knowledge.** All pre-encryption/decryption happens in the main
  window's webview with WebCrypto. The server (Firestore) and even this
  desktop's Rust layer never see plaintext or the vault key.
- **Key derivation.** AES-256 key = PBKDF2-SHA-256, 310,000 iterations over
  `master password + uid` with a per-vault random salt. The key is a
  non-extractable `CryptoKey` held only in JS memory while unlocked.
- **Vault unlock verifier.** `users/{uid}/meta/vault` stores
  `encrypt(key, "Scync_VALID_v1")` — deriving with the wrong password fails
  GCM authentication, so unlock is checkable without revealing anything.
- **Storage.** Firestore holds ciphertext + metadata. Rest saves PEM text;
  the private key PEM, when present, is encrypted first and can be omitted.

## Data flows on the desktop

- **Reveal-on-click.** Values decrypt into one component's local state,
  auto-hide after 15 s, and copy is only enabled while revealed.
- **Clipboard.** Copies go through the Rust `copy_secret` command, which
  schedules a clear after N seconds (default 20, configurable) and clears
  only if the clipboard still holds the exact value we put there (SHA-256
  compare — we never clobber a user's new copy).
- **Quick popup.** Metadata-only index (names, services, projects, hosts).
  `quick:copy` names a field; the main window decrypts it and invokes the
  same Rust clipboard command. The popup's capability set cannot call
  clipboard or filesystem commands, and it never receives a
  `decrypt`-capable message.
- **Lock paths.** Manual (button, Ctrl/Cmd+L), tray command, idle timer,
  hidden-in-tray timer, and OS-suspend heuristic (wall-clock jump > 30 s).
  All clear the derived key; idle/hidden also tear down live data.

## Threat model — covered

| Threat | Covered by |
|---|---|
| Compromised/hostile Firestore | AES-GCM client-side, verifier prove |
| Other local user accounts reading app files | No plaintext at rest; settings non-secret |
| GPU screenshot capture / recordings | Content protection (window-level; applied live) |
| Stolen clipboard after copy | Timed clear, only-if-unchanged semantics |
| Popup XSS stealing plaintext | Popup never has plaintext; separate capability set |
| Shoulder-surfing | Masked values, reveal timeout |

## Threat model — known gaps (accepted for alpha)

- **Client-side rate limiting only.** The 5-attempt exponential backoff is
  bypassable by restarting the app; online guesses are throttled by Firebase
  Auth quotas, not by this client. Server-side attempt limits are a
  cross-client task (web app + CLI share the posture).
- **Webview memory.** While unlocked, plaintext passes through the webview
  process (React state, DOM text). Any malware running as the same user can
  request process memory; this is inherent to any non-TEE local vault.
- **Crash/hibernate pages** may retain decrypted bytes in the OS pagefile;
  we do not call platform-specific eviction (Windows `VirtualLock` for the
  webview heap is not practical from JS), the swap-file risk is accepted and
  noted as a ROADMAP hardening item.
- **Google client secret** ships inside the packaged binary (loopback OAuth
  requires it); this is a "public-ish" secret by OAuth design and this
  client uses it only for the loopback native flow.
- **macOS** keyboard/clipboard content-protection APIs differ (no
  WDA_EXCLUDEFROMCAPTURE equivalent for arbitrary apps) — unverified.
- **No hardware-backed biometric unlock on desktop yet**; that flow stays
  web-only until a Tauri keychain approach is specified (ROADMAP).

## What to do if you suspect exposure

Lock the vault (it wipes the key instantly), sign out, rotate any secret you
copied while suspicious, and — since the desktop cannot delete server data —
audit recent activity in the web app.
