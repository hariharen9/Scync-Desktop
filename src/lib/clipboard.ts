/**
 * Central clipboard helper for the MAIN window. Plaintext goes straight to
 * the Rust `copy_secret` command (which auto-clears only-if-unchanged) and is
 * never stored in React state beyond the reveal timeout.
 */
import { bridge } from '@/auth/bridge.js';
import { useUiStore } from '@/stores/uiStore.js';

export async function copyToSystemClipboard(text: string, label = 'Copied'): Promise<void> {
  const secs = useUiStore.getState().settings.clipboardClearSecs ?? 20;
  try {
    await bridge.copySecret(text, secs);
    useUiStore.getState().showToast(label, secs > 0 ? `Clipboard clears in ${secs}s` : undefined);
  } catch (e) {
    // Plain browser dev (no Tauri): fall back to the web clipboard w/o auto-clear.
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      useUiStore.getState().showToast(label + ' (dev)', 'Dev fallback: no auto-clear');
    } else {
      useUiStore.getState().showToast('Copy failed', e instanceof Error ? e.message : String(e));
    }
  }
}

/** Mask a secret for display: show first/last few chars when revealed once. */
export function maskValue(value: string): string {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••••••${value.slice(-3)}`;
}
