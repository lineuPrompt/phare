import { describe, it, expect } from 'vitest';
import {
  isPendingMember,
  householdLocaleFrom,
  memberRoleView,
  canPromoteToOwner,
} from '../memberProvisioningHelpers';

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

// The bug these encode: the household page read roles from a `users(...)`
// embed fetched with the caller's own session client. RLS (`id = auth.uid()`)
// returned NULL for every member but the caller, and a `?? 'member'` default
// rendered that as a real role — two owners displayed as one owner and one
// member, and "Make owner" appeared for someone already an owner.
describe('memberRoleView', () => {
  it('reports the real role when it is readable', () => {
    expect(memberRoleView({ user_id: 'u1', users: { role: 'owner' } })).toBe('owner');
    expect(memberRoleView({ user_id: 'u1', users: { role: 'member' } })).toBe('member');
  });

  // THE REGRESSION. An unreadable users row must never render as 'member'.
  it('an unreadable or missing users row is unknown, NOT member', () => {
    expect(memberRoleView({ user_id: 'u1', users: null })).toBe('unknown');
    expect(memberRoleView({ user_id: 'u1' })).toBe('unknown');
    expect(memberRoleView({ user_id: 'u1', users: { role: null } })).toBe('unknown');
  });

  it('a role outside the CHECK constraint is unknown rather than guessed', () => {
    expect(memberRoleView({ user_id: 'u1', users: { role: 'admin' } })).toBe('unknown');
    expect(memberRoleView({ user_id: 'u1', users: { role: 'Owner' } })).toBe('unknown');
  });

  it('a name-only member has no role at all, which is not the same as unknown', () => {
    expect(memberRoleView({ user_id: null, users: null })).toBe('not_invited');
  });
});

describe('canPromoteToOwner', () => {
  it('offers promotion only for a known, active member', () => {
    expect(canPromoteToOwner({ user_id: 'u1', users: { role: 'member' }, pending: false })).toBe(true);
    expect(canPromoteToOwner({ user_id: 'u1', users: { role: 'member' } })).toBe(true);
  });

  // The button must not appear for an actual owner — the live symptom that
  // started this: clicking it returned 400 "already an owner".
  it('never offers promotion to someone who is already an owner', () => {
    expect(canPromoteToOwner({ user_id: 'u1', users: { role: 'owner' }, pending: false })).toBe(false);
  });

  it('never offers promotion when the role could not be read', () => {
    expect(canPromoteToOwner({ user_id: 'u1', users: null })).toBe(false);
  });

  it('never offers promotion to a pending member or a name-only row', () => {
    expect(canPromoteToOwner({ user_id: 'u1', users: { role: 'member' }, pending: true })).toBe(false);
    expect(canPromoteToOwner({ user_id: null, users: null })).toBe(false);
  });
});
