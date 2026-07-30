import { describe, it, expect } from 'vitest';
import { isPendingMember, householdLocaleFrom } from '../memberProvisioningHelpers';

describe('isPendingMember', () => {
  it('a name-only member (no user_id) is never pending — no account exists to resend to', () => {
    expect(isPendingMember(null, null)).toBe(false);
  });

  it('a provisioned member who has never signed in is pending', () => {
    expect(isPendingMember('user-1', null)).toBe(true);
  });

  it('a provisioned member with a recorded sign-in is not pending', () => {
    expect(isPendingMember('user-1', '2026-07-10T12:00:00Z')).toBe(false);
  });

  it('treats undefined last_sign_in_at the same as null (defensive — some callers may omit the field)', () => {
    expect(isPendingMember('user-1', undefined as unknown as null)).toBe(true);
  });
});

describe('householdLocaleFrom', () => {
  it('reads fr and en from an embedded object', () => {
    expect(householdLocaleFrom({ locale: 'fr' })).toBe('fr');
    expect(householdLocaleFrom({ locale: 'en' })).toBe('en');
  });

  it('accepts the embed as a single-element array (PostgREST can return either shape)', () => {
    expect(householdLocaleFrom([{ locale: 'fr' }])).toBe('fr');
    expect(householdLocaleFrom([{ locale: 'en' }])).toBe('en');
  });

  it('falls back to en rather than throwing when the embed is absent or empty', () => {
    for (const absent of [undefined, null, {}, [], '', 0]) {
      expect(householdLocaleFrom(absent)).toBe('en');
    }
  });

  it('falls back to en for a locale outside the CHECK constraint', () => {
    // households.locale is CHECK-constrained to ('en','fr'), so this should be
    // unreachable — pinned anyway because the cost of guessing wrong is an
    // invite email that fails to send.
    expect(householdLocaleFrom({ locale: 'es' })).toBe('en');
    expect(householdLocaleFrom({ locale: 'FR' })).toBe('en');
  });
});
