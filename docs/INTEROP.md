# Cross-Client Interoperability

Scync ships three clients (web `../scync`, CLI `../scync-cli`, desktop) that must be
byte-compatible on everything they persist to Firebase or exchange over IPC. This file
is the cross-client checklist. When a contract changes, it changes in **all** clients
in the same release.

The source of truth is the code itself; the vendored backend modules in
`src/backend/` are byte-identical copies of the CLI's (see `PROVENANCE.md`).

## 1. Crypto contract

| Item | Value | Reference |
| --- | --- | --- |
| Key derivation | PBKDF2-SHA256, **310,000 iterations**, WebCrypto | `src/backend/crypto.ts:42-51` |
| KDF input | `password + uid` | `src/backend/crypto.ts` |
| Cipher | AES-256-GCM | `src/backend/crypto.ts` |
| IV | random 12 bytes, base64-encoded | `src/backend/crypto.ts` |
| Verifier string | `Scync_VALID_v1` | `src/backend/crypto.ts:89,96` |

Checks for review:

- Any change to iteration count, verifier string, IV length, or encoding breaks
  unlock in every other client. Treat as a breaking, versioned migration (and note
  that `meta/vault` migrations are out of scope for desktop, see section 3).
- The desktop `totp.ts` adds an optional `at` parameter used only for tests —
  production behavior (live clock) must stay identical to the CLI's.

## 2. Firestore schema

One user's data lives under `users/{uid}`:

- `meta/vault` — `{ salt, verifier, biometrics?, recovery?, createdAt, updatedAt }`
- `secrets/{id}` — one encrypted field (e.g. `encSecret`), plus metadata
  (`service`, `environment`, `status`, labels, expiresAt, tags, totp fields,
  etc. — see `src/backend/types.ts`)
- `shares/...` and `share-keys/...` — sharing envelope, recipient public keys
  (`src/backend/shares.ts`, `src/backend/share-keys.ts`)

Read pattern: desktop reads the **whole collection** (`onSnapshot`) and filters
client-side (`src/stores/dataStore.ts`, `src/lib/search.ts`). Never assume server-side
filtering semantics carry over.

Server rules are the CLI/web's (Firestore + Cloud Run); the desktop introduces no new
files, only new readers of the same documents.

## 3. Write restrictions (desktop-specific)

The desktop **must never write** `users/{uid}/meta/vault`. Vault bootstrap happens in
the web/CLI; the desktop shows the NoVault screen instead when meta is absent.

- `setupVault`, `updateVaultBiometrics`, `updateVaultRecovery`, and the
  master-password change path exist in the vendored `src/backend/firestore.ts`
  for byte-fidelity with the CLI but have **no call sites** in the desktop UI.
- If you ever need meta writes here, treat it as a spec change, not a bug fix.

Everything else (secrets CRUD, share keys, project assignment) the desktop writes
through the same functions the CLI uses.

## 4. Desktop-local storage

- Google OAuth tokens: OS keychain via `src-tauri` (see `SECURITY.md`).
- App settings (hotkey, autostart, timers, content protection): settings file,
  `src-tauri/src/settings.rs` + `src/lib/settings.ts`. Not shared with other clients.
- The desktop never stores decrypted secrets outside process memory.

## 5. IPC contract (backend <-> renderer) and Quick Popup

Rust -> webview:

- `vault:locked`, `quick:shown` — notifications
- `quick:results` — `{ items, locked, ready }` answers to a query

Webview -> Rust / webview -> webview:

- `quick:query` — debounced popup search text
- `quick:copy` — `{ id, kind, field }`; resolved via `resolveQuickCopyValue`
  (`src/ui/App.tsx`), delivered through `bridge.copySecret`, answered with
  `quick:copy-result` `{ ok, message, clearSecs }`

Field mapping used by the popup (secondary field shown next to the primary):

- password: secondary = username
- secret (api key): primary = secret value
- ssh key: secondary = publicKey
- certificate: secondary = keyPem (`''` when absent)

Keep this table and `src/quick/QuickApp.tsx` in sync when adding fields.

## 6. Pre-release checklist

1. `npx tsc --noEmit` — clean
2. `npx vitest run` — all green
3. `cd src-tauri && cargo build && cargo test` — clean, zero warnings
4. `npm run build` — no unresolved asset warnings
5. Spend one unlock round-trip against a real project with the **web** client
   open beside it: create/edit/delete from desktop, confirm web sees it and vice versa
6. Confirm the desktop did not write `meta/vault` (Firestore console / rules logs)
7. Re-run `npm audit` / `cargo audit`; document accepted findings in `DECISIONS.md`
