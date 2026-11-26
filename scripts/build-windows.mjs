/**
 * Local Windows release build script.
 *
 * Builds both the standalone `scync-desktop.exe` and the NSIS installer
 * (`Scync_<version>_<arch>-setup.exe`), then copies them into `release/`.
 *
 * Usage:
 *   npm run build:win
 *   node scripts/build-windows.mjs --skip-tests
 *   node scripts/build-windows.mjs --with-msi
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const skipTests = args.has('--skip-tests');
const withMsi = args.has('--with-msi');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

if (process.platform !== 'win32') {
  console.error('build-windows.mjs must be run on Windows.');
  process.exit(1);
}

// Load .env and .env.local so SCYNC_GOOGLE_CLIENT_ID/SECRET are picked up if set.
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));

run('node scripts/generate-google-client.mjs');
run('npm run typecheck');
if (!skipTests) {
  run('npm test');
}

const bundles = withMsi ? 'nsis,msi' : 'nsis';
run(`npx tauri build --bundles ${bundles}`);

// Collect artifacts into release/
const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });

const targetRelease = path.join(root, 'src-tauri', 'target', 'release');
const standaloneExe = path.join(targetRelease, 'scync-desktop.exe');
const collected = [];

if (fs.existsSync(standaloneExe)) {
  const dest = path.join(releaseDir, 'Scync.exe');
  fs.copyFileSync(standaloneExe, dest);
  collected.push(dest);
}

const nsisDir = path.join(targetRelease, 'bundle', 'nsis');
if (fs.existsSync(nsisDir)) {
  for (const file of fs.readdirSync(nsisDir)) {
    if (file.endsWith('.exe')) {
      const dest = path.join(releaseDir, file);
      fs.copyFileSync(path.join(nsisDir, file), dest);
      collected.push(dest);
    }
  }
}

if (withMsi) {
  const msiDir = path.join(targetRelease, 'bundle', 'msi');
  if (fs.existsSync(msiDir)) {
    for (const file of fs.readdirSync(msiDir)) {
      if (file.endsWith('.msi')) {
        const dest = path.join(releaseDir, file);
        fs.copyFileSync(path.join(msiDir, file), dest);
        collected.push(dest);
      }
    }
  }
}

console.log('\nBuild complete! Output artifacts:');
for (const file of collected) {
  const mb = (fs.statSync(file).size / (1024 * 1024)).toFixed(2);
  console.log(`  - ${path.relative(root, file)} (${mb} MB)`);
}
