import { describe, it, expect } from 'vitest';
import { isPendingMember } from '../memberProvisioningHelpers';

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
