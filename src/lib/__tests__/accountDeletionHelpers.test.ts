import { describe, it, expect } from 'vitest';
import { decideDeletion, confirmationMatches, liveAccessHolders } from '@/lib/accountDeletionHelpers';

// The rule every case below is checking: A HOUSEHOLD IS NEVER DESTROYED WHILE
// SOMEONE ELSE CAN STILL SIGN IN TO IT.

const owner = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  user_id: `u-${id}`,
  pending: false,
  users: { role: 'owner' },
  ...over,
});

const member = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  user_id: `u-${id}`,
  pending: false,
  users: { role: 'member' },
  ...over,
});

describe('decideDeletion', () => {
  it('sole member: their account IS the household', () => {
    expect(decideDeletion([owner('me')], 'me')).toEqual({
      mode: 'household_delete',
      reason: 'sole_member',
    });
  });

  it('name-only rows do not keep a household alive', () => {
    // Onboarding discovery creates rows for children and spouses with no
    // login. They are people, but nobody can sign in as them, so the caller is
    // still the sole account holder.
    const nameOnly = { id: 'kid', user_id: null, pending: false, users: null };
    expect(decideDeletion([owner('me'), nameOnly], 'me')).toEqual({
      mode: 'household_delete',
      reason: 'sole_member',
    });
  });

  it('a tombstoned former member does not keep a household alive either', () => {
    // Already erased in a previous Case B. Counting them would make the last
    // real member permanently unable to delete anything.
    const departed = { id: 'gone', user_id: null, pending: false, users: null, deleted_at: '2026-08-01T00:00:00Z' };
    expect(decideDeletion([owner('me'), departed], 'me')).toEqual({
      mode: 'household_delete',
      reason: 'sole_member',
    });
  });

  it('another active owner exists: ordinary Case B departure', () => {
    expect(decideDeletion([owner('me'), owner('spouse')], 'me')).toEqual({ mode: 'self_delete' });
  });

  it('last owner with an active member: blocked, and names who to promote', () => {
    const verdict = decideDeletion([owner('me'), member('spouse')], 'me');
    expect(verdict.mode).toBe('blocked_promote');
    if (verdict.mode !== 'blocked_promote') throw new Error('unreachable');
    expect(verdict.candidates.map((c) => c.id)).toEqual(['spouse']);
  });

  it('escape hatch: others exist but none has ever signed in', () => {
    // An invite that was never accepted cannot be handed a household, so
    // promotion is not a real option and the family would otherwise be stuck.
    expect(decideDeletion([owner('me'), member('invited', { pending: true })], 'me')).toEqual({
      mode: 'household_delete',
      reason: 'all_pending',
    });
  });

  it('a PENDING owner does not count as a custodian', () => {
    // They hold the role but have never signed in and cannot use it — the
    // same reasoning canPromoteToOwner already applies to promotion.
    expect(decideDeletion([owner('me'), owner('invited', { pending: true })], 'me')).toEqual({
      mode: 'household_delete',
      reason: 'all_pending',
    });
  });

  it('an active member with an unreadable role blocks WITHOUT offering deletion', () => {
    // The dangerous near-miss: someone is active, so the escape hatch must not
    // fire, but their role did not come back so there is nobody to promote
    // either. Offering to destroy the household here would erase an active
    // person's data on the strength of a failed lookup.
    const unreadable = { id: 'ghost', user_id: 'u-ghost', pending: false, users: null };
    expect(decideDeletion([owner('me'), unreadable], 'me')).toEqual({ mode: 'blocked_no_path' });
  });

  it('mixed: one pending invite and one active member still blocks on the active one', () => {
    const verdict = decideDeletion(
      [owner('me'), member('invited', { pending: true }), member('spouse')],
      'me'
    );
    expect(verdict.mode).toBe('blocked_promote');
    if (verdict.mode !== 'blocked_promote') throw new Error('unreachable');
    // Only the person who can actually take over is offered.
    expect(verdict.candidates.map((c) => c.id)).toEqual(['spouse']);
  });

  it('a plain member leaving a household with an active owner is Case B', () => {
    expect(decideDeletion([owner('boss'), member('me')], 'me')).toEqual({ mode: 'self_delete' });
  });
});

describe('liveAccessHolders', () => {
  it('counts only rows with an account and no tombstone', () => {
    const rows = [
      owner('a'),
      { id: 'b', user_id: null, pending: false, users: null },
      { id: 'c', user_id: 'u-c', pending: false, users: null, deleted_at: '2026-08-01T00:00:00Z' },
    ];
    expect(liveAccessHolders(rows).map((r) => r.id)).toEqual(['a']);
  });
});

describe('confirmationMatches', () => {
  it('accepts the exact phrase', () => {
    expect(confirmationMatches('The Graeff Household', 'The Graeff Household')).toBe(true);
  });

  it('tolerates case and surrounding whitespace', () => {
    // A gate against acting without reading, not a spelling test.
    expect(confirmationMatches('The Graeff Household', '  the graeff household ')).toBe(true);
    expect(confirmationMatches('me@example.com', 'ME@Example.com')).toBe(true);
  });

  it('rejects anything else — including the generic word this replaced', () => {
    expect(confirmationMatches('The Graeff Household', 'DELETE')).toBe(false);
    expect(confirmationMatches('The Graeff Household', 'The Graeff')).toBe(false);
    expect(confirmationMatches('me@example.com', 'you@example.com')).toBe(false);
  });

  it('never passes on an empty or missing expectation', () => {
    // Otherwise a household whose name failed to load would accept '' and the
    // gate would silently disappear.
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches(null, '')).toBe(false);
    expect(confirmationMatches(undefined, 'anything')).toBe(false);
    expect(confirmationMatches('Household', 123)).toBe(false);
  });
});
