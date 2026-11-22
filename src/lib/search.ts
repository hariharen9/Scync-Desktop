/**
 * Fuzzy search over plaintext METADATA ONLY (name / service / project /
 * environment / username / issuer / hosts). Never given secret values —
 * callers pass QuickSearchItem objects built by dataStore.metaIndex().
 */
import type { QuickSearchItem } from '@/stores/dataStore.js';

/** Subsequence fuzzy-match: characters of `query` appear in order in `text`. */
function isSubsequence(text: string, query: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const c = query[qi];
    let found = -1;
    while (ti < text.length) {
      if (text[ti] === c) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found === -1) return false;
  }
  return true;
}

/** Lower = better. Substring bonus, prefix bonus, word-boundary bonus. */
export function scoreItem(item: QuickSearchItem, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 500; // empty query: everything matches in listed order

  const haystacks = [
    item.name.toLowerCase(),
    item.service.toLowerCase(),
    item.project.toLowerCase(),
    item.environment.toLowerCase(),
  ];

  let best = Infinity;
  for (let i = 0; i < haystacks.length; i++) {
    const hay = haystacks[i];
    let score: number | null = null;
    const idx = hay.indexOf(query);
    if (idx === 0) score = 0 + i;
    else if (idx > 0) {
      // word-boundary (after space/dash/slash) ranks better than mid-word
      const isBoundary = /[\s\-_/]/.test(hay[idx - 1] ?? '');
      score = (isBoundary ? 10 : 30) + i;
    } else if (isSubsequence(hay, query)) {
      score = 200 + i * 10;
    }
    if (score !== null && score < best) best = score;
  }

  return best === Infinity ? Infinity : best;
}

/** Rank and return matching items (no plaintext involved). */
export function searchItems(items: QuickSearchItem[], query: string, limit = 12): QuickSearchItem[] {
  return items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((r) => r.score !== Infinity)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((r) => r.item);
}

/** Which fields can be copied for an item (metadata labels only). */
export function fieldsFor(kind: QuickSearchItem['kind']): Array<{ field: string; label: string }> {
  switch (kind) {
    case 'secret':
      return [{ field: 'value', label: 'Value' }];
    case 'password':
      return [
        { field: 'password', label: 'Password' },
        { field: 'username', label: 'Username' },
      ];
    case 'ssh':
      return [
        { field: 'privateKey', label: 'Private key' },
        { field: 'publicKey', label: 'Public key' },
      ];
    case 'totp':
      return [{ field: 'code', label: 'Copy code' }];
    case 'cert':
      return [
        { field: 'certPem', label: 'Certificate PEM' },
        { field: 'keyPem', label: 'Private key PEM' },
      ];
  }
}

/** Label for the secondary (Ctrl/Cmd+↵) copy action, or null when none. */
export function secondaryLabel(kind: QuickSearchItem['kind']): string | null {
  const fields = fieldsFor(kind);
  return fields.length > 1 ? fields[1].label : null;
}
