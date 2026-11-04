import { describe, it, expect, vi } from 'vitest';
import { loadMembers, parseMembers, roleKey } from '../lib/members';

// The route's real shape (GET /api/household/members, owner caller).
const answer = {
  members: [
    { id: 'm1', name: 'Ana', user_id: 'u1', deleted_at: null, users: { email: 'ana@example.com', role: 'owner' }, former: false, pending: false },
    { id: 'm2', name: 'Bruno', user_id: 'u2', deleted_at: null, users: { email: 'bruno@example.com', role: 'member' }, former: false, pending: true },
    { id: 'm3', name: 'Kid', user_id: null, deleted_at: null, users: null, former: false, pending: false },
    { id: 'm4', name: 'deleted-member', user_id: null, deleted_at: '2026-10-01T00:00:00Z', users: null, former: true, pending: false },
    { id: 'm5', name: 'Carla', user_id: 'u5', deleted_at: null, users: null, former: false, pending: false },
  ],
};

describe('parseMembers', () => {
  const [ana, bruno, kid, former, carla] = parseMembers(answer, 'u1');

  it('reads each role through memberRoleView, never defaulting to member', () => {
    expect(ana.role).toBe('owner');
    expect(bruno.role).toBe('member');
    expect(kid.role).toBe('not_invited');
    // Has an account, but no readable row: unknown, not "member".
    expect(carla.role).toBe('unknown');
    expect(carla.detailsUnavailable).toBe(true);
    expect(ana.detailsUnavailable).toBe(false);
    expect(kid.detailsUnavailable).toBe(false);
  });

  it('marks the signed-in person and pending invitations', () => {
    expect(ana.isMe).toBe(true);
    expect(bruno.isMe).toBe(false);
    expect(bruno.pending).toBe(true);
    expect(ana.pending).toBe(false);
  });

  it('never shows a former member\'s stored name, email or role', () => {
    expect(former.former).toBe(true);
    expect(former.name).toBeNull();
    expect(former.email).toBeNull();
    expect(former.role).toBeNull();
    expect(former.detailsUnavailable).toBe(false);
  });

  it('a former row that still carries an account shows nothing of it', () => {
    const [m] = parseMembers(
      { members: [{ id: 'm9', name: 'x', user_id: 'u1', users: { email: 'old@example.com', role: 'owner' }, former: true }] },
      'u1'
    );
    expect(m.email).toBeNull();
    expect(m.isMe).toBe(false);
    expect(m.detailsUnavailable).toBe(false);
    expect(m.role).toBeNull();
  });

  it('with no signed-in id, a name-only member is not "you"', () => {
    const [m] = parseMembers({ members: [{ id: 'm3', name: 'Kid', user_id: null, users: null, former: false }] }, null);
    expect(m.isMe).toBe(false);
  });

  it('keeps the email for a current member', () => {
    expect(ana.email).toBe('ana@example.com');
    expect(ana.name).toBe('Ana');
  });

  it('a member caller (no pending field) is never pending', () => {
    const [m] = parseMembers({ members: [{ id: 'm1', name: 'A', user_id: 'u1', users: { email: 'a@x.ca', role: 'owner' }, former: false }] }, 'u9');
    expect(m.pending).toBe(false);
    expect(m.isMe).toBe(false);
  });

  it('refuses an answer without a member list, or a member without an id', () => {
    expect(() => parseMembers({}, 'u1')).toThrow(/no member list/);
    expect(() => parseMembers(null, 'u1')).toThrow(/no member list/);
    expect(() => parseMembers({ members: [{ name: 'x' }] }, 'u1')).toThrow(/no id/);
  });
});

describe('loadMembers', () => {
  it('reads the household members route', async () => {
    const get = vi.fn().mockResolvedValue({ members: [] });
    await expect(loadMembers(get, 'u1')).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith('/api/household/members');
  });
});

describe('roleKey', () => {
  it('names a distinct message for each role', () => {
    const keys = (['owner', 'member', 'not_invited', 'unknown'] as const).map(roleKey);
    expect(keys).toEqual(['members.owner', 'members.member', 'members.notInvited', 'members.roleUnknown']);
  });
});
