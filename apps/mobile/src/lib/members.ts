import { memberRoleView, type MemberRoleView } from '@phare/core';
import type { Getter } from './timelineLoader';

// ---------------------------------------------------------------------------
// Household members, read-only (S7, first round, 2026-11-04). GET
// /api/household/members answers for owners and members alike; `pending` is
// computed for owners only. The role shown comes from memberRoleView in
// @phare/core, the same function the web Household page uses: an unreadable
// role is "unknown", never defaulted to "member".
// ---------------------------------------------------------------------------

export type Member = {
  id: string;
  /** null for a former member: the stored name is a placeholder, never shown. */
  name: string | null;
  email: string | null;
  /** Has an account, but its details couldn't be read. */
  detailsUnavailable: boolean;
  isMe: boolean;
  former: boolean;
  pending: boolean;
  /** null for a former member: no role badge (the web shows none either). */
  role: MemberRoleView | null;
};

export function parseMembers(raw: unknown, myUserId: string | null): Member[] {
  const d = raw as { members?: unknown } | null;
  if (!d || !Array.isArray(d.members)) throw new Error('members: no member list in the answer');
  return d.members.map((m, i) => {
    const o = m as Record<string, unknown>;
    if (typeof o.id !== 'string') throw new Error(`members: member ${i} has no id`);
    const userId = typeof o.user_id === 'string' ? o.user_id : null;
    const users = (o.users ?? null) as { email?: unknown; role?: unknown } | null;
    const former = o.former === true;
    const email = !former && users && typeof users.email === 'string' ? users.email : null;
    return {
      id: o.id,
      name: former ? null : String(o.name ?? ''),
      email,
      detailsUnavailable: !former && userId !== null && email === null,
      isMe: !former && userId !== null && userId === myUserId,
      former,
      pending: o.pending === true,
      role: former
        ? null
        : memberRoleView({ user_id: userId, users: users ? { role: typeof users.role === 'string' ? users.role : null } : null }),
    };
  });
}

export async function loadMembers(get: Getter, myUserId: string | null): Promise<Member[]> {
  return parseMembers(await get<unknown>('/api/household/members'), myUserId);
}

/** The badge's message key for a role. */
export function roleKey(role: MemberRoleView): string {
  switch (role) {
    case 'owner': return 'members.owner';
    case 'member': return 'members.member';
    case 'not_invited': return 'members.notInvited';
    case 'unknown': return 'members.roleUnknown';
  }
}
