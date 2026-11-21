/**
 * Quick-search ranking and metadata-field tests. Only metadata items pass
 * through this code — a structural guarantee the popup never sees plaintext.
 */
import { describe, it, expect } from 'vitest';
import { searchItems, fieldsFor, scoreItem } from '@/lib/search.js';
import type { QuickSearchItem } from '@/stores/dataStore.js';

const item = (over: Partial<QuickSearchItem>): QuickSearchItem => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  kind: 'secret',
  name: '',
  service: '',
  environment: '',
  project: '',
  status: '',
  ...over,
});

const INDEX: QuickSearchItem[] = [
  item({ id: '1', kind: 'secret', name: 'Stripe prod key', service: 'Stripe', environment: 'Production', project: 'Payments' }),
  item({ id: '2', kind: 'secret', name: 'Stripe test key', service: 'Stripe', environment: 'Testing', project: 'Payments' }),
  item({ id: '3', kind: 'password', name: 'GitHub login', service: 'GitHub', environment: '' }),
  item({ id: '4', kind: 'totp', name: 'GitHub 2FA', service: 'GitHub', environment: '' }),
  item({ id: '5', kind: 'ssh', name: 'hetzner prod', service: 'ssh-rsa', environment: 'root@137.xxx' }),
  item({ id: '6', kind: 'cert', name: 'api wildcard', service: "Let's Encrypt", environment: 'api.example.com' }),
];

describe('searchItems', () => {
  it('exact substring matches rank best', () => {
    const r = searchItems(INDEX, 'stripe');
    expect(r.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('prefix beats mid-string match at equal length', () => {
    const a = item({ id: 'a', name: 'gitlab token' });
    const b = item({ id: 'b', name: 'my gitlab token' });
    const r = searchItems([b, a], 'gitl');
    expect(r[0]?.id).toBe('a');
  });

  it('fuzzy subsequence still finds matches', () => {
    const r = searchItems(INDEX, 'ghb');
    expect(r.map((i) => i.id)).toContain('3');
  });

  it('no results for unrelated queries', () => {
    expect(searchItems(INDEX, 'zzzzzz')).toEqual([]);
  });

  it('matches across service, project and environment fields', () => {
    expect(searchItems(INDEX, 'payments').map((i) => i.id)).toEqual(['1', '2']);
    expect(searchItems(INDEX, 'production').map((i) => i.id)).toEqual(['1']);
    expect(searchItems(INDEX, 'ssh-rsa').map((i) => i.id)).toEqual(['5']);
  });

  it('caps results at the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ id: `m${i}`, name: `candidate ${i}` }));
    expect(searchItems(many, 'candidate', 12)).toHaveLength(12);
  });
});

describe('fieldsFor — copyable fields per kind', () => {
  it('gives every kind at least one field with a label', () => {
    for (const kind of ['secret', 'password', 'ssh', 'totp', 'cert'] as const) {
      const fields = fieldsFor(kind);
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) {
        expect(f.label.length).toBeGreaterThan(0);
        expect(typeof f.field).toBe('string');
      }
    }
  });

  it('ssh offers both keys; password offers username as second field', () => {
    expect(fieldsFor('ssh')).toEqual([
      { field: 'privateKey', label: 'Private key' },
      { field: 'publicKey', label: 'Public key' },
    ]);
    expect(fieldsFor('password')).toEqual([
      { field: 'password', label: 'Password' },
      { field: 'username', label: 'Username' },
    ]);
  });
});

describe('scoreItem sanity', () => {
  it('returns Infinity for non-matches and finite scores for matches', () => {
    const hit = item({ name: 'Stripe prod key', service: 'Stripe' });
    expect(scoreItem(hit, 'stripe')).toBeLessThan(Infinity);
    expect(scoreItem(hit, 'qqqq')).toBe(Infinity);
  });
});
