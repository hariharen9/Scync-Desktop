/**
 * UI-side error copy. Backend/Firestore errors are technical by design (the
 * contract must stay byte-identical), so the presentation layer translates
 * them into short, actionable messages. Never hides a failure: the original
 * message is kept as the toast detail.
 */
interface Friendly {
  title: string;
  detail?: string;
}

export function friendlyError(e: unknown): Friendly {
  const raw = e instanceof Error ? e.message : String(e);
  const code = raw.toLowerCase();

  if (code.includes('permission-denied') || code.includes('missing or insufficient permissions')) {
    return { title: 'Permission denied', detail: 'This account cannot write that record. Check the Firestore rules or sign in again.' };
  }
  if (code.includes('unavailable') || code.includes('network') || code.includes('offline') || code.includes('failed to fetch')) {
    return { title: 'You are offline', detail: 'The change was not saved. Reconnect and try again.' };
  }
  if (raw.includes('ConflictError') || code.includes('conflict detected')) {
    return { title: 'Edited elsewhere', detail: 'Another session changed this item. Reload it and try again.' };
  }
  if (code.includes('unauthenticated') || code.includes('auth/')) {
    return { title: 'Session expired', detail: 'Sign in again to continue.' };
  }
  if (code.includes('vault is locked')) {
    return { title: 'Vault is locked', detail: 'Unlock to continue.' };
  }
  if (code.includes('resource-exhausted') || code.includes('quota')) {
    return { title: 'Rate limited', detail: 'Too many requests — wait a moment and retry.' };
  }
  return { title: 'Something went wrong', detail: raw };
}
