import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS_FALLBACK, isPasswordRequiredNow } from '../src/lib/settings.js';

const DAY_MS = 86_400_000;

describe('Windows Hello periodic master-password policy', () => {
  it('defaults to 14 days and Hello disabled', () => {
    expect(DEFAULT_SETTINGS_FALLBACK.helloEnabled).toBe(false);
    expect(DEFAULT_SETTINGS_FALLBACK.requirePasswordEveryDays).toBe(14);
    expect(DEFAULT_SETTINGS_FALLBACK.lastPasswordUnlockAt).toBeNull();
  });

  it('requires password if never unlocked with password on this device', () => {
    expect(
      isPasswordRequiredNow({ requirePasswordEveryDays: 14, lastPasswordUnlockAt: null }, 1_000_000),
    ).toBe(true);
  });

  it('allows Hello within the configured 14-day window', () => {
    const now = 1_700_000_000_000;
    expect(
      isPasswordRequiredNow(
        { requirePasswordEveryDays: 14, lastPasswordUnlockAt: now - 13 * DAY_MS },
        now,
      ),
    ).toBe(false);
  });

  it('requires password once the 14-day window elapses', () => {
    const now = 1_700_000_000_000;
    expect(
      isPasswordRequiredNow(
        { requirePasswordEveryDays: 14, lastPasswordUnlockAt: now - 14 * DAY_MS },
        now,
      ),
    ).toBe(true);
  });

  it('never requires password periodically when set to null or 0 (after initial unlock)', () => {
    const now = 1_700_000_000_000;
    expect(
      isPasswordRequiredNow(
        { requirePasswordEveryDays: null, lastPasswordUnlockAt: now - 365 * DAY_MS },
        now,
      ),
    ).toBe(false);
    expect(
      isPasswordRequiredNow(
        { requirePasswordEveryDays: 0, lastPasswordUnlockAt: now - 365 * DAY_MS },
        now,
      ),
    ).toBe(false);
  });
});
