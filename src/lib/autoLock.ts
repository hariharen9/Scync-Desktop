/**
 * autoLock — lock triggers (spec 3.3):
 *   - manual (ui / tray)
 *   - idle timeout (default 5 min; activity resets)
 *   - window hidden to tray for N minutes
 *   - system suspend heuristic: wall-clock jump > 30s implies sleep; lock on
 *     "resume" (the next tick that notices the jump)
 *   - app quit (process death — nothing to do, memory dies)
 *   - sign-out (clearSession)
 * The Firebase Auth session survives lock; only the key is dropped.
 */
import { useVaultStore } from '@/stores/vaultStore.js';
import { useUiStore } from '@/stores/uiStore.js';
import { bridge, emit } from '@/auth/bridge.js';

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
];

const SUSPEND_JUMP_MS = 30_000;

let activityTimer: ReturnType<typeof setInterval> | null = null;
let lastActivity = Date.now();
let hiddenSince: number | null = null;
let lastTickAt = Date.now();
let running = false;
let stopFns: Array<() => void> = [];

export function armAutoLock(): void {
  if (running) return;
  running = true;
  lastActivity = Date.now();
  lastTickAt = Date.now();

  const touch = () => {
    lastActivity = Date.now();
  };
  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, touch, { passive: true });
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
    } else {
      hiddenSince = null;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  activityTimer = setInterval(tick, 5000);
  stopFns.push(
    () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, touch);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    () => {
      if (activityTimer) clearInterval(activityTimer);
    }
  );
}

export function disarmAutoLock(): void {
  for (const stop of stopFns) stop();
  stopFns = [];
  running = false;
}

function tick(): void {
  const now = Date.now();

  // Suspend heuristic: a wall-clock jump much larger than the 1 s tick means
  // the process (or machine) was suspended. Lock on "resume".
  if (now - lastTickAt > SUSPEND_JUMP_MS) {
    lockNow('system sleep');
    lastActivity = now;
    lastTickAt = now;
    return;
  }
  lastTickAt = now;

  const { settings } = useUiStore.getState();
  const vault = useVaultStore.getState();
  if (vault.derivedKey === null) {
    return; // already locked
  }

  // Idle lock.
  const idleMinutes = settings.idleLockMinutes ?? 0;
  if (idleMinutes > 0 && now - lastActivity > idleMinutes * 60_000) {
    lockNow('idle timeout');
    return;
  }

  // Hidden-to-tray lock. (When the window is merely hidden, document
  // visibility may not fire; the tray-hide path resets hiddenSince.)
  const hiddenMinutes = settings.hiddenLockMinutes ?? 0;
  if (hiddenMinutes > 0 && document.visibilityState === 'hidden') {
    hiddenSince = hiddenSince ?? now;
    if (now - hiddenSince > hiddenMinutes * 60_000) {
      lockNow('window hidden');
    }
  } else {
    hiddenSince = null;
  }
}

/** Lock everything, inform the popup, and reset activity. */
export function lockNow(reason: string): void {
  // Keep the human-readable reason for the unlock screen (manual/tray locks
  // are intentional, so they carry no "why did it lock" explanation).
  const explain = reason === 'idle timeout' || reason === 'system sleep' || reason === 'window hidden';
  useVaultStore.getState().lock({ reason: explain ? reason : undefined, silent: !explain });
  lastActivity = Date.now();
  // Tell the quick-search window to clear results and show its locked state.
  void emit('vault:locked', { reason });
  // If the main window is hidden in the tray, tear down its WebView2 process
  // so it uses ~0 MB in the background until reopened.
  if (typeof document !== 'undefined' && document.hidden && reason !== 'sign-out') {
    void bridge.destroyMainIfHidden().catch(() => undefined);
  }
}
