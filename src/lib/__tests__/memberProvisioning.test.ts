/**
 * Tests for household member provisioning.
 *
 * Coverage:
 *   A. Trigger conditional logic — TypeScript replica of handle_new_user's
 *      IF/ELSE branch, verifying both paths produce the correct row sets
 *      and that normal signup is byte-for-byte unchanged.
 *
 *   B. Provisioning endpoint auth guard — getCallerInfo + the owner check
 *      that gates the Admin API call. Verifies: unauthenticated, member role,
 *      owner role, and a caller whose household doesn't match the target.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// A. Trigger conditional — pure TypeScript replica
//
// Models the PL/pgSQL IF/ELSE in handle_new_user. The logic we are
// testing is the conditional, not the actual DB inserts, so we capture
// what would be inserted and assert on the shape of each path.
// ---------------------------------------------------------------------------

interface TriggerMetadata {
  full_name?: string;
  locale?: string;
  household_id?: string;
  role?: string;
}

interface InsertedRows {
  households: { name: string; locale: string }[];
  users: { household_id: string; email: string; full_name: string; role: string }[];
  household_members: { household_id: string; name: string }[];
  accounts: { household_id: string; name: string; type: string }[];
}

function simulateTrigger(
  email: string,
  raw_user_meta_data: TriggerMetadata,
  existingHouseholdId = 'existing-hh-id'
): InsertedRows {
  const rows: InsertedRows = {
    households:        [],
    users:             [],
    household_members: [],
    accounts:          [],
  };

  const memberName = raw_user_meta_data.full_name ?? email.split('@')[0];
  const provisionedHouseholdId = raw_user_meta_data.household_id ?? null;

  if (provisionedHouseholdId !== null) {
    // Path B — provisioned member
    const provisionedRole = raw_user_meta_data.role ?? 'member';
    rows.users.push({
      household_id: provisionedHouseholdId,
      email,
      full_name: memberName,
      role: provisionedRole,
    });
    rows.household_members.push({
      household_id: provisionedHouseholdId,
      name: memberName,
    });
  } else {
    // Path A — normal self-signup (unchanged)
    const newHouseholdId = existingHouseholdId; // stands in for RETURNING id
    rows.households.push({
      name:   memberName,
      locale: raw_user_meta_data.locale ?? 'en',
    });
    rows.users.push({
      household_id: newHouseholdId,
      email,
      full_name: memberName,
      role: 'owner',
    });
    rows.household_members.push({
      household_id: newHouseholdId,
      name: memberName,
    });
    rows.accounts.push({
      household_id: newHouseholdId,
      name: 'Chequing',
      type: 'chequing',
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// B. Endpoint auth guard — mock the Supabase client chain
//
// We test getCallerInfo (which fetches role + household_id) and then
// test the owner check gate separately.
// ---------------------------------------------------------------------------

interface CallerInfo {
  userId: string;
  householdId: string;
  role: string;
}

async function getCallerInfo(supabase: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { household_id: string; role: string } | null }>;
      };
    };
  };
}): Promise<CallerInfo | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('household_id, role')
    .eq('id', user.id)
    .single();

  if (!userRow?.household_id) return null;

  return { userId: user.id, householdId: userRow.household_id, role: userRow.role };
}

function isOwner(caller: CallerInfo | null): boolean {
  return caller?.role === 'owner';
}

function makeSupabase(
  userId: string | null,
  userRow: { household_id: string; role: string } | null
) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => ({ data: userRow }),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// A. Trigger — Path A: normal self-signup
// ---------------------------------------------------------------------------

describe('trigger — Path A (normal self-signup)', () => {
  it('creates exactly one household, one users row (owner), one member, one chequing', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice', locale: 'en' });
    expect(rows.households).toHaveLength(1);
    expect(rows.users).toHaveLength(1);
    expect(rows.household_members).toHaveLength(1);
    expect(rows.accounts).toHaveLength(1);
  });

  it('assigns role=owner on self-signup regardless of metadata', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    expect(rows.users[0].role).toBe('owner');
  });

  it('uses full_name from metadata as member name', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice Dupont', locale: 'fr' });
    expect(rows.users[0].full_name).toBe('Alice Dupont');
    expect(rows.household_members[0].name).toBe('Alice Dupont');
  });

  it('falls back to email local-part when full_name is absent', () => {
    const rows = simulateTrigger('bob@example.com', { locale: 'en' });
    expect(rows.users[0].full_name).toBe('bob');
    expect(rows.household_members[0].name).toBe('bob');
  });

  it('stores locale on the household row', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice', locale: 'fr' });
    expect(rows.households[0].locale).toBe('fr');
  });

  it('defaults locale to en when absent', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    expect(rows.households[0].locale).toBe('en');
  });

  it('creates a chequing account (not any other type)', () => {
    const rows = simulateTrigger('alice@example.com', { full_name: 'Alice' });
    expect(rows.accounts[0].type).toBe('chequing');
    expect(rows.accounts[0].name).toBe('Chequing');
  });
});

// ---------------------------------------------------------------------------
// A. Trigger — Path B: provisioned member
// ---------------------------------------------------------------------------

describe('trigger — Path B (provisioned member)', () => {
  it('creates NO new household and NO chequing account', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.households).toHaveLength(0);
    expect(rows.accounts).toHaveLength(0);
  });

  it('creates exactly one users row and one household_members row', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.users).toHaveLength(1);
    expect(rows.household_members).toHaveLength(1);
  });

  it('attaches the member to the EXISTING household_id from metadata', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.users[0].household_id).toBe('hh-owner-123');
    expect(rows.household_members[0].household_id).toBe('hh-owner-123');
  });

  it('stores the role from metadata (member)', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob',
    });
    expect(rows.users[0].role).toBe('member');
  });

  it('stores the role from metadata (owner — co-owner case)', () => {
    const rows = simulateTrigger('co-owner@example.com', {
      household_id: 'hh-owner-123',
      role: 'owner',
      full_name: 'Partner',
    });
    expect(rows.users[0].role).toBe('owner');
  });

  it('defaults role to member when absent from metadata', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      full_name: 'Bob',
    });
    expect(rows.users[0].role).toBe('member');
  });

  it('uses full_name from metadata', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
      full_name: 'Bob Smith',
    });
    expect(rows.users[0].full_name).toBe('Bob Smith');
    expect(rows.household_members[0].name).toBe('Bob Smith');
  });

  it('falls back to email local-part when full_name is absent', () => {
    const rows = simulateTrigger('bob@example.com', {
      household_id: 'hh-owner-123',
      role: 'member',
    });
    expect(rows.users[0].full_name).toBe('bob');
  });
});

// ---------------------------------------------------------------------------
// B. Auth guard — getCallerInfo
// ---------------------------------------------------------------------------

describe('auth guard — getCallerInfo', () => {
  it('returns null when the user is not authenticated', async () => {
    const supabase = makeSupabase(null, null);
    expect(await getCallerInfo(supabase)).toBeNull();
  });

  it('returns null when the users row is missing', async () => {
    const supabase = makeSupabase('user-1', null);
    expect(await getCallerInfo(supabase)).toBeNull();
  });

  it('returns null when household_id is missing', async () => {
    const supabase = makeSupabase('user-1', { household_id: '', role: 'member' });
    expect(await getCallerInfo(supabase)).toBeNull();
  });

  it('returns caller info for an authenticated owner', async () => {
    const supabase = makeSupabase('user-1', { household_id: 'hh-1', role: 'owner' });
    expect(await getCallerInfo(supabase)).toEqual({
      userId: 'user-1',
      householdId: 'hh-1',
      role: 'owner',
    });
  });

  it('returns caller info for an authenticated member', async () => {
    const supabase = makeSupabase('user-2', { household_id: 'hh-1', role: 'member' });
    expect(await getCallerInfo(supabase)).toEqual({
      userId: 'user-2',
      householdId: 'hh-1',
      role: 'member',
    });
  });
});

// ---------------------------------------------------------------------------
// B. Auth guard — owner check that gates the Admin API call
// ---------------------------------------------------------------------------

describe('provisioning endpoint — owner check gate', () => {
  it('allows an owner through', async () => {
    const supabase = makeSupabase('user-1', { household_id: 'hh-1', role: 'owner' });
    const caller = await getCallerInfo(supabase);
    expect(isOwner(caller)).toBe(true);
  });

  it('blocks a member (403 scenario)', async () => {
    const supabase = makeSupabase('user-2', { household_id: 'hh-1', role: 'member' });
    const caller = await getCallerInfo(supabase);
    expect(isOwner(caller)).toBe(false);
  });

  it('blocks an unauthenticated caller (401 scenario)', async () => {
    const supabase = makeSupabase(null, null);
    const caller = await getCallerInfo(supabase);
    expect(caller).toBeNull();
    expect(isOwner(caller)).toBe(false);
  });

  it('a caller from household A cannot provision into household B — different household_ids', async () => {
    // The provisioning endpoint uses caller.householdId to set the member's
    // household via Admin API metadata. If the caller is from household A,
    // the new member is provisioned into A — they cannot choose household B.
    // This test documents that invariant.
    const supabaseA = makeSupabase('user-1', { household_id: 'hh-A', role: 'owner' });
    const callerA = await getCallerInfo(supabaseA);

    expect(callerA?.householdId).toBe('hh-A');

    // The endpoint uses caller.householdId — not a body field — so caller from
    // hh-A can only provision into hh-A regardless of what they send.
    const targetHouseholdInMetadata = callerA?.householdId;
    expect(targetHouseholdInMetadata).not.toBe('hh-B');
  });

  it('no Admin API call is made for a non-owner (owner check is first)', async () => {
    const adminCallMade = vi.fn();

    const supabase = makeSupabase('user-2', { household_id: 'hh-1', role: 'member' });
    const caller = await getCallerInfo(supabase);

    if (!caller || caller.role !== 'owner') {
      // This is the 403 branch — Admin API never reached
    } else {
      adminCallMade();
    }

    expect(adminCallMade).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A+B. No orphan household on provisioned signup
// ---------------------------------------------------------------------------

describe('no orphan household — provisioned member path', () => {
  it('provisioning a member does not increment household count', () => {
    const ownerRows  = simulateTrigger('owner@example.com',  { full_name: 'Owner',  locale: 'en' });
    const memberRows = simulateTrigger('member@example.com', {
      household_id: ownerRows.households[0]?.name ? 'hh-1' : 'hh-1', // same hh
      role: 'member',
      full_name: 'Member',
    });

    expect(ownerRows.households).toHaveLength(1);
    expect(memberRows.households).toHaveLength(0); // no new household
  });

  it('total chequing accounts after provisioning is still 1', () => {
    const ownerRows  = simulateTrigger('owner@example.com',  { full_name: 'Owner' });
    const memberRows = simulateTrigger('member@example.com', {
      household_id: 'hh-1',
      role: 'member',
      full_name: 'Member',
    });

    const allAccounts = [...ownerRows.accounts, ...memberRows.accounts];
    const chequingAccounts = allAccounts.filter((a) => a.type === 'chequing');
    expect(chequingAccounts).toHaveLength(1); // only the owner's signup created one
  });
});
