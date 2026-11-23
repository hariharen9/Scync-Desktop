/**
 * Sync the app version from a release tag into the manifests the build reads.
 *
 * Tauri names its artifacts from `src-tauri/tauri.conf.json`, and the UI shows
 * `__APP_VERSION__` which Vite injects from `package.json`. Both must match the
 * tag that triggered the release, otherwise `v0.2.0` ships files called 0.1.0.
 *
 * Cargo.toml is deliberately left alone: bumping the root package version
 * dirties Cargo.lock, which would break `cargo --locked`. The crate version is
 * not used for artifact naming or display.
 *
 * Usage: node scripts/sync-version.mjs v1.2.3   (or 1.2.3)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const raw = process.argv[2];
if (!raw) {
  console.error('[sync-version] usage: node scripts/sync-version.mjs v1.2.3');
  process.exit(1);
}

const version = raw.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`[sync-version] '${raw}' is not a semver tag (expected v1.2.3)`);
  process.exit(1);
}

for (const file of ['package.json', 'src-tauri/tauri.conf.json']) {
  const abs = path.join(root, file);
  const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
  json.version = version;
  fs.writeFileSync(abs, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`[sync-version] ${file} → ${version}`);
}
